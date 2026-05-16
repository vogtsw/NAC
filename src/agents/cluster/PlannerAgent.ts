import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export class PlannerAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "PlannerAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      const response = await this.callLLM(
        `You are the PlannerAgent for a DeepSeek cluster run.
Your role: Generate execution DAGs, define acceptance criteria, and assess risks.

Task: ${task.description || task.name}

Produce a step-by-step plan with:
1. Required sub-tasks and their dependencies
2. Expected outputs for each step
3. Risk assessment (low/medium/high/critical)
4. Acceptance criteria`,
        { temperature: 0.3, maxTokens: 2000 }
      );

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      return { taskId: task.id, result: response, agentType: "PlannerAgent" };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
