/**
 * Orchestrator
 * Main orchestration engine that coordinates all components
 */

import { LLMClient, getLLMClient } from '../llm/LLMClient.js';
import { IntentParser } from './IntentParser.js';
import { DAGBuilder } from './DAGBuilder.js';
import { DAGBuilderV2 } from './DAGBuilderV2.js';
import { Scheduler } from './Scheduler.js';
import { TeamBuilder, type TaskProfile } from './TeamBuilder.js';
import { ClusterDAGBuilder } from './ClusterDAGBuilder.js';
import { ClusterReporter, type ClusterReport } from './ClusterReporter.js';
import type { ClusterArtifact } from './AgentHandoff.js';
import { getBlackboard } from '../state/Blackboard.js';
import { getEventBus, EventType } from '../state/EventBus.js';
import { getSessionStore } from '../state/SessionStore.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { AgentGenerator } from '../agents/AgentGenerator.js';
import { getAgentRegistry } from './AgentRegistry.js';
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
  /** Enable DeepSeek cluster path (TeamBuilder + ClusterDAGBuilder) */
  useClusterPath?: boolean;
}

/**
 * Orchestrator - Main coordination engine
 */
export class Orchestrator {
  private llm: LLMClient;
  private intentParser: IntentParser;
  private dagBuilder: { build(intent: any): Promise<any> };
  private scheduler: Scheduler;
  private agentFactory: AgentFactory;
  private agentGenerator: AgentGenerator;
  private agentRegistry: ReturnType<typeof getAgentRegistry>;
  private eventBus: ReturnType<typeof getEventBus>;
  private blackboard: ReturnType<typeof getBlackboard>;
  private sessionStore: ReturnType<typeof getSessionStore>;
  private taskScheduler: ReturnType<typeof getTaskScheduler>;
  private feedbackCollector: ReturnType<typeof getFeedbackCollector>;
  private useEnhancedDAGBuilder: boolean;
  private useClusterPath: boolean;
  private teamBuilder?: TeamBuilder;
  private clusterDAGBuilder?: ClusterDAGBuilder;
  private clusterReporter?: ClusterReporter;
  private initialized: boolean = false;

