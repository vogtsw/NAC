/**
 * P3: Cluster Integration Tests
 * End-to-end orchestration, repair loops, handoff validation, DAG failure modes.
 */
import { describe, it, expect } from "vitest";
import { TeamBuilder, type TaskProfile } from "../src/orchestrator/TeamBuilder.js";
import { ClusterDAGBuilder, createClusterDAGBuilder } from "../src/orchestrator/ClusterDAGBuilder.js";
import { createHandoff, validateHandoff } from "../src/orchestrator/AgentHandoff.js";
import type {
  PlanArtifact, PatchArtifact, TestReportArtifact, ReviewArtifact,
} from "../src/orchestrator/AgentHandoff.js";
import { ClusterReporter } from "../src/orchestrator/ClusterReporter.js";
import { DAG } from "../src/orchestrator/DAGBuilder.js";
import { DeepSeekModelRouter } from "../src/llm/DeepSeekModelRouter.js";

const mockLLM = { complete: async () => JSON.stringify({ steps: [] }) };

function makeTeamPlan(overrides: any = {}) {
  return {
    runId: `test_${Date.now()}`,
    coordinator: {
      agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
      model: "deepseek-v4-pro", thinking: "enabled" as const,
      reasoningEffort: "high" as const, skills: [],
    },
    members: [
      { agentType: "ResearchAgent", role: "researcher" as const, count: 2,
        model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [] },
      { agentType: "CodeAgent", role: "code_agent" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [] },
      { agentType: "TestAgent", role: "tester" as const, count: 1,
        model: "deepseek-v4-flash", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [] },
    ],
    collaborationMode: "pipeline" as const,
    modelPolicy: {},
    expectedArtifacts: ["plan.json", "patch.diff", "test_report.json"],
    estimatedProTokens: 5000,
    estimatedFlashTokens: 2000,
    estimatedCost: 0.002,
    ...overrides,
  };
}

// ── End-to-End Cluster Orchestration ─────────────────────

describe("Cluster Orchestration E2E", () => {
  it("full pipeline: TeamPlan → ClusterDAG → Executable DAG", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan({ collaborationMode: "pipeline" });

    const clusterDag = builder.build(plan);
    const execDag = builder.toExecutableDAG(clusterDag);

    expect(execDag).toBeInstanceOf(DAG);
    expect(execDag.hasCycle()).toBe(false);
    expect(execDag.getAllTasks().length).toBeGreaterThanOrEqual(4);
  });

  it("self-healing: includes repair + retest steps", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan({
      collaborationMode: "self-healing",
      members: [
        ...makeTeamPlan().members,
        { agentType: "ReviewAgent", role: "reviewer" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "max" as const, skills: [] },
      ],
    });

    const clusterDag = builder.build(plan);
    expect(clusterDag.steps.some(s => s.id === "step_repair")).toBe(true);
    expect(clusterDag.steps.some(s => s.id === "step_code_v2")).toBe(true);
    expect(clusterDag.steps.some(s => s.id === "step_test_v2")).toBe(true);
  });

  it("parallel-research: multiple researchers in parallel", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan({
      collaborationMode: "parallel-research",
      members: [
        { agentType: "ResearchAgent", role: "researcher" as const, count: 4,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [] },
      ],
    });

    const clusterDag = builder.build(plan);
    const researchSteps = clusterDag.steps.filter(s => s.agentRole === "researcher" && s.id.startsWith("step_research_"));
    expect(researchSteps.length).toBe(4);
    expect(clusterDag.maxParallelism).toBeGreaterThanOrEqual(4);
  });

  it("debate-review: includes reviewer agent", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan({
      collaborationMode: "debate-review",
      members: [
        ...makeTeamPlan().members,
        { agentType: "ReviewAgent", role: "reviewer" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "max" as const, skills: [] },
      ],
    });

    const clusterDag = builder.build(plan);
    expect(clusterDag.steps.some(s => s.agentRole === "reviewer")).toBe(true);
  });

  it("map-reduce: generates valid DAG", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan({ collaborationMode: "map-reduce" });

    const clusterDag = builder.build(plan);
    const execDag = builder.toExecutableDAG(clusterDag);
    expect(execDag.isComplete()).toBe(false);
  });
});

// ── AgentHandoff Validation ─────────────────────────────

