/**
 * Orchestrator
 * Main orchestration engine that coordinates all components
 */

import { LLMClient, getLLMClient } from '../llm/LLMClient.js';
import { IntentParser } from './IntentParser.js';
import { DAGBuilder } from './DAGBuilder.js';
import { Scheduler } from './Scheduler.js';
import { getBlackboard } from '../state/Blackboard.js';
import { getEventBus, EventType } from '../state/EventBus.js';
import { getSessionStore } from '../state/SessionStore.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';
import { getOrLoadUserProfile } from '../state/UserProfile.js';
import { getTaskScheduler } from '../scheduler/Scheduler.js';
import { getFeedbackCollector } from '../evolution/FeedbackCollector.js';

const logger = getLogger('Orchestrator');

export interface ProcessRequest {
  sessionId: string;
  userInput: string;
  context?: Record<string, any>;
}

export interface OrchestratorConfig {
  llmProvider?: string;
  maxParallelAgents?: number;
  enableDAGOptimization?: boolean;
  maxTaskRetries?: number;
}

/**
 * Orchestrator - Main coordination engine
 */
export class Orchestrator {
  private llm: LLMClient;
  private intentParser: IntentParser;
  private dagBuilder: DAGBuilder;
  private scheduler: Scheduler;
  private agentFactory: AgentFactory;
  private eventBus: ReturnType<typeof getEventBus>;
  private blackboard: ReturnType<typeof getBlackboard>;
  private sessionStore: ReturnType<typeof getSessionStore>;
  private taskScheduler: ReturnType<typeof getTaskScheduler>;
  private feedbackCollector: ReturnType<typeof getFeedbackCollector>;
  private initialized: boolean = false;

  constructor(config: OrchestratorConfig = {}) {
    const appConfig = loadConfig();

    this.llm = getLLMClient();
    this.intentParser = new IntentParser(this.llm);
    this.dagBuilder = new DAGBuilder(this.llm);
    this.scheduler = new Scheduler(config.maxParallelAgents ?? appConfig.cluster.maxParallelAgents);
    this.agentFactory = new AgentFactory(this.llm);
    this.eventBus = getEventBus();
    this.blackboard = getBlackboard();
    this.sessionStore = getSessionStore();
    this.taskScheduler = getTaskScheduler();
    this.feedbackCollector = getFeedbackCollector();

    logger.info('Orchestrator created');
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      logger.warn('Orchestrator already initialized');
      return;
    }

