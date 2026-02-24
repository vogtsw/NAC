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
import { AgentFactory } from '../agents/AgentFactory.js';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';

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

    if (!this.initialized) {
      throw new Error('Orchestrator not initialized. Call initialize() first.');
    }

    logger.info({ sessionId, userInput: userInput.substring(0, 100) }, 'Processing request');

    try {
      // 1. Parse intent
      this.eventBus.emit(EventType.SESSION_CREATED, { sessionId });
      const intent = await this.intentParser.parse(userInput);
      await this.eventBus.publish(EventType.SESSION_UPDATED, { sessionId, intent });

      // 2. Build DAG
      const dag = await this.dagBuilder.build(intent);
      logger.info({ taskCount: dag.getAllTasks().length }, 'DAG built');

      // 3. Create session
      await this.blackboard.createSession(sessionId, { intent, dag });

      // 4. Schedule execution
      const result = await this.scheduler.schedule(sessionId, dag, {
        agentFactory: this.agentFactory,
      });

      await this.eventBus.publish(EventType.SESSION_COMPLETED, { sessionId, result });

      logger.info({ sessionId }, 'Request processed successfully');
      return result;
    } catch (error: any) {
      logger.error({ sessionId, error: error.message }, 'Request processing failed');
      await this.eventBus.publish(EventType.SESSION_FAILED, { sessionId, error: error.message });
      throw error;
    }
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
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    try {
      await this.scheduler.cancelAll();
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