describe("AgentHandoff Validation", () => {
  it("validates correct artifact type", () => {
    const plan: PlanArtifact = {
      goal: "Test", steps: [], constraints: [], assumptions: [], riskLevel: "low",
    };
    const handoff = createHandoff({
      fromAgent: "P", toAgent: "R", runId: "r1",
      artifactType: "plan", confidence: 0.8, payload: plan, nextAction: "do",
    });
    expect(validateHandoff(handoff, "plan")).toBe(true);
    expect(validateHandoff(handoff, "patch")).toBe(false);
  });

  it("rejects zero-confidence handoff", () => {
    const handoff = createHandoff({
      fromAgent: "A", toAgent: "B", runId: "r", artifactType: "plan",
      confidence: 0, payload: {}, nextAction: "skip",
    });
    expect(validateHandoff(handoff, "plan")).toBe(false);
  });

  it("rejects wrong artifact type", () => {
    const review: ReviewArtifact = {
      overallScore: 8, issues: [], approved: true, suggestions: [], riskLevel: "low",
    };
    const handoff = createHandoff({
      fromAgent: "A", toAgent: "B", runId: "r", artifactType: "review",
      confidence: 0.9, payload: review, nextAction: "merge",
    });
    expect(validateHandoff(handoff, "patch")).toBe(false);
    expect(validateHandoff(handoff, "review")).toBe(true);
  });

  it("handoff carries timestamp and token cost", () => {
    const handoff = createHandoff({
      fromAgent: "CodeAgent", toAgent: "TestAgent", runId: "r2",
      artifactType: "patch", confidence: 0.95,
      payload: { diff: "test" }, nextAction: "test", tokenCost: 2500,
    });
    expect(handoff.timestamp).toBeGreaterThan(0);
    expect(handoff.tokenCost).toBe(2500);
    expect(handoff.fromAgent).toBe("CodeAgent");
  });

  it("patch artifact with breaking changes detected", () => {
    const patch: PatchArtifact = {
      files: [{ path: "src/api.ts", operation: "modify", diff: "- old\n+ new", newContent: "new" }],
      summary: "Breaking API change", breakingChanges: true,
      fileCount: 1, linesAdded: 5, linesRemoved: 10,
    };
    const handoff = createHandoff({
      fromAgent: "CodeAgent", toAgent: "ReviewAgent", runId: "r3",
      artifactType: "patch", confidence: 0.7, payload: patch,
      nextAction: "Review breaking change carefully",
    });
    expect(handoff.payload.breakingChanges).toBe(true);
    expect(handoff.payload.linesAdded).toBe(5);
  });

  it("test report with failures parsed correctly", () => {
    const report: TestReportArtifact = {
      command: "pnpm test", total: 20, passed: 18, failed: 2, skipped: 0,
      duration: 15000,
      failures: [
        { testName: "auth > login", error: "401", suggestion: "Check token" },
        { testName: "user > delete", error: "500", suggestion: "Check DB" },
      ],
    };
    const handoff = createHandoff({
      fromAgent: "TestAgent", toAgent: "CodeAgent", runId: "r4",
      artifactType: "test_report", confidence: 0.9, payload: report,
      nextAction: "Fix 2 failing tests",
    });
    expect(handoff.payload.failed).toBe(2);
    expect(handoff.payload.failures.length).toBe(2);
  });
});

// ── Partial DAG Failure ─────────────────────────────────

describe("DAG Failure Modes", () => {
  it("DAG with missing dependency still builds", () => {
    const builder = createClusterDAGBuilder();
    const plan = makeTeamPlan();
    const clusterDag = builder.build(plan);

    // Simulate partial failure: remove a step
    const brokenDag = new DAG();
    for (const step of clusterDag.steps) {
      if (step.id === "step_test") continue; // skip test step
      brokenDag.addTask({
        id: step.id, name: step.name, description: step.name,
        agentType: "GenericAgent", requiredSkills: [],
        dependencies: step.dependencies.filter(d => d !== "step_test"),
        estimatedDuration: 60,
      });
    }
    expect(brokenDag.hasCycle()).toBe(false);
  });

  it("circular dependency detected", () => {
    const dag = new DAG();
    dag.addTask({ id: "a", name: "A", description: "", agentType: "T",
      requiredSkills: [], dependencies: ["b"], estimatedDuration: 60 });
    dag.addTask({ id: "b", name: "B", description: "", agentType: "T",
      requiredSkills: [], dependencies: ["a"], estimatedDuration: 60 });
    expect(dag.hasCycle()).toBe(true);
  });

  it("DAG with no tasks is complete", () => {
    const dag = new DAG();
    expect(dag.isComplete()).toBe(true);
    expect(dag.getReadyTasks()).toEqual([]);
  });
});