    try {
      await this.blackboard.initialize();
      await this.eventBus.initialize();
      await this.sessionStore.ensureDirectories();
      await this.taskScheduler.initialize();
      await this.feedbackCollector.initialize();
      this.initialized = true;
      logger.info('Orchestrator initialized successfully');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to initialize orchestrator');
      throw error;
    }
  }

  /**
   * Process a user request
   */
  async processRequest(request: ProcessRequest): Promise<any> {
    const { sessionId, userInput, context = {} } = request;
    const userId = context.userId || context.scheduledTaskId ? 'scheduled' : 'default';
    const startTime = Date.now();

    if (!this.initialized) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    // 修复编码问题（主要针对 Windows 命令行）
    const fixedInput = this.fixEncoding(userInput);

    logger.info({ sessionId, userId, userInput: fixedInput.substring(0, 100) }, 'Processing request');

    try {
      // 0. Load user profile (non-blocking for performance)
      const userProfile = await getOrLoadUserProfile(userId);

      // 1. Ensure session exists in SessionStore
      const metadata = await this.sessionStore.getMetadata(sessionId);
      if (!metadata) {
        await this.sessionStore.createSession(sessionId, { ...context, userId });
      }

      // 2. Add user input to session
      await this.sessionStore.addMessage(sessionId, 'user', fixedInput);

      // 3. Parse intent
      this.eventBus.emit(EventType.SESSION_CREATED, { sessionId });
      const intent = await this.intentParser.parse(fixedInput);
      await this.eventBus.publish(EventType.SESSION_UPDATED, { sessionId, intent });

      // 4. Build DAG
      const dag = await this.dagBuilder.build(intent);
      logger.info({ taskCount: dag.getAllTasks().length }, 'DAG built');

      // 5. Create session in blackboard
      await this.blackboard.createSession(sessionId, { intent, dag });

      // 6. Schedule execution
      const taskResults = await this.scheduler.schedule(sessionId, dag, {
        agentFactory: this.agentFactory,
      });

      // 7. Format result for CLI/API response
      const result = this.formatResult(taskResults);

      // 8. Add agent response to session
      if (result.success && result.data?.response) {
        await this.sessionStore.addMessage(sessionId, 'assistant', result.data.response);
      }

      // 9. Update session status
      await this.sessionStore.updateStatus(sessionId, result.success ? 'completed' : 'failed');

      // 10. Record user interaction (non-blocking)
      const executionTime = Date.now() - startTime;

      // Extract agent and skill info from results
      // Get agent type from DAG tasks or use default
      const dagTasks = dag.getAllTasks();
      const agentUsed = dagTasks.length > 0 ? dagTasks[0].agentType : 'GenericAgent';

      const skillsUsed: string[] = [];
      if (result.data?.tasks) {
        for (const task of result.data.tasks) {
          if (task.skillUsed && !skillsUsed.includes(task.skillUsed)) {
            skillsUsed.push(task.skillUsed);
          }
        }
      }

      // Record interaction asynchronously
      setImmediate(async () => {
        try {
          await userProfile.recordInteraction({
            sessionId,
            timestamp: new Date(),
            userInput: fixedInput,
            agentUsed,
            skillsUsed,
            executionTime,
            success: result.success,
          });

          // Collect execution feedback (non-blocking)
          try {
            const dagTasks = dag.getAllTasks();
            await this.feedbackCollector.collectFeedback({
              sessionId,
              taskId: `${sessionId}_${Date.now()}`,
              timestamp: new Date(),
              agentType: agentUsed,
              systemPromptUsed: `System prompt for ${agentUsed}`,
              skillsUsed,
              executionTime,
              success: result.success,
              totalAgents: dagTasks.length,
              agentSequence: dagTasks.map(t => t.agentType),
              parallelGroups: 1, // TODO: Calculate from DAG
              actualExecutionTime: executionTime,
            });
          } catch (feedbackError: any) {
            logger.warn({ error: feedbackError.message }, 'Failed to collect feedback');
          }
        } catch (error: any) {
          logger.warn({ error: error.message }, 'Failed to record user interaction');
        }
      });

      await this.eventBus.publish(EventType.SESSION_COMPLETED, { sessionId, result });

      logger.info({ sessionId, executionTime }, 'Request processed successfully');
      return result;
    } catch (error: any) {
      logger.error({ sessionId, error: error.message }, 'Request processing failed');

      // Add error to session
      await this.sessionStore.addMessage(sessionId, 'system', `Error: ${error.message}`);
      await this.sessionStore.updateStatus(sessionId, 'failed');

      await this.eventBus.publish(EventType.SESSION_FAILED, { sessionId, error: error.message });
      throw error;
    }
  }

  /**
   * 格式化任务执行结果为标准响应格式
   */
  private formatResult(taskResults: Record<string, any>): {
    success: boolean;
    data?: any;
    error?: string;
  } {
    if (!taskResults || Object.keys(taskResults).length === 0) {
      return {
        success: false,
        error: 'No task results returned',
      };
    }

    // 提取所有任务结果
    const results = Object.values(taskResults);
    const failedTasks = results.filter((r: any) => r.error);

    // 如果有失败的任务
    if (failedTasks.length > 0) {
      return {
        success: false,
        error: failedTasks.map((t: any) => t.error).join('; '),
        data: { tasks: taskResults },
      };
    }

    // 收集所有任务的响应内容
    const responses: string[] = [];
    const allData: any[] = [];

    for (const taskResult of results) {
      // taskResult 结构: {taskId, result, duration}
      // 其中 result 是 Agent 返回的内容
      if (taskResult.result) {
        // Agent 可能返回 {taskId, result, analysis} 等
        const agentResult = taskResult.result;

        if (agentResult.result) {
          responses.push(agentResult.result);
        } else if (agentResult.analysis) {
          responses.push(agentResult.analysis);
        } else if (agentResult.response) {
          responses.push(agentResult.response);
        }

        allData.push(agentResult);
      }
    }

    // 组合响应
    const response = responses.length > 0
      ? responses.join('\n\n---\n\n')
      : JSON.stringify(allData, null, 2);

    return {
      success: true,
      data: {
        response,
        tasks: allData,
        summary: {
          totalTasks: results.length,
          totalDuration: results.reduce((sum: number, r: any) => sum + (r.duration || 0), 0),
        },
      },
    };
  }

  /**
   * 修复文本编码问题（Windows 命令行 UTF-8）
   */
  private fixEncoding(text: string): string {
    if (!text) return text;

    // 检测是否包含乱码特征（替换字符、控制字符等）
    const hasGarbage = /[\u0000-\u001F\uFFFd\ufffd]/.test(text);

    if (hasGarbage) {
      // 移除控制字符
      text = text.replace(/[\u0000-\u001F\uFFFd\ufffd]/g, '');

      // 尝试 Latin1 → UTF8 转换
      try {
        const buffer = Buffer.from(text, 'latin1');
        const decoded = buffer.toString('utf8');
        // 验证转换是否合理
        if (!decoded.includes('') && !decoded.includes('')) {
          return decoded;
        }
      } catch {
        // 转换失败，返回原文本
      }
    }

    return text;
  }

  /**
   * Cancel a task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    logger.info({ taskId }, 'Cancelling task');
    return await this.scheduler.cancelTask(taskId);
  }

  /**
   * Get all active agents
   */
  async getActiveAgents(): Promise<any[]> {
    return await this.agentFactory.getActiveAgents();
  }

  /**
   * Get skill manager
   */
  getSkillManager() {
    return this.agentFactory.getSkillManager();
  }

  /**
   * Get task scheduler
   */
  getTaskScheduler() {
    return this.taskScheduler;
  }

  /**
   * Get feedback collector
   */
  getFeedbackCollector() {
    return this.feedbackCollector;
  }

  /**
   * Submit user feedback for a session
   */
  async submitFeedback(sessionId: string, feedback: {
    rating?: number;
    satisfied?: boolean;
    issues?: string[];
    suggestions?: string[];
  }): Promise<any> {
    try {
      // Get session data from SessionStore
      const metadata = await this.sessionStore.getMetadata(sessionId);
      if (!metadata) {
        return {
          success: false,
          error: 'Session not found',
        };
      }

      // Use default values for feedback fields that aren't stored in SessionMetadata
      await this.feedbackCollector.collectFeedback({
        sessionId,
        taskId: `${sessionId}_feedback_${Date.now()}`,
        timestamp: new Date(),
        agentType: 'GenericAgent', // Default since not stored in metadata
        systemPromptUsed: 'System prompt',
        skillsUsed: [], // Default empty array
        executionTime: 0, // Default since not stored
        success: metadata.status === 'completed',
        totalAgents: 1,
        agentSequence: [],
        parallelGroups: 1,
        actualExecutionTime: 0,
        rating: feedback.rating,
        satisfied: feedback.satisfied,
        issues: feedback.issues,
        suggestions: feedback.suggestions,
      });

      return {
        success: true,
        message: 'Thank you for your feedback!',
      };
    } catch (error: any) {
      logger.error({ error, sessionId }, 'Failed to submit feedback');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    try {
      await this.scheduler.cancelAll();
      await this.taskScheduler.shutdown();
      await this.blackboard.close();
      await this.llm.close();
      this.initialized = false;
      logger.info('Orchestrator shut down successfully');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Error during shutdown');
    }
  }
}

/**
 * Factory function to create orchestrator
 */
export function createOrchestrator(config?: OrchestratorConfig): Orchestrator {
  return new Orchestrator(config);
}

// Singleton instance
let orchestrator: Orchestrator | null = null;

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    orchestrator = createOrchestrator();
  }
  return orchestrator;
}
