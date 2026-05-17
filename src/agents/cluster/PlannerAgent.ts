/**
 * PlannerAgent
 * Generates execution DAGs, defines acceptance criteria, and assesses risks.
 * Uses deepseek-v4-pro with thinking enabled + high reasoning effort.
 * Produces a structured PlanArtifact with DAG steps and risk assessment.
 */

import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";
import type { PlanArtifact } from "./CoordinatorAgent.js";

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

Return JSON only with this shape:
{
  "goal": "one-line summary",
  "steps": [
    {
      "id": "step_code",
      "name": "Implement the code change",
      "agentRole": "code_agent",
      "dependencies": ["step_research_0"],
      "expectedOutput": "patch.diff with the fix",
      "estimatedDuration": 120
    }
  ],
  "riskAssessment": "low|medium|high|critical",
  "acceptanceCriteria": [
    "All existing tests pass",
    "New test covers the edge case"
  ],
  "modelAssignment": {
    "code_agent": { "model": "deepseek-v4-pro", "thinking": "enabled", "reasoningEffort": "high" },
    "tester": { "model": "deepseek-v4-flash", "thinking": "enabled", "reasoningEffort": "high" },
    "reviewer": { "model": "deepseek-v4-pro", "thinking": "enabled", "reasoningEffort": "max" }
  }
}`,
        { temperature: 0.3, maxTokens: 2500, responseFormat: 'json' }
      );

      const artifact = this.parsePlanArtifact(response, task);

      this.tasksCompleted++;
      this.totalExecutionTime += task.estimatedDuration || 60;
      this.setStatus(AgentStatus.IDLE);

      return {
        taskId: task.id,
        result: response,
        artifact,
        agentType: "PlannerAgent",
        outputArtifact: task.outputArtifact || "plan",
      };
    } catch (error: any) {
      this.setStatus(AgentStatus.IDLE);
      throw error;
    }
  }

  private parsePlanArtifact(response: string, task: any): PlanArtifact {
    try {
      const blockMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/i);
      const jsonStr = blockMatch ? blockMatch[1].trim() : response;
      const start = jsonStr.indexOf('{');
      const end = jsonStr.lastIndexOf('}');
      const clean = start >= 0 && end > start ? jsonStr.slice(start, end + 1) : jsonStr;
      const parsed = JSON.parse(clean);

      return {
        goal: String(parsed.goal || task.description || task.name),
        steps: Array.isArray(parsed.steps) ? parsed.steps.map((s: any) => ({
          id: String(s.id || ''),
          name: String(s.name || ''),
          agentRole: String(s.agentRole || ''),
          dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
          expectedOutput: String(s.expectedOutput || ''),
          estimatedDuration: Number(s.estimatedDuration) || 30,
        })) : [],
        riskAssessment: ['low', 'medium', 'high', 'critical'].includes(parsed.riskAssessment)
          ? parsed.riskAssessment : 'medium',
        acceptanceCriteria: Array.isArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria.map(String) : [],
        modelAssignment: parsed.modelAssignment || {},
      };
    } catch {
      return {
        goal: task.description || task.name,
        steps: [],
        riskAssessment: 'medium',
        acceptanceCriteria: [],
        modelAssignment: {},
      };
    }
  }
}