// ── Cluster Reporter Integration ────────────────────────

describe("ClusterReporter Integration", () => {
  it("reports cost with correct model attribution", () => {
    const reporter = new ClusterReporter();
    reporter.start();
    reporter.recordTokenUsage("CodeAgent", {
      promptTokens: 5000, completionTokens: 2000, totalTokens: 7000,
      cacheHitTokens: 3000, cacheMissTokens: 2000,
    });
    reporter.recordTokenUsage("ResearchAgent", {
      promptTokens: 2000, completionTokens: 500, totalTokens: 2500,
      cacheHitTokens: 1000, cacheMissTokens: 1000,
    });

    const plan = makeTeamPlan();
    const builder = createClusterDAGBuilder();
    const clusterDag = builder.build(plan);

    const report = reporter.generateReport({
      runId: plan.runId, teamPlan: plan, clusterDag,
      artifacts: [], status: "completed",
    });

    // Pro tokens should be greater than Flash for this team composition
    expect(report.totalProTokens).toBeGreaterThan(0);
    expect(report.cacheHitRate).toBeCloseTo(0.57, 1); // 4000 hits / 7000 total = ~0.571
    expect(report.status).toBe("completed");
  });
});

// ── TeamBuilder Edge Cases ──────────────────────────────

describe("TeamBuilder Edge Cases", () => {
  it("low complexity task gets fewer researchers", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Simple task", intent: "code",
      capabilities: ["file-ops"], complexity: 1,
    };
    const plan = await builder.buildTeam(task);
    const researcher = plan.members.find(m => m.role === "researcher")!;
    expect(researcher.count).toBeLessThanOrEqual(2);
  });

  it("high complexity task gets more researchers", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Complex multi-module refactor", intent: "code",
      capabilities: ["code-gen", "file-ops", "test"], complexity: 9,
    };
    const plan = await builder.buildTeam(task);
    const researcher = plan.members.find(m => m.role === "researcher")!;
    expect(researcher.count).toBeGreaterThanOrEqual(3);
  });

  it("web search task triggers parallel-research mode", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Search for X", intent: "automation",
      capabilities: ["web-search"], complexity: 3,
    };
    const plan = await builder.buildTeam(task);
    expect(plan.collaborationMode).toBe("parallel-research");
  });

  it("all collaboration modes produce valid teams", async () => {
    const builder = new TeamBuilder(mockLLM);
    const modes = ["pipeline", "parallel-research", "map-reduce", "self-healing", "debate-review"];

    for (const mode of modes) {
      const plan = await builder.buildTeam({
        description: `Test ${mode}`,
        intent: mode === "parallel-research" ? "automation" : "code",
        capabilities: mode === "parallel-research" ? ["web-search"] : ["code-gen"],
        complexity: 5,
      });
      expect(plan.runId).toBeTruthy();
      expect(plan.coordinator).toBeDefined();
      expect(plan.members.length).toBeGreaterThan(0);
    }
  });
});

// ── DeepSeekModelRouter Integration ────────────────────

describe("DeepSeekModelRouter Integration", () => {
  it("critical tasks get max reasoning", () => {
    const router = new DeepSeekModelRouter();
    const decision = router.route({
      role: "code_agent", description: "Security patch",
      riskLevel: "critical",
    });
    expect(decision.policy.reasoningEffort).toBe("max");
  });

  it("Flash roles stay on Flash even for complex tasks", () => {
    const router = new DeepSeekModelRouter();
    const decision = router.route({
      role: "researcher", description: "Complex research",
      estimatedComplexity: "complex",
    });
    expect(decision.policy.model).toBe("deepseek-v4-flash");
  });

  it("override can promote Flash to Pro", () => {
    const router = new DeepSeekModelRouter();
    router.setOverride("researcher", {
      model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "high",
    });
    const decision = router.route({ role: "researcher", description: "Important" });
    expect(decision.policy.model).toBe("deepseek-v4-pro");
    router.clearOverrides();
  });
});
