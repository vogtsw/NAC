/**
 * TeamBuilder
 * Upgrades AgentRouter to build DeepSeek-optimized agent teams.
 * Supports model policy routing (Pro/Flash), collaboration modes, and cluster team plans.
 */

import { LLMClient } from "../llm/LLMClient.js";
import type { DeepSeekModelPolicy } from "../llm/DeepSeekModelPolicy.js";
import { DeepSeekModelRouter, type ClusterRole } from "../llm/DeepSeekModelRouter.js";
import { AgentRouter } from "./AgentRouter.js";
import { getAgentRegistry } from "./AgentRegistry.js";
import { getLogger } from "../monitoring/logger.js";

const logger = getLogger("TeamBuilder");

export type CollaborationMode =
  | "pipeline"
  | "parallel-research"
  | "map-reduce"
  | "self-healing"
  | "debate-review";

export interface AgentSpec {
  agentType: string;
  role: ClusterRole;
  count: number;
  model: string;
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  skills: string[];
}

export interface TeamPlan {
  runId: string;
  coordinator: AgentSpec;
  members: AgentSpec[];
  collaborationMode: CollaborationMode;
  modelPolicy: Record<string, DeepSeekModelPolicy>;
  expectedArtifacts: string[];
  estimatedProTokens: number;
  estimatedFlashTokens: number;
  estimatedCost: number;
}

export interface TaskProfile {
  description: string;
  intent: string;
  capabilities: string[];
  complexity: number;
  riskLevel?: "low" | "medium" | "high" | "critical";
}

export class TeamBuilder {
  private router: DeepSeekModelRouter;

  constructor(private llm: LLMClient) {
    this.router = new DeepSeekModelRouter();
  }

  /**
   * Build a team plan for the given task.
   */
  async buildTeam(task: TaskProfile): Promise<TeamPlan> {
    logger.info({ task: task.description.substring(0, 80) }, "Building team");

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Determine best collaboration mode
    const mode = this.determineCollaborationMode(task);

    // Build agent specs from the mode
    const coordinator = this.buildCoordinatorSpec(runId);
    const members = this.buildMemberSpecs(mode, task);
    const modelPolicy = this.buildModelPolicy(coordinator, members);
    const expectedArtifacts = this.determineExpectedArtifacts(mode, task);

    // Estimate costs
    const estimatedProTokens = this.estimateProTokens(task, mode, members);
    const estimatedFlashTokens = this.estimateFlashTokens(task, mode, members);
    const estimatedCost = this.calculateEstimatedCost(modelPolicy, estimatedProTokens, estimatedFlashTokens);

    const plan: TeamPlan = {
      runId,
      coordinator,
      members,
      collaborationMode: mode,
      modelPolicy,
      expectedArtifacts,
      estimatedProTokens,
      estimatedFlashTokens,
      estimatedCost,
    };

    logger.info({ runId, mode, memberCount: members.length,
      estimatedCost: `$${estimatedCost.toFixed(4)}` }, "Team plan built");

    return plan;
  }

  private determineCollaborationMode(task: TaskProfile): CollaborationMode {
    if (task.capabilities.includes("web-search") || task.capabilities.includes("information-retrieval")) {
      return "parallel-research";
    }
    if (task.complexity >= 8 || task.riskLevel === "critical") {
      return "self-healing";
    }
    if (task.complexity >= 6) {
      return "pipeline";
    }
    if (task.description.toLowerCase().includes("review") || task.description.toLowerCase().includes("audit")) {
      return "debate-review";
    }
    return "map-reduce";
  }

  private buildCoordinatorSpec(runId: string): AgentSpec {
    const policy = this.router.route({
      role: "coordinator",
      description: `Coordinate cluster run ${runId}`,
      riskLevel: "medium",
    }).policy;

    return {
      agentType: "CoordinatorAgent",
      role: "coordinator",
      count: 1,
      model: policy.model,
      thinking: policy.thinking,
      reasoningEffort: policy.reasoningEffort,
      skills: ["planning", "scheduling", "result-aggregation"],
    };
  }

  private buildMemberSpecs(mode: CollaborationMode, task: TaskProfile): AgentSpec[] {
    const members: AgentSpec[] = [];

    // Researcher agents (always Flash for low-cost parallel work)
    const researcherCount = task.complexity >= 7 ? 4 : task.complexity >= 4 ? 3 : 2;
    const researcherPolicy = this.router.route({
      role: "researcher",
      description: task.description,
    }).policy;
    members.push({
      agentType: "ResearchAgent",
      role: "researcher",
      count: researcherCount,
      model: researcherPolicy.model,
      thinking: researcherPolicy.thinking,
      reasoningEffort: researcherPolicy.reasoningEffort,
      skills: ["file-read", "grep", "glob", "web-search"],
    });

    // Planner agent for complex tasks
    if (task.complexity >= 4) {
      const plannerPolicy = this.router.route({
        role: "planner",
        description: task.description,
      }).policy;
      members.push({
        agentType: "PlannerAgent",
        role: "planner",
        count: 1,
        model: plannerPolicy.model,
        thinking: plannerPolicy.thinking,
        reasoningEffort: plannerPolicy.reasoningEffort,
        skills: ["planning", "dag-generation"],
      });
    }

    // Code agent for coding tasks
    if (mode !== "parallel-research" && mode !== "debate-review") {
      const codePolicy = this.router.route({
        role: "code_agent",
        description: task.description,
        riskLevel: task.riskLevel,
      }).policy;
      members.push({
        agentType: "CodeAgent",
        role: "code_agent",
        count: 1,
        model: codePolicy.model,
        thinking: codePolicy.thinking,
        reasoningEffort: codePolicy.reasoningEffort,
        skills: ["code-generation", "file-ops", "apply-patch"],
      });
    }

    // Tester for pipeline/self-healing modes
    if (mode === "pipeline" || mode === "self-healing") {
      const testPolicy = this.router.route({
        role: "tester",
        description: task.description,
      }).policy;
      members.push({
        agentType: "TestAgent",
        role: "tester",
        count: 1,
        model: testPolicy.model,
        thinking: testPolicy.thinking,
        reasoningEffort: testPolicy.reasoningEffort,
        skills: ["run-tests", "diagnostics", "test-log-analysis"],
      });
    }

    // Reviewer for debate-review and self-healing modes
    if (mode === "debate-review" || mode === "self-healing") {
      const reviewPolicy = this.router.route({
        role: "reviewer",
        description: task.description,
        riskLevel: "high",
      }).policy;
      members.push({
        agentType: "ReviewAgent",
        role: "reviewer",
        count: 1,
        model: reviewPolicy.model,
        thinking: reviewPolicy.thinking,
        reasoningEffort: reviewPolicy.reasoningEffort,
        skills: ["code-review", "security-audit", "diff-analysis"],
      });
    }

    return members;
  }

