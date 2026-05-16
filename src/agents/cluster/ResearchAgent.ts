import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export class ResearchAgent extends BaseAgent {
  constructor(llm: LLMClient, skillManager: SkillManager) {
    super(llm, skillManager, "ResearchAgent");
  }

  async execute(task: any): Promise<any> {
    this.setStatus(AgentStatus.BUSY);

    try {
      const response = await this.callLLM(
        `You are a ResearchAgent running on deepseek-v4-flash for low-cost parallel exploration.
Your role: Scan directories, read files, grep for patterns, and produce structured file summaries.

Task: ${task.description || task.name}
Target directory: ${task.target || "src/"}

Produce a structured summary with:
1. Key files found and their purposes
2. Dependencies and imports
3. Notable patterns or potential issues`,
        { temperature: 0.2, maxTokens: 1500 }
      );

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 45;
      this.setStatus(AgentStatus.IDLE);

      return { taskId: task.id, result: response, agentType: "ResearchAgent" };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }
}
