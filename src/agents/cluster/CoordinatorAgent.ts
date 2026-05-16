/**
 * CoordinatorAgent
 * High-level agent that decomposes tasks, manages scheduling, merges results, and makes decisions.
 * Uses deepseek-v4-pro with thinking enabled + high reasoning effort.
 */

import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export class CoordinatorAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "CoordinatorAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);
    this.logger.info({ task: task.description?.substring(0, 80) }, "Coordinator executing");

    try {
      const response = await this.callLLM(
        `You are the CoordinatorAgent for a DeepSeek cluster run.
Decompose tasks, manage sub-agent scheduling, merge results, and make decisions.

Task: ${task.description || task.name}

Analyze and produce a structured execution plan.`,
        { temperature: 0.3, maxTokens: 2000 }
      );

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      return { taskId: task.id, result: response, analysis: response, agentType: "CoordinatorAgent" };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