  private buildModelPolicy(
    coordinator: AgentSpec,
    members: AgentSpec[],
  ): Record<string, DeepSeekModelPolicy> {
    const policies: Record<string, DeepSeekModelPolicy> = {};

    const toPolicy = (spec: AgentSpec): DeepSeekModelPolicy => ({
      model: spec.model as "deepseek-v4-pro" | "deepseek-v4-flash",
      thinking: spec.thinking || "enabled",
      reasoningEffort: spec.reasoningEffort,
    });

    policies[coordinator.agentType] = toPolicy(coordinator);

    for (const m of members) {
      policies[m.agentType] = toPolicy(m);
    }

    return policies;
  }

  private determineExpectedArtifacts(
    mode: CollaborationMode,
    task: TaskProfile,
  ): string[] {
    const artifacts: string[] = [];

    if (task.complexity >= 4) {
      artifacts.push("plan.json");
    }

    if (mode === "parallel-research" || mode === "map-reduce") {
      artifacts.push("repo_context.json");
      artifacts.push("summary_report.md");
    }

    if (mode === "pipeline" || mode === "self-healing") {
      artifacts.push("patch.diff");
      artifacts.push("test_report.json");
    }

    if (mode === "self-healing") {
      artifacts.push("repair_hint.json");
    }

    if (mode === "debate-review" || mode === "self-healing") {
      artifacts.push("review_report.json");
    }

    return artifacts;
  }

  private estimateProTokens(task: TaskProfile, mode: CollaborationMode, members: AgentSpec[]): number {
    const baseTokens = task.description.length * 2;
    const complexityMultiplier = 1 + (task.complexity / 10) * 0.5;
    const proMemberCount = members.filter(m => m.model === "deepseek-v4-pro").length + 1; // +1 for coordinator
    return Math.round(baseTokens * complexityMultiplier * proMemberCount * 2000);
  }

  private estimateFlashTokens(task: TaskProfile, mode: CollaborationMode, members: AgentSpec[]): number {
    const baseTokens = task.description.length * 2;
    const flashMemberCount = members.filter(m => m.model === "deepseek-v4-flash").length;
    return Math.round(baseTokens * flashMemberCount * 1000);
  }

  private calculateEstimatedCost(
    policies: Record<string, DeepSeekModelPolicy>,
    proTokens: number,
    flashTokens: number,
  ): number {
    const proPricing = { prompt: 0.14, completion: 0.42 }; // $/1M tokens
    const flashPricing = { prompt: 0.04, completion: 0.12 };

    const proPromptCost = (proTokens * 0.6 / 1_000_000) * proPricing.prompt;
    const proCompletionCost = (proTokens * 0.4 / 1_000_000) * proPricing.completion;
    const flashPromptCost = (flashTokens * 0.7 / 1_000_000) * flashPricing.prompt;
    const flashCompletionCost = (flashTokens * 0.3 / 1_000_000) * flashPricing.completion;

    return Math.round((proPromptCost + proCompletionCost + flashPromptCost + flashCompletionCost) * 10000) / 10000;
  }

  /**
   * Format the team plan as a human-readable display string.
   */
  displayTeamPlan(plan: TeamPlan): string {
    let out = "";
    out += `\nNAC DeepSeek Cluster Team\n`;
    out += `${"=".repeat(40)}\n\n`;
    out += `Run ID: ${plan.runId}\n`;
    out += `Mode: ${plan.collaborationMode}\n`;
    out += `\nCoordinator:\n`;
    out += `  - ${plan.coordinator.agentType} / ${plan.coordinator.model} / `;
    out += `thinking: ${plan.coordinator.thinking || "enabled"} `;
    out += `(effort: ${plan.coordinator.reasoningEffort || "high"})\n`;
    out += `\nWorkers:\n`;

    for (const m of plan.members) {
      out += `  - ${m.count}x ${m.agentType} / ${m.model} / `;
      out += `thinking: ${m.thinking || "enabled"}\n`;
    }

    out += `\nEstimated:\n`;
    out += `  Pro tokens: ${plan.estimatedProTokens.toLocaleString()}\n`;
    out += `  Flash tokens: ${plan.estimatedFlashTokens.toLocaleString()}\n`;
    out += `  Cost: $${plan.estimatedCost.toFixed(4)}\n`;

    return out;
  }
}

export function createTeamBuilder(llm: LLMClient): TeamBuilder {
  return new TeamBuilder(llm);
}