  constructor(config: OrchestratorConfig = {}) {
    const appConfig = loadConfig();

    this.llm = getLLMClient();
    this.intentParser = new IntentParser(this.llm);
    this.useEnhancedDAGBuilder =
      config.enableDAGOptimization ?? appConfig.orchestrator.enableDAGOptimization;
    this.dagBuilder = this.useEnhancedDAGBuilder ? new DAGBuilderV2(this.llm) : new DAGBuilder(this.llm);
    this.scheduler = new Scheduler(config.maxParallelAgents ?? appConfig.cluster.maxParallelAgents);
    this.agentFactory = new AgentFactory(this.llm);
    this.agentRegistry = getAgentRegistry();
    this.agentGenerator = new AgentGenerator(this.llm, this.agentRegistry);
    this.eventBus = getEventBus();
    this.blackboard = getBlackboard();
    this.sessionStore = getSessionStore();
    this.taskScheduler = getTaskScheduler();
    this.feedbackCollector = getFeedbackCollector();

    // DeepSeek cluster path
    this.useClusterPath = config.useClusterPath ?? (process.env.NAC_CLUSTER === 'true');
    if (this.useClusterPath) {
      this.teamBuilder = new TeamBuilder(this.llm);
      this.clusterDAGBuilder = new ClusterDAGBuilder();
      this.clusterReporter = new ClusterReporter();
    }

    logger.info({ useEnhancedDAGBuilder: this.useEnhancedDAGBuilder, useClusterPath: this.useClusterPath }, 'Orchestrator created');
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
      await this.agentRegistry.initialize();
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
  // Active mode for current cluster run (plan|agent|yolo)
  private currentMode: string = "agent";

  /**
   * Centralized tool permission gate per mode (goal.md security model).
   */
  isToolAllowed(toolName: string, mode?: string): { allowed: boolean; reason?: string } {
    const m = mode || this.currentMode;
    // Write tools
    const writeTools = ["file_write", "edit_file", "apply_patch", "file-ops"];
    // Destructive tools
    const destructiveTools = ["bash", "run_command", "terminal-exec"];
    // Git write tools
    const gitWriteTools = ["git_commit", "git_push"];
    // Network tools
    const networkTools = ["web_search", "web_fetch", "mcp_call_tool", "npm_install", "pip_install"];

    if (m === "plan") {
      if (writeTools.includes(toolName)) return { allowed: false, reason: "Plan mode: write tools are disabled" };
      if (destructiveTools.includes(toolName)) return { allowed: false, reason: "Plan mode: shell is read-only diagnostics only" };
      if (gitWriteTools.includes(toolName)) return { allowed: false, reason: "Plan mode: git write operations are disabled" };
      if (networkTools.includes(toolName)) return { allowed: false, reason: "Plan mode: network access is disabled" };
      return { allowed: true };
    }

    if (m === "agent") {
      if (gitWriteTools.includes(toolName)) return { allowed: false, reason: "Agent mode: git push requires explicit approval" };
      if (networkTools.includes(toolName)) return { allowed: false, reason: "Agent mode: network tools require explicit approval" };
      return { allowed: true }; // Other writes/shell require approval (handled at tool level)
    }

    if (m === "yolo") {
      if (toolName === "git_push") return { allowed: false, reason: "YOLO mode: git push still requires explicit approval" };
      return { allowed: true };
    }

    return { allowed: true };
  }

  async processRequest(request: ProcessRequest): Promise<any> {
    const { sessionId, userInput, context = {} } = request;
    const userId = context.scheduledTaskId ? 'scheduled' : (context.userId || 'default');
    const startTime = Date.now();

    // Enforce runtime mode from context
    this.currentMode = context.mode || "agent";
    if (!["plan", "agent", "yolo"].includes(this.currentMode)) {
      this.currentMode = "agent";
    }
    logger.info({ mode: this.currentMode, sessionId }, "Mode enforced for request");

    if (!this.initialized) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    // 修复编码问题（主要针对 Windows 命令行）
    const fixedInput = this.fixEncoding(userInput);

    logger.info({ sessionId, userId, userInput: fixedInput.substring(0, 100) }, 'Processing request');

    // 快速检测：如果输入看起来是乱码或非常短的输入，直接作为对话处理
    // 这避免了因编码问题导致的复杂任务分析
    const quickConversationResponse = this.detectQuickConversation(fixedInput, userInput);
    if (quickConversationResponse) {
      await this.sessionStore.createSession(sessionId, { ...context, userId });
      await this.sessionStore.addMessage(sessionId, 'user', fixedInput);
      await this.sessionStore.addMessage(sessionId, 'assistant', quickConversationResponse);
      await this.sessionStore.updateStatus(sessionId, 'completed');

      const executionTime = Date.now() - startTime;
      logger.info({ sessionId, executionTime }, 'Quick conversation handled');

      return {
        success: true,
        data: {
          response: quickConversationResponse,
          summary: {
            totalTasks: 0,
            totalDuration: executionTime,
          },
        },
      };
    }

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

      // 3.1. Search intent fallback: 使用关键词检测作为 LLM 意图识别的补充
      // 当 LLM 未能正确识别搜索意图时，基于关键词进行修正
      const searchIntent = this.detectSearchIntentByKeywords(fixedInput, intent);
      await this.eventBus.publish(EventType.SESSION_UPDATED, { sessionId, intent: searchIntent });

      // 3.2. Check if we need to generate a new Agent (L2-16)
      if (searchIntent.type !== 'conversation') {
        try {
          const agentGenerationRecord = await this.agentGenerator.generateAgent(searchIntent);
          if (agentGenerationRecord) {
            logger.info({
              agentType: agentGenerationRecord.agentType,
              configPath: agentGenerationRecord.configPath
            }, 'New Agent generated');

            // Record to feedback system
            await this.feedbackCollector.recordAgentGeneration({
              agentType: agentGenerationRecord.agentType,
              taskId: searchIntent.primaryGoal,
              configPath: agentGenerationRecord.configPath,
              timestamp: agentGenerationRecord.timestamp,
              sessionId,
              userId
            });
          }
        } catch (error: any) {
          logger.warn({ error: error.message }, 'Agent generation failed, continuing with existing agents');
        }
      }

      // 3.5. Handle conversation intents (greetings, chat, etc.) - skip DAG
      if (searchIntent.type === 'conversation') {
        const conversationResponse = await this.handleConversation(searchIntent, fixedInput, userProfile);

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

      // 4. Build DAG (cluster path or legacy path)
      let dag: any;
      let clusterReport: ClusterReport | undefined;
      let clusterArtifacts: ClusterArtifact[] = [];

      if (this.useClusterPath && this.teamBuilder && this.clusterDAGBuilder && this.clusterReporter) {
        // DeepSeek cluster path: TeamBuilder → ClusterDAGBuilder → Scheduler
        const taskProfile: TaskProfile = {
          description: searchIntent.primaryGoal,
          intent: searchIntent.type,
          capabilities: searchIntent.capabilities || [],
          complexity: typeof searchIntent.complexity === 'number' ? searchIntent.complexity :
            (searchIntent.complexity === 'complex' ? 7 : searchIntent.complexity === 'medium' ? 4 : 2),
          riskLevel: searchIntent.riskLevel,
        };

        const teamPlan = await this.teamBuilder.buildTeam(taskProfile);
        logger.info({ runId: teamPlan.runId, mode: teamPlan.collaborationMode }, 'Cluster team built');

        const clusterDag = this.clusterDAGBuilder.build(teamPlan);
        dag = this.clusterDAGBuilder.toExecutableDAG(clusterDag);
        logger.info({ steps: clusterDag.steps.length, maxParallelism: clusterDag.maxParallelism }, 'Cluster DAG built');

        // Start the cluster reporter
        this.clusterReporter.start();

        // Use teamPlan.runId for session so artifact persistence matches
        const clusterSessionId = teamPlan.runId || sessionId;
        await this.blackboard.createSession(clusterSessionId, { intent: searchIntent, dag, teamPlan, clusterDag });

        const taskResults = await this.scheduler.schedule(sessionId, dag, {
          agentFactory: this.agentFactory,
          sessionId,
        });

        // Build and persist cluster artifacts to Blackboard
        for (const [taskId, rawResult] of Object.entries(taskResults)) {
          const result = rawResult as any;
          const step = clusterDag.steps.find(s => s.id === taskId);
          if (step) {
            const artifact: ClusterArtifact = {
              id: `${teamPlan.runId}_${taskId}`,
              runId: teamPlan.runId,
              type: step.outputArtifact,
              producer: step.agentRole,
              consumers: clusterDag.steps.filter(s => s.dependencies.includes(taskId)).map(s => s.agentRole),
              content: result,
              confidence: (result as any)?.error ? 0.5 : 0.95,
              model: step.model,
              tokenCost: (result as any)?.cost || 0,
              createdAt: Date.now(),
            };
            clusterArtifacts.push(artifact);
            // Persist to Blackboard so downstream steps can consume
            await this.blackboard.putArtifact(artifact);
          }
        }

        clusterReport = this.clusterReporter.generateReport({
          runId: teamPlan.runId,
          teamPlan,
          clusterDag,
          artifacts: clusterArtifacts,
          status: clusterArtifacts.some(a => a.confidence < 0.8) ? 'partial' : 'completed',
        });

        const result = this.formatClusterResult(teamPlan, taskResults, clusterReport, clusterArtifacts);
        await this.sessionStore.addMessage(sessionId, 'assistant', `[Cluster] ${teamPlan.collaborationMode} run complete`);
        await this.sessionStore.updateStatus(sessionId, clusterReport.status === 'completed' ? 'completed' : 'failed');

        const executionTime = Date.now() - startTime;
        await this.eventBus.publish(EventType.SESSION_COMPLETED, { sessionId, result });

        logger.info({ sessionId, executionTime, clusterMode: true }, 'Cluster request processed');
        return result;
      }

      // Legacy path: original DAGBuilder
      dag = await this.dagBuilder.build(searchIntent);
      logger.info({ taskCount: dag.getAllTasks().length }, 'DAG built');

      // 5. Create session in blackboard
      await this.blackboard.createSession(sessionId, { intent: searchIntent, dag });

      // 6. Schedule execution
      const taskResults = await this.scheduler.schedule(sessionId, dag, {
        agentFactory: this.agentFactory,
        sessionId,
      });

      // 7. Format result for CLI/API response
      const result = this.formatResult(taskResults);
      const normalizedTasks = this.normalizeTasks(result.data?.tasks);

      // 8. Save artifacts to separate files
      if (result.success && normalizedTasks.length > 0) {
        await this.saveArtifacts(sessionId, normalizedTasks);
      }

      // 9. Add agent response to session
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
      if (normalizedTasks.length > 0) {
        for (const task of normalizedTasks) {
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
              agentSequence: dagTasks.map((t: any) => t.agentType),
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
   * 快速检测简单对话输入（避免因编码问题调用LLM）
   * 检测乱码、极短输入等，直接返回友好回应
   */
  private detectQuickConversation(fixedInput: string, _originalInput: string): string | null {
    // 检测1：极短输入（可能是乱码的中文问候）
    if (fixedInput.length <= 3) {
      // 检查是否只包含特殊字符或乱码特征
      const hasGarbageChars = /[\u0000-\u001F\uFFFd\ufffd}`{}\[\]\\]/.test(fixedInput);
      if (hasGarbageChars || fixedInput.length === 0) {
        // 很可能是中文输入被编码破坏，返回友好问候
        return `您好！很高兴为您服务。我是您的个人AI助手，可以帮您完成各种工作任务，比如：\n- 编写代码和程序\n- 数据分析和处理\n- 文档编写和分析\n- 自动化任务执行\n\n请告诉我您需要什么帮助？`;
      }
    }

    // 检测2：原始输入包含中文字符但fixedInput很短（编码问题）
    // 修复：不再拦截中文输入，让它们正常进入任务处理流程
    // const hasChineseOriginal = /[\u4e00-\u9fa5]/.test(originalInput);
    // if (hasChineseOriginal && fixedInput.length <= 3 && fixedInput !== originalInput) {
    //   return `您好！...`;
    // }

    // 检测3：已知的简单问候模式（精确匹配，避免误判任务描述）
    const greetings = ['hi', 'hello', 'hey', '嗨', '你好', 'hi!', 'hello!', 'hey!', '嗨!', '你好!'];
    const lowerInput = fixedInput.toLowerCase().trim();
    if (greetings.includes(lowerInput)) {
      return `你好！我是您的个人AI助手，随时准备协助您完成工作。我可以处理代码、数据、文档等各种任务。请随时告诉我您的需求。`;
    }

    // 检测4：帮助请求（精确匹配或以特定关键词开头）
    const helpPatterns = ['help', '帮助', '你能做什么', 'what can you do', 'what can i do'];
    if (helpPatterns.some(h => lowerInput === h || lowerInput.startsWith(h + ' '))) {
      return `我是您的个人AI助手，可以帮您完成以下工作：\n\n📝 代码开发\n- 编写各类编程语言代码\n- 代码审查和优化建议\n- 调试和问题排查\n\n📊 数据处理\n- 数据分析和可视化\n- 数据清洗和转换\n- 统计分析\n\n📄 文档处理\n- 文档编写和编辑\n- 内容分析和总结\n- 格式转换\n\n🤖 自动化任务\n- 工作流自动化\n- 批量操作\n- 定时任务调度\n\n请告诉我您想做什么，我会智能匹配最合适的Agent来帮您完成！`;
    }

    return null;
  }

  /**
   * 检测搜索意图（关键词检测，作为 LLM 意图识别的补充）
   * 当检测到搜索关键词时，覆盖 LLM 的识别结果
   */
  private detectSearchIntentByKeywords(userInput: string, originalIntent: any): any {
    const lowerInput = userInput.toLowerCase();

    // 搜索意图关键词（中英文）
    const searchKeywords = [
      'search', '搜索', '查找', 'find', 'look for', 'lookup',
      'google', '百度', 'bing',
      'news', '新闻', 'latest', '最新',
      'what is', 'what are', 'how to', 'define',
      'github', 'gitHub', 'trending', 'trend',
      '热门', '最火', '本周', 'top10', 'top 10'
    ];

    // 检查是否包含搜索关键词
    const hasSearchKeyword = searchKeywords.some(keyword => lowerInput.includes(keyword));

    // 如果包含搜索关键词且原意图不是 automation，则覆盖
    if (hasSearchKeyword && originalIntent.type !== 'automation') {
      logger.info(
        { originalIntent: originalIntent.type, detectedIntent: 'automation' },
        'Search intent detected by keywords, overriding LLM intent'
      );

      // 提取搜索查询内容
      let searchQuery = userInput;
      // 移除常见搜索关键词以获得更清晰的查询
      searchKeywords.forEach(keyword => {
        const regex = new RegExp(keyword, 'gi');
        searchQuery = searchQuery.replace(regex, '').trim();
      });

      // 如果提取后内容为空，使用原始输入
      if (!searchQuery || searchQuery.length < 2) {
        searchQuery = userInput;
      }

      return {
        ...originalIntent,
        type: 'automation',
        primaryGoal: `搜索关于 ${searchQuery} 的信息`,
        capabilities: ['web-search', 'information-retrieval'],
        complexity: 'simple',
        estimatedSteps: 1,
      };
    }

    return originalIntent;
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
   * Format cluster run result with team plan, report, and artifacts.
   */
  private formatClusterResult(
    teamPlan: any,
    taskResults: Record<string, any>,
    clusterReport: ClusterReport,
    clusterArtifacts: ClusterArtifact[],
  ): { success: boolean; data?: any; error?: string } {
    const results = Object.values(taskResults);
    const failedTasks = results.filter((r: any) => r.error);

    return {
      success: failedTasks.length === 0,
      data: {
        response: this.clusterReporter!.displayReport(clusterReport),
        cluster: {
          runId: teamPlan.runId,
          mode: teamPlan.collaborationMode,
          coordinator: teamPlan.coordinator,
          members: teamPlan.members,
          report: clusterReport,
          artifacts: clusterArtifacts.map(a => ({
            id: a.id,
            type: a.type,
            producer: a.producer,
          })),
        },
        tasks: results,
        summary: {
          totalTasks: results.length,
          totalDuration: clusterReport.duration,
          estimatedCost: clusterReport.totalCost,
          cacheHitRate: clusterReport.cacheHitRate,
        },
      },
    };
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
        data: { tasks: this.normalizeTasks(taskResults) },
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
        const responseText = this.extractTaskResponseText(agentResult);
        if (responseText) {
          responses.push(responseText);
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

  private normalizeTasks(tasks: any): any[] {
    if (Array.isArray(tasks)) {
      return tasks;
    }
    if (tasks && typeof tasks === 'object') {
      return Object.values(tasks);
    }
    return [];
  }

  private extractTaskResponseText(agentResult: any): string {
    if (!agentResult) return '';
    if (typeof agentResult === 'string') return agentResult;
    if (typeof agentResult.response === 'string') return agentResult.response;
    if (typeof agentResult.analysis === 'string') return agentResult.analysis;
    if (typeof agentResult.automationPlan === 'string') return agentResult.automationPlan;
    if (typeof agentResult.result === 'string') return agentResult.result;
    if (agentResult.result && typeof agentResult.result.response === 'string') {
      return agentResult.result.response;
    }
    return '';
  }

  /**
   * 保存任务产物到独立文件
   */
  private async saveArtifacts(sessionId: string, tasks: any[]): Promise<void> {
    const fs = await import('fs');
    const join = (await import('path')).join;

    const artifactsDir = join(process.cwd(), 'memory', 'artifacts', sessionId);

    // 确保目录存在
    await fs.promises.mkdir(artifactsDir, { recursive: true });

    for (const task of tasks) {
      if (!task.result) continue;

      const taskName = task.taskId || 'unknown';

      // 提取不同类型的产物
      if (task.result.code) {
        // 保存代码文件
        const codeExt = this.getCodeExtension(task.result.code);
        const codePath = join(artifactsDir, `${taskName}${codeExt}`);
        await fs.promises.writeFile(codePath, task.result.code, 'utf-8');
        logger.info({ artifact: codePath }, 'Code artifact saved');
      }

      if (task.result.analysis) {
        // 保存分析报告
        const reportPath = join(artifactsDir, `${taskName}_analysis.md`);
        await fs.promises.writeFile(reportPath, task.result.analysis, 'utf-8');
        logger.info({ artifact: reportPath }, 'Analysis artifact saved');
      }

      if (task.result.automationPlan) {
        // 保存自动化计划
        const planPath = join(artifactsDir, `${taskName}_automation_plan.md`);
        await fs.promises.writeFile(planPath, task.result.automationPlan, 'utf-8');
        logger.info({ artifact: planPath }, 'Automation plan artifact saved');
      }

      if (task.result.response && !task.result.code) {
        // 保存其他响应内容
        const responsePath = join(artifactsDir, `${taskName}_response.md`);
        await fs.promises.writeFile(responsePath, task.result.response, 'utf-8');
        logger.info({ artifact: responsePath }, 'Response artifact saved');
      }
    }

    // 创建 artifacts 索引文件
    const indexPath = join(artifactsDir, 'index.md');
    let indexContent = `# Artifacts for Session: ${sessionId}\n\n`;
    indexContent += `**Generated**: ${new Date().toISOString()}\n\n`;
    indexContent += `## Task Artifacts\n\n`;

    for (const task of tasks) {
      if (!task.result) continue;
      indexContent += `### ${task.taskId} (${task.agentType})\n\n`;

      if (task.result.code) {
        const codeExt = this.getCodeExtension(task.result.code);
        indexContent += `- **Code**: [\`${task.taskId}${codeExt}\`](./${task.taskId}${codeExt})\n`;
      }

      if (task.result.analysis) {
        indexContent += `- **Analysis**: [\`${task.taskId}_analysis.md\`](./${task.taskId}_analysis.md)\n`;
      }

      if (task.result.automationPlan) {
        indexContent += `- **Automation Plan**: [\`${task.taskId}_automation_plan.md\`](./${task.taskId}_automation_plan.md)\n`;
      }

      if (task.result.response && !task.result.code) {
        indexContent += `- **Response**: [\`${task.taskId}_response.md\`](./${task.taskId}_response.md)\n`;
      }

      indexContent += '\n';
    }

    await fs.promises.writeFile(indexPath, indexContent, 'utf-8');
    logger.info({ sessionId, artifactsDir, artifactCount: tasks.length }, 'Artifacts saved successfully');
  }

  /**
   * 根据代码内容检测文件扩展名
   */
  private getCodeExtension(code: string): string {
    if (code.includes('```python') || code.includes('def ')) return '.py';
    if (code.includes('```javascript') || code.includes('```typescript') || code.includes('function ') || code.includes('const ')) return '.js';
    if (code.includes('```java') || code.includes('public class')) return '.java';
    if (code.includes('```cpp') || code.includes('#include')) return '.cpp';
    if (code.includes('```csharp') || code.includes('namespace ')) return '.cs';
    if (code.includes('```go') || code.includes('package ')) return '.go';
    if (code.includes('```rust') || code.includes('fn ')) return '.rs';
    if (code.includes('```ruby') || code.includes('def ')) return '.rb';
    if (code.includes('```php') || code.includes('<?php')) return '.php';
    if (code.includes('```sql')) return '.sql';
    if (code.includes('```bash') || code.includes('```sh')) return '.sh';
    if (code.includes('```json')) return '.json';
    if (code.includes('```xml')) return '.xml';
    if (code.includes('```html')) return '.html';
    if (code.includes('```css')) return '.css';
    if (code.includes('class ')) return '.ts'; // Default for TypeScript classes

    return '.txt'; // Default fallback
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
   * Resume a previous session from its checkpoint.
   */
  async resumeSession(sessionId: string, additionalInput?: string): Promise<any> {
    if (!this.initialized) throw new Error("Orchestrator not initialized.");

    const state = await this.blackboard.getState(sessionId);
    if (!state) throw new Error(`Session not found: ${sessionId}`);

    const checkpointId = `${sessionId}_checkpoint_*`;
    const checkpoints = await this.blackboard.listCheckpoints(sessionId);

    if (checkpoints.length === 0) {
      throw new Error(`No checkpoint found for session: ${sessionId}`);
    }

    const latestCheckpoint = checkpoints[checkpoints.length - 1];
    const restored = await this.blackboard.restoreCheckpoint(latestCheckpoint, sessionId);

    if (!restored) throw new Error(`Failed to restore checkpoint for session: ${sessionId}`);

    logger.info({ sessionId, checkpointId: latestCheckpoint }, "Session resumed from checkpoint");

    if (additionalInput) {
      return this.processRequest({
        sessionId,
        userInput: additionalInput,
        context: { resumed: true, checkpointId: latestCheckpoint },
      });
    }

    const artifacts = await this.blackboard.listArtifacts(sessionId);
    return {
      success: true,
      data: {
        sessionId,
        resumed: true,
        status: state.status,
        artifacts: artifacts.map(a => ({ id: a.id, type: a.type })),
        message: `Session ${sessionId} restored. ${artifacts.length} artifacts available.`,
      },
    };
  }

  /**
   * Create a checkpoint for the current session state.
   */
  async checkpointSession(sessionId: string): Promise<string> {
    const checkpointId = await this.blackboard.createCheckpoint(sessionId);
    logger.info({ sessionId, checkpointId }, "Session checkpoint created");
    return checkpointId;
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
