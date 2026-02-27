/**
 * Base Agent
 * Abstract base class for all agent types
 */

import { LLMClient } from '../llm/LLMClient.js';
import { SkillManager } from '../skills/SkillManager.js';
import { AgentStatus, ExecutionContext, SkillResult } from '../state/models.js';
import { getLogger, childLogger } from '../monitoring/logger.js';
import { getPromptBuilder } from '../llm/PromptBuilder.js';

const logger = getLogger('BaseAgent');

/**
 * Abstract base agent class
 */
export abstract class BaseAgent {
  protected logger: ReturnType<typeof childLogger>;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected tasksCompleted: number = 0;
  protected totalExecutionTime: number = 0;
  protected promptBuilder: ReturnType<typeof getPromptBuilder>;

  // Cached system prompt
  private cachedSystemPrompt: string | null = null;

  constructor(
    protected llm: LLMClient,
    protected skillManager: SkillManager,
    public readonly agentType: string
  ) {
    this.logger = childLogger(logger, { agent: agentType });
    this.promptBuilder = getPromptBuilder();
  }

  /**
   * Execute a task (must be implemented by subclasses)
   */
  abstract execute(task: any): Promise<any>;

  /**
   * Use a skill
   */
  protected async useSkill(skillName: string, params: any, context?: ExecutionContext): Promise<SkillResult> {
    this.logger.debug({ skill: skillName, params }, 'Using skill');

    const result = await this.skillManager.executeSkill(skillName, params, context);

    if (!result.success) {
      this.logger.warn({ skill: skillName, error: result.error }, 'Skill execution failed');
    }

    return result;
  }

  /**
   * Call LLM with system prompt from config/agents/
   */
  protected async callLLM(prompt: string, options?: any): Promise<string> {
    // Get system prompt from MD file
    const systemPrompt = await this.getSystemPrompt();

    return await this.llm.complete(prompt, {
      systemPrompt,
      ...options,
    });
  }

  /**
   * Call LLM with full context (system prompt + session history + skills)
   */
  protected async callLLMWithContext(options: {
    userInput: string;
    sessionId?: string;
    includeSessionHistory?: boolean;
    includeSkills?: boolean;
    additionalContext?: string;
    llmOptions?: any;
  }): Promise<string> {
    const {
      userInput,
      sessionId,
      includeSessionHistory = true,
      includeSkills = true,
      additionalContext = '',
      llmOptions = {},
    } = options;

    // Build complete context using PromptBuilder
    const fullContext = await this.promptBuilder.buildContext({
      agentType: this.agentType,
      sessionId,
      userInput,
      includeSessionHistory,
      includeSkills,
      additionalContext,
    });

    this.logger.debug({ contextLength: fullContext.length, sessionId }, 'Built LLM context');

    // Get system prompt separately for the LLM call
    const systemPrompt = await this.getSystemPrompt();

    return await this.llm.complete(fullContext, {
      systemPrompt,
      ...llmOptions,
    });
  }

  /**
   * Get system prompt for this agent type from config/agents/*.system.md
   */
  protected async getSystemPrompt(): Promise<string> {
    if (this.cachedSystemPrompt) {
      return this.cachedSystemPrompt;
    }

    this.cachedSystemPrompt = await this.promptBuilder.getSystemPrompt(this.agentType);
    return this.cachedSystemPrompt;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      agentType: this.agentType,
      status: this.status,
      tasksCompleted: this.tasksCompleted,
      totalExecutionTime: this.totalExecutionTime,
      averageExecutionTime: this.tasksCompleted > 0
        ? this.totalExecutionTime / this.tasksCompleted
        : 0,
    };
  }

  /**
   * Set agent status
   */
  protected setStatus(status: AgentStatus): void {
    this.status = status;
    this.logger.debug({ status }, 'Agent status changed');
  }
}
