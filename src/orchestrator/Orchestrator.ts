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

      // 3.5. Handle conversation intents (greetings, chat, etc.) - skip DAG
      if (intent.type === 'conversation') {
        const conversationResponse = await this.handleConversation(intent, fixedInput, userProfile);

        // Add response to session
        await this.sessionStore.addMessage(sessionId, 'assistant', conversationResponse);
        await this.sessionStore.updateStatus(sessionId, 'completed');

        // Record interaction for conversation type
        const executionTime = Date.now() - startTime;
        setImmediate(async () => {
          try {
            await userProfile.recordInteraction({
              sessionId,
              timestamp: new Date(),
              userInput: fixedInput,
              agentUsed: 'GenericAgent',
              skillsUsed: [],
              executionTime,
              success: true,
            });
          } catch (error: any) {
            logger.warn({ error: error.message }, 'Failed to record user interaction');
          }
        });

        await this.eventBus.publish(EventType.SESSION_COMPLETED, { sessionId, result: { success: true, data: { response: conversationResponse } } });
        logger.info({ sessionId, executionTime }, 'Conversation handled successfully');

        return {
          success: true,
          data: {
            response: conversationResponse,
            summary: {
              totalTasks: 0,
              totalDuration: executionTime,
            },
          },
        };
      }

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
   * Handle conversation intents (greetings, chat, etc.)
   * Returns a simple conversational response without DAG execution
   */
  private async handleConversation(intent: any, _userInput: string, userProfile: any): Promise<string> {
    const conversationType = intent.conversationType || 'chat';

    // Get user preferences for personalized responses (currently unused but available for future personalization)
    userProfile.getPreferences();

    // Response templates based on conversation type
    const responses: Record<string, string[]> = {
      greeting: [
        `您好！很高兴为您服务。我是您的个人AI助手，可以帮您完成各种工作任务，比如：\n- 编写代码和程序\n- 数据分析和处理\n- 文档编写和分析\n- 自动化任务执行\n\n请告诉我您需要什么帮助？`,
        `嗨！我是您的AI助手。无论您需要编程、数据分析还是其他工作协助，我都很乐意帮忙。今天有什么可以帮您的吗？`,
        `你好！我是您的个人AI助手，随时准备协助您完成工作。我可以处理代码、数据、文档等各种任务。请随时告诉我您的需求。`,
      ],
      thanks: [
        `不客气！很高兴能帮到您。如果还有其他问题，随时告诉我！`,
        `不用谢！这是我的荣幸。还有其他我能帮忙的地方吗？`,
        `随时为您服务！如果还有什么需要，请尽管开口。`,
      ],
      farewell: [
        `再见！祝您工作顺利，期待下次为您服务！`,
        `拜拜！祝您有个愉快的一天！`,
        `再见！有需要随时找我！`,
      ],
      chat: [
        `我明白了！作为一个AI助手，我随时准备协助您处理各种工作和任务。有什么具体需要帮助的吗？`,
        `好的！我在这里听您吩咐。请告诉我您想要完成什么任务？`,
        `收到！作为您的个人助手，我会尽力协助您。请提出您的具体需求吧。`,
      ],
      help: [
        `我是您的个人AI助手，可以帮您完成以下工作：\n\n📝 代码开发\n- 编写各类编程语言代码\n- 代码审查和优化建议\n- 调试和问题排查\n\n📊 数据处理\n- 数据分析和可视化\n- 数据清洗和转换\n- 统计分析\n\n📄 文档处理\n- 文档编写和编辑\n- 内容分析和总结\n- 格式转换\n\n🤖 自动化任务\n- 工作流自动化\n- 批量操作\n- 定时任务调度\n\n请告诉我您想做什么，我会智能匹配最合适的Agent来帮您完成！`,
      ],
    };

    // Get response templates for this type
    const typeResponses = responses[conversationType] || responses.chat;

    // Select a response (can be random or based on user history)
    const responseIndex = Math.floor(Math.random() * typeResponses.length);

    return typeResponses[responseIndex];
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
