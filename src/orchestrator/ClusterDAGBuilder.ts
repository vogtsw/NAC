/**
 * ClusterDAGBuilder
 * Generates role-based DAGs for cluster agent execution.
 * Produces DAGs like: Planner → Research[N] → Aggregator → Code → Test → Review
 */

import { DAG, DAGBuilder } from "./DAGBuilder.js";
import type { CollaborationMode, TeamPlan } from "./TeamBuilder.js";
import type { ArtifactType } from "./AgentHandoff.js";
import type { Intent } from "../state/models.js";
import { getLogger } from "../monitoring/logger.js";

const logger = getLogger("ClusterDAGBuilder");

export interface ClusterStep {
  id: string;
  name: string;
  agentRole: string;
  inputArtifacts: ArtifactType[];
  outputArtifact: ArtifactType;
  dependencies: string[];
  canParallelize: boolean;
  model: "deepseek-v4-pro" | "deepseek-v4-flash";
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

export interface ClusterDAG {
  runId: string;
  mode: CollaborationMode;
  steps: ClusterStep[];
  maxParallelism: number;
  criticalPath: string[];
}

/**
 * Builds cluster-style DAGs with role-based steps.
 */
export class ClusterDAGBuilder {
  private dagBuilder: DAGBuilder;

  constructor(dagBuilder?: DAGBuilder) {
    this.dagBuilder = dagBuilder || new DAGBuilder();
  }

  /**
   * Build a cluster DAG from a team plan.
   */
  build(teamPlan: TeamPlan): ClusterDAG {
    logger.info({ runId: teamPlan.runId, mode: teamPlan.collaborationMode }, "Building cluster DAG");

    const steps = this.generateSteps(teamPlan);
    const criticalPath = this.computeCriticalPath(steps);
    const maxParallelism = this.computeMaxParallelism(steps);

    return {
      runId: teamPlan.runId,
      mode: teamPlan.collaborationMode,
      steps,
      maxParallelism,
      criticalPath,
    };
  }

  /**
   * Convert cluster DAG to executable DAG.
   */
  toExecutableDAG(clusterDag: ClusterDAG): DAG {
    const dag = new DAG();

    for (const step of clusterDag.steps) {
      dag.addTask({
        id: step.id,
        name: step.name,
        description: `[${step.agentRole}] ${step.name}`,
        agentType: this.roleToAgentType(step.agentRole),
        requiredSkills: this.roleToSkills(step.agentRole),
        dependencies: step.dependencies,
        estimatedDuration: this.estimateDuration(step),
        retryPolicy: step.agentRole === "reviewer" || step.agentRole === "tester"
          ? { maxAttempts: 2, timeout: 30000, strategy: "linear" as const }
          : undefined,
      });
    }

    if (dag.hasCycle()) {
      throw new Error("Generated cluster DAG contains circular dependencies");
    }

    return dag;
  }

