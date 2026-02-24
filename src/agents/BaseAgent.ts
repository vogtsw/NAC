/**
 * Base Agent
 * Abstract base class for all agent types
 */

import { LLMClient } from '../llm/LLMClient.js';
import { SkillManager } from '../skills/SkillManager.js';
import { AgentConfig, AgentStatus, ExecutionContext, SkillResult } from '../state/models.js';
import { getLogger, childLogger } from '../monitoring/logger.js';
import { SystemPrompts } from '../llm/prompts.js';

const logger = getLogger('BaseAgent');

/**
 * Abstract base agent class
 */
export abstract class BaseAgent {
  protected logger: ReturnType<typeof childLogger>;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected tasksCompleted: number = 0;
  protected totalExecutionTime: number = 0;

  constructor(
    protected llm: LLMClient,
    protected skillManager: SkillManager,
    public readonly agentType: string
  ) {
    this.logger = childLogger(logger, { agent: agentType });
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
   * Call LLM
   */
  protected async callLLM(prompt: string, options?: any): Promise<string> {
    return await this.llm.complete(prompt, {
      systemPrompt: this.getSystemPrompt(),
      ...options,
    });
  }

  /**
   * Get system prompt for this agent type
   */
  protected getSystemPrompt(): string {
    return SystemPrompts[this.agentType as keyof typeof SystemPrompts] || SystemPrompts.GenericAgent;
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
