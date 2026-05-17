/**
 * CoordinatorAgent
 * High-level agent that decomposes tasks, manages scheduling, merges results, and makes decisions.
 * Uses deepseek-v4-pro with thinking enabled + high reasoning effort.
 * Produces a structured PlanArtifact, not raw LLM text.
 */

import { BaseAgent } from "../BaseAgent.js";
import { AgentStatus } from "../../state/models.js";
import type { LLMClient } from "../../llm/LLMClient.js";
import type { SkillManager } from "../../skills/SkillManager.js";

export interface PlanArtifact {
  goal: string;
  steps: Array<{
    id: string;
    name: string;
    agentRole: string;
    dependencies: string[];
    expectedOutput: string;
    estimatedDuration: number;
  }>;
  riskAssessment: 'low' | 'medium' | 'high' | 'critical';
  acceptanceCriteria: string[];
  modelAssignment: Record<string, { model: string; thinking: string; reasoningEffort: string }>;
}

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
Your role: Decompose complex tasks, assign sub-agent roles, define dependencies, assess risks, and produce structured execution plans.

Task: ${task.description || task.name}

Return JSON only with this shape:
{
  "goal": "one-line summary of the objective",
  "steps": [
    {
      "id": "step_plan",
      "name": "Analyze requirements and create execution plan",
      "agentRole": "planner",
      "dependencies": [],
      "expectedOutput": "plan.json with task breakdown",
      "estimatedDuration": 30
    }
  ],
  "riskAssessment": "low|medium|high|critical",
  "acceptanceCriteria": [
    "All tests pass",
    "No security regressions"
  ],
  "modelAssignment": {
    "coordinator": { "model": "deepseek-v4-pro", "thinking": "enabled", "reasoningEffort": "high" },
    "planner": { "model": "deepseek-v4-pro", "thinking": "enabled", "reasoningEffort": "high" },
    "researcher": { "model": "deepseek-v4-flash", "thinking": "disabled", "reasoningEffort": "none" },
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
        analysis: response,
        agentType: "CoordinatorAgent",
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
      // Fallback: wrap raw response as partial plan
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