  private generateSteps(teamPlan: TeamPlan): ClusterStep[] {
    const steps: ClusterStep[] = [];
    const mode = teamPlan.collaborationMode;
    const { runId } = teamPlan;

    // Find member specs
    const coordinator = teamPlan.members.find(m => m.role === "planner");

    // Step 1: Plan (Pro with thinking)
    steps.push({
      id: "step_plan",
      name: "Analyze requirements and create execution plan",
      agentRole: "planner",
      inputArtifacts: [],
      outputArtifact: "plan",
      dependencies: [],
      canParallelize: false,
      model: "deepseek-v4-pro",
      thinking: "enabled",
      reasoningEffort: "high",
    });

    let prevStepId = "step_plan";

    // Step 2: Parallel Research (Flash)
    const researcherSpec = teamPlan.members.find(m => m.role === "researcher");
    if (researcherSpec) {
      const researchStepId = "step_research";
      const partitions = researcherSpec.count > 1
        ? ["src/", "tests/", "config/", "docs/"]
        : ["all"];

      for (let i = 0; i < Math.min(researcherSpec.count, partitions.length); i++) {
        steps.push({
          id: `${researchStepId}_${i}`,
          name: `Scan and summarize ${partitions[i]} code`,
          agentRole: "researcher",
          inputArtifacts: ["plan"],
          outputArtifact: "file_summary",
          dependencies: [prevStepId],
          canParallelize: true,
          model: "deepseek-v4-flash",
          thinking: "disabled",
        });
      }

      // Aggregator step
      steps.push({
        id: "step_aggregate",
        name: "Merge research summaries into repo context",
        agentRole: "researcher",
        inputArtifacts: ["file_summary"],
        outputArtifact: "repo_context",
        dependencies: partitions.slice(0, researcherSpec.count).map((_, i) => `${researchStepId}_${i}`),
        canParallelize: false,
        model: "deepseek-v4-flash",
        thinking: "disabled",
      });

      prevStepId = "step_aggregate";
    }

    // Step 3: Code (Pro)
    const codeSpec = teamPlan.members.find(m => m.role === "code_agent");
    if (codeSpec) {
      steps.push({
        id: "step_code",
        name: "Generate code patch",
        agentRole: "code_agent",
        inputArtifacts: ["repo_context", "plan"],
        outputArtifact: "patch",
        dependencies: [prevStepId],
        canParallelize: false,
        model: "deepseek-v4-pro",
        thinking: "enabled",
        reasoningEffort: "high",
      });
      prevStepId = "step_code";
    }

    // Step 4: Test (Flash)
    const testSpec = teamPlan.members.find(m => m.role === "tester");
    if (testSpec) {
      steps.push({
        id: "step_test",
        name: "Run tests and analyze results",
        agentRole: "tester",
        inputArtifacts: ["patch"],
        outputArtifact: "test_report",
        dependencies: [prevStepId],
        canParallelize: false,
        model: "deepseek-v4-flash",
        thinking: "enabled",
        reasoningEffort: "high",
      });
      prevStepId = "step_test";

      // Failure repair loop (self-healing)
      if (mode === "self-healing") {
        steps.push({
          id: "step_repair",
          name: "Analyze test failures and generate repair hints",
          agentRole: "tester",
          inputArtifacts: ["test_report"],
          outputArtifact: "failure_analysis",
          dependencies: ["step_test"],
          canParallelize: false,
          model: "deepseek-v4-flash",
          thinking: "enabled",
          reasoningEffort: "high",
        });

        steps.push({
          id: "step_code_v2",
          name: "Generate revised patch v2",
          agentRole: "code_agent",
          inputArtifacts: ["failure_analysis", "patch"],
          outputArtifact: "patch",
          dependencies: ["step_repair"],
          canParallelize: false,
          model: "deepseek-v4-pro",
          thinking: "enabled",
          reasoningEffort: "max",
        });

        steps.push({
          id: "step_test_v2",
          name: "Re-run tests on revised patch",
          agentRole: "tester",
          inputArtifacts: ["patch"],
          outputArtifact: "test_report",
          dependencies: ["step_code_v2"],
          canParallelize: false,
          model: "deepseek-v4-flash",
          thinking: "enabled",
          reasoningEffort: "high",
        });

        prevStepId = "step_test_v2";
      }
    }

    // Step 5: Review (Pro with max reasoning)
    const reviewSpec = teamPlan.members.find(m => m.role === "reviewer");
    if (reviewSpec) {
      steps.push({
        id: "step_review",
        name: "Final review of diff, security, and edge cases",
        agentRole: "reviewer",
        inputArtifacts: ["patch", "test_report"],
        outputArtifact: "review",
        dependencies: [
          prevStepId,
          ...(mode === "self-healing" ? ["step_test_v2"] : []),
        ],
        canParallelize: false,
        model: "deepseek-v4-pro",
        thinking: "enabled",
        reasoningEffort: "max",
      });
      prevStepId = "step_review";
    }

    // Final report
    steps.push({
      id: "step_report",
      name: "Generate final cluster run report",
      agentRole: "coordinator",
      inputArtifacts: ["patch", "test_report", "review"],
      outputArtifact: "final_answer",
      dependencies: [prevStepId],
      canParallelize: false,
      model: "deepseek-v4-pro",
      thinking: "enabled",
      reasoningEffort: "high",
    });

    return steps;
  }

  private computeCriticalPath(steps: ClusterStep[]): string[] {
    const path: string[] = [];
    const stepMap = new Map(steps.map(s => [s.id, s]));

    // Find end step and walk backwards
    const endSteps = steps.filter(s =>
      !steps.some(other => other.dependencies.includes(s.id))
    );

    if (endSteps.length === 0) return path;

    let current: ClusterStep | undefined = endSteps[0];
    while (current) {
      path.unshift(current.id);
      const depId: string | undefined = current.dependencies[0];
      current = depId ? stepMap.get(depId) : undefined;
    }

    return path;
  }

  private computeMaxParallelism(steps: ClusterStep[]): number {
    // Max number of steps that can run at the same depth level
    let maxParallel = 0;
    const depLevels = new Map<string, number>();

    const getLevel = (stepId: string): number => {
      if (depLevels.has(stepId)) return depLevels.get(stepId)!;
      const step = steps.find(s => s.id === stepId);
      if (!step) return 0;
      const level = step.dependencies.length === 0
        ? 0
        : 1 + Math.max(...step.dependencies.map(getLevel));
      depLevels.set(stepId, level);
      return level;
    };

    // Compute levels
    for (const step of steps) getLevel(step.id);

    // Count steps per level
    const levelCounts = new Map<number, number>();
    for (const [, level] of depLevels) {
      levelCounts.set(level, (levelCounts.get(level) || 0) + 1);
    }

    for (const count of levelCounts.values()) {
      if (count > maxParallel) maxParallel = count;
    }

    return maxParallel;
  }

  private roleToAgentType(role: string): string {
    const mapping: Record<string, string> = {
      planner: "PlannerAgent",
      coordinator: "CoordinatorAgent",
      researcher: "ResearchAgent",
      code_agent: "CodeAgent",
      tester: "TestAgent",
      reviewer: "ReviewAgent",
    };
    return mapping[role] || "GenericAgent";
  }

  private roleToSkills(role: string): string[] {
    const mapping: Record<string, string[]> = {
      planner: ["planning"],
      coordinator: ["scheduling", "result-aggregation"],
      researcher: ["file-read", "grep", "glob"],
      code_agent: ["code-generation", "file-ops"],
      tester: ["run-tests", "diagnostics"],
      reviewer: ["code-review"],
    };
    return mapping[role] || [];
  }

  private estimateDuration(step: ClusterStep): number {
    const baseTime = 60;
    const multipliers: Record<string, number> = {
      planner: 2,
      coordinator: 1.5,
      researcher: 1,
      code_agent: 3,
      tester: 2,
      reviewer: 2,
    };
    return baseTime * (multipliers[step.agentRole] || 1);
  }
}

export function createClusterDAGBuilder(): ClusterDAGBuilder {
  return new ClusterDAGBuilder();
}
