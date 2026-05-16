import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export class ReviewAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "ReviewAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      const response = await this.callLLM(
        `You are the ReviewAgent for a DeepSeek cluster run, using Pro with max reasoning effort.
Your role: Final review of diffs, security analysis, edge case detection, and correctness verification.

Task: ${task.description || task.name}
Patch: ${task.patch ? JSON.stringify(task.patch).substring(0, 2000) : "no patch provided"}

Review for:
1. SECURITY: injection vectors, auth bypasses, data exposure
2. CORRECTNESS: logic errors, edge cases, race conditions
3. PERFORMANCE: resource leaks, algorithmic issues
4. STYLE: consistency with project conventions

Provide a severity-ranked list (critical/major/minor/info) with suggested fixes.`,
        { temperature: 0.2, maxTokens: 2500 }
      );

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      return { taskId: task.id, result: response, agentType: "ReviewAgent" };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
