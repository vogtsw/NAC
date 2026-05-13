/**
 * DeepSeek Cluster Agent Tests
 * Tests for Phase 1 (DeepSeek API Adapter) and Phase 2 (Cluster Runtime) modules.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DeepSeekModelRouter } from "../src/llm/DeepSeekModelRouter.js";
import type { ClusterRole, ClusterTask } from "../src/llm/DeepSeekModelRouter.js";
import { ROLE_MODEL_POLICIES } from "../src/llm/DeepSeekModelPolicy.js";
import { TeamBuilder, type TaskProfile } from "../src/orchestrator/TeamBuilder.js";
import { ClusterDAGBuilder, createClusterDAGBuilder } from "../src/orchestrator/ClusterDAGBuilder.js";
import { createHandoff, validateHandoff } from "../src/orchestrator/AgentHandoff.js";
import type {
  PlanArtifact,
  PatchArtifact,
  TestReportArtifact,
  ReviewArtifact,
} from "../src/orchestrator/AgentHandoff.js";
import { ClusterReporter } from "../src/orchestrator/ClusterReporter.js";
import { DAG } from "../src/orchestrator/DAGBuilder.js";

// ── DeepSeekModelRouter ────────────────────────────────────

describe("DeepSeekModelRouter", () => {
  let router: DeepSeekModelRouter;

  beforeEach(() => {
    router = new DeepSeekModelRouter();
  });

  it("routes coordinator to Pro with high reasoning", () => {
    const task: ClusterTask = {
      role: "coordinator",
      description: "Coordinate a multi-agent code review",
    };
    const decision = router.route(task);
    expect(decision.policy.model).toBe("deepseek-v4-pro");
    expect(decision.policy.thinking).toBe("enabled");
    expect(decision.policy.reasoningEffort).toBe("high");
  });

  it("routes researcher to Flash", () => {
    const task: ClusterTask = {
      role: "researcher",
      description: "Summarize src/ directory files",
    };
    const decision = router.route(task);
    expect(decision.policy.model).toBe("deepseek-v4-flash");
    expect(decision.policy.thinking).toBe("enabled");
    expect(decision.policy.reasoningEffort).toBe("high");
  });

  it("routes summarizer to Flash with thinking disabled", () => {
    const task: ClusterTask = {
      role: "summarizer",
      description: "Summarize test logs",
    };
    const decision = router.route(task);
    expect(decision.policy.model).toBe("deepseek-v4-flash");
    expect(decision.policy.thinking).toBe("disabled");
  });

  it("routes reviewer to Pro with max reasoning", () => {
    const task: ClusterTask = {
      role: "reviewer",
      description: "Final code review before merge",
    };
    const decision = router.route(task);
    expect(decision.policy.model).toBe("deepseek-v4-pro");
    expect(decision.policy.reasoningEffort).toBe("max");
  });

  it("upgrades to max reasoning for critical risk", () => {
    const task: ClusterTask = {
      role: "code_agent",
      description: "Security patch for auth vulnerability",
      riskLevel: "critical",
    };
    const decision = router.route(task);
    expect(decision.policy.reasoningEffort).toBe("max");
    expect(decision.policy.thinking).toBe("enabled");
  });

  it("uses overrides when set", () => {
    router.setOverride("researcher", {
      model: "deepseek-v4-pro",
      thinking: "enabled",
      reasoningEffort: "max",
    });
    const task: ClusterTask = {
      role: "researcher",
      description: "Override test",
    };
    const decision = router.route(task);
    expect(decision.policy.model).toBe("deepseek-v4-pro");
    expect(decision.reason).toContain("Override");
    router.clearOverrides();
  });

  it("generates team model plan for pipeline mode", () => {
    const plan = router.generateTeamModelPlan({ mode: "pipeline" });
    expect(plan.coordinator.model).toBe("deepseek-v4-pro");
    expect(plan.members.some(m => m.role === "researcher")).toBe(true);
    expect(plan.members.some(m => m.role === "code_agent")).toBe(true);
    expect(plan.members.some(m => m.role === "tester")).toBe(true);
  });

  it("generates team model plan for self-healing mode", () => {
    const plan = router.generateTeamModelPlan({ mode: "self-healing" });
    expect(plan.members.some(m => m.role === "reviewer")).toBe(true);
    // Self-healing has extra tester for failure analysis
    const testers = plan.members.filter(m => m.role === "tester");
    expect(testers.length).toBeGreaterThanOrEqual(1);
  });

  it("estimates cost for Pro vs Flash", () => {
    const proCost = router.estimateCost(
      { model: "deepseek-v4-pro", thinking: "enabled" },
      10000, 5000
    );
    const flashCost = router.estimateCost(
      { model: "deepseek-v4-flash", thinking: "disabled" },
      10000, 5000
    );
    expect(proCost.totalCost).toBeGreaterThan(flashCost.totalCost);
  });

  it("all default roles have valid policies", () => {
    const roles: ClusterRole[] = [
      "coordinator", "planner", "researcher", "code_agent",
      "tester", "reviewer", "summarizer",
    ];
    for (const role of roles) {
      expect(ROLE_MODEL_POLICIES[role]).toBeDefined();
      expect(ROLE_MODEL_POLICIES[role].model).toBeDefined();
      expect(ROLE_MODEL_POLICIES[role].thinking).toBeDefined();
    }
  });
});

// ── AgentHandoff ────────────────────────────────────────────

describe("AgentHandoff", () => {
  it("creates a typed handoff", () => {
    const plan: PlanArtifact = {
      goal: "Fix failing tests",
      steps: [
        { id: "1", name: "Analyze", description: "Analyze failures", agentRole: "researcher", dependencies: [], expectedOutput: "analysis.md" },
      ],
      constraints: [],
      assumptions: [],
      riskLevel: "low",
    };

    const handoff = createHandoff({
      fromAgent: "PlannerAgent",
      toAgent: "ResearcherAgent",
      runId: "run_001",
      artifactType: "plan",
      confidence: 0.95,
      payload: plan,
      nextAction: "Summarize the src/ directory",
      tokenCost: 1500,
    });

    expect(handoff.fromAgent).toBe("PlannerAgent");
    expect(handoff.toAgent).toBe("ResearcherAgent");
    expect(handoff.artifactType).toBe("plan");
    expect(handoff.confidence).toBe(0.95);
    expect(handoff.timestamp).toBeGreaterThan(0);
    expect(handoff.nextAction).toBeTruthy();
  });

  it("validates handoff type", () => {
    const handoff = createHandoff({
      fromAgent: "A", toAgent: "B", runId: "run",
      artifactType: "patch", confidence: 0.9,
      payload: { diff: "test" },
      nextAction: "apply",
    });
    expect(validateHandoff(handoff, "patch")).toBe(true);
    expect(validateHandoff(handoff, "review")).toBe(false);
  });

  it("rejects zero-confidence handoffs", () => {
    const handoff = createHandoff({
      fromAgent: "A", toAgent: "B", runId: "run",
      artifactType: "plan", confidence: 0,
      payload: {}, nextAction: "skip",
    });
    expect(validateHandoff(handoff, "plan")).toBe(false);
  });

  it("creates patch artifact correctly", () => {
    const patch: PatchArtifact = {
      files: [{
        path: "src/main.ts",
        operation: "modify",
        diff: "+ console.log('fixed')",
        newContent: "console.log('fixed')",
      }],
      summary: "Fixed logging bug",
      breakingChanges: false,
      fileCount: 1,
      linesAdded: 1,
      linesRemoved: 0,
    };

    const handoff = createHandoff({
      fromAgent: "CodeAgent", toAgent: "TestAgent",
      runId: "run_002", artifactType: "patch",
      confidence: 0.9, payload: patch,
      nextAction: "Run tests on this patch",
    });

    expect(handoff.payload.files[0].path).toBe("src/main.ts");
    expect(handoff.payload.breakingChanges).toBe(false);
  });

  it("creates test report with failures", () => {
    const report: TestReportArtifact = {
      command: "pnpm test",
      total: 10, passed: 9, failed: 1, skipped: 0,
      duration: 5000,
      failures: [{
        testName: "auth.test.ts > login",
        error: "Expected 200, got 401",
        suggestion: "Check auth middleware",
      }],
    };

    const handoff = createHandoff({
      fromAgent: "TestAgent", toAgent: "CodeAgent",
      runId: "run_003", artifactType: "test_report",
      confidence: 0.95, payload: report,
      nextAction: "Fix the auth test failure",
    });

    expect(handoff.payload.failed).toBe(1);
    expect(handoff.payload.failures[0].testName).toContain("auth");
  });

  it("creates review artifact with issues", () => {
    const review: ReviewArtifact = {
      overallScore: 7.5,
      issues: [
        {
          severity: "major",
          category: "security",
          description: "Missing input validation on userId param",
          location: "src/routes/users.ts:42",
          suggestedFix: "Add zod schema validation",
        },
        {
          severity: "minor",
          category: "style",
          description: "Inconsistent naming convention",
          location: "src/utils/helpers.ts:15",
        },
      ],
      approved: false,
      suggestions: ["Fix security issue before merge"],
      riskLevel: "medium",
    };

    const handoff = createHandoff({
      fromAgent: "ReviewAgent", toAgent: "CodeAgent",
      runId: "run_004", artifactType: "review",
      confidence: 0.85, payload: review,
      nextAction: "Fix the major security issue",
    });

    expect(handoff.payload.overallScore).toBe(7.5);
    expect(handoff.payload.issues.length).toBe(2);
    expect(handoff.payload.issues[0].severity).toBe("major");
  });
});

// ── TeamBuilder ─────────────────────────────────────────────

describe("TeamBuilder", () => {
  let mockLLM: any;

  beforeEach(() => {
    mockLLM = {
      complete: async () => JSON.stringify({ steps: [] }),
      completeJSON: async () => ({ steps: [] }),
    };
  });

  it("builds team for simple task", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Summarize the project README",
      intent: "analysis",
      capabilities: ["file-ops"],
      complexity: 2,
    };

    const plan = await builder.buildTeam(task);
    expect(plan.runId).toBeTruthy();
    expect(plan.collaborationMode).toBeDefined();
    expect(plan.coordinator.agentType).toBe("CoordinatorAgent");
    expect(plan.coordinator.model).toBe("deepseek-v4-pro");
    expect(plan.members.length).toBeGreaterThan(0);
    // Should have researchers (always)
    expect(plan.members.some(m => m.role === "researcher")).toBe(true);
    // Low complexity = Flash model for researchers
    const researcher = plan.members.find(m => m.role === "researcher")!;
    expect(researcher.model).toBe("deepseek-v4-flash");
  });

  it("builds pipeline team for complex coding task", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Implement user authentication with JWT and OAuth2",
      intent: "code",
      capabilities: ["code-gen", "file-ops"],
      complexity: 7,
      riskLevel: "high",
    };

    const plan = await builder.buildTeam(task);
    expect(plan.collaborationMode).not.toBe("parallel-research");
    // Should have code agent and tester
    expect(plan.members.some(m => m.role === "code_agent")).toBe(true);
    expect(plan.members.some(m => m.role === "tester")).toBe(true);
  });

  it("builds parallel-research team for search tasks", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Search for latest state of XZ vulnerability",
      intent: "automation",
      capabilities: ["web-search", "information-retrieval"],
      complexity: 3,
    };

    const plan = await builder.buildTeam(task);
    expect(plan.collaborationMode).toBe("parallel-research");
  });

  it("increases researcher count with complexity", async () => {
    const builder = new TeamBuilder(mockLLM);
    const simpleTask: TaskProfile = {
      description: "Simple task",
      intent: "code", capabilities: ["file-ops"], complexity: 2,
    };
    const complexTask: TaskProfile = {
      description: "Complex task",
      intent: "code", capabilities: ["code-gen"], complexity: 8,
    };

    const simplePlan = await builder.buildTeam(simpleTask);
    const complexPlan = await builder.buildTeam(complexTask);
    const simpleResearchers = simplePlan.members.find(m => m.role === "researcher")!;
    const complexResearchers = complexPlan.members.find(m => m.role === "researcher")!;
    expect(complexResearchers.count).toBeGreaterThanOrEqual(simpleResearchers.count);
  });

  it("estimates costs in team plan", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Medium complexity code task",
      intent: "code", capabilities: ["code-gen"], complexity: 5,
    };
    const plan = await builder.buildTeam(task);
    expect(plan.estimatedProTokens).toBeGreaterThan(0);
    expect(plan.estimatedFlashTokens).toBeGreaterThan(0);
    expect(plan.estimatedCost).toBeGreaterThan(0);
    expect(plan.estimatedCost).toBeLessThan(1); // Should be cents not dollars for a single task
  });

  it("expected artifacts include plan and patch for pipeline mode", async () => {
    const builder = new TeamBuilder(mockLLM);
    const task: TaskProfile = {
      description: "Fix a bug in user service",
      intent: "code", capabilities: ["code-gen"], complexity: 6,
    };
    const plan = await builder.buildTeam(task);
    expect(plan.expectedArtifacts).toContain("plan.json");
    // High complexity code task should generate patch
    const hasPatchOrContext = plan.expectedArtifacts.some(a =>
      a.includes("patch") || a.includes("context")
    );
    expect(hasPatchOrContext).toBe(true);
  });
});

// ── ClusterDAGBuilder ───────────────────────────────────────

describe("ClusterDAGBuilder", () => {
  it("builds cluster DAG from team plan", () => {
    const builder = createClusterDAGBuilder();
    const teamPlan = {
      runId: "test_run",
      coordinator: {
        agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent", role: "researcher" as const, count: 2,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
        },
        {
          agentType: "CodeAgent", role: "code_agent" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "TestAgent", role: "tester" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "ReviewAgent", role: "reviewer" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "max" as const, skills: [],
        },
      ],
      collaborationMode: "pipeline" as const,
      modelPolicy: {},
      expectedArtifacts: [],
      estimatedProTokens: 10000,
      estimatedFlashTokens: 5000,
      estimatedCost: 0.005,
    };

    const clusterDag = builder.build(teamPlan);
    expect(clusterDag.runId).toBe("test_run");
    expect(clusterDag.mode).toBe("pipeline");
    expect(clusterDag.steps.length).toBeGreaterThan(0);

    // First step should be plan
    expect(clusterDag.steps[0].agentRole).toBe("planner");
    expect(clusterDag.steps[0].model).toBe("deepseek-v4-pro");

    // Should have research steps
    const researchSteps = clusterDag.steps.filter(s => s.agentRole === "researcher");
    expect(researchSteps.length).toBeGreaterThan(0);
    expect(researchSteps.every(s => s.model === "deepseek-v4-flash")).toBe(true);

    // Should have code step
    expect(clusterDag.steps.some(s => s.agentRole === "code_agent")).toBe(true);
  });

  it("converts cluster DAG to executable DAG", () => {
    const builder = createClusterDAGBuilder();
    const teamPlan = {
      runId: "test_run",
      coordinator: {
        agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent", role: "researcher" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
        },
        {
          agentType: "CodeAgent", role: "code_agent" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "TestAgent", role: "tester" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
      ],
      collaborationMode: "pipeline" as const,
      modelPolicy: {},
      expectedArtifacts: [],
      estimatedProTokens: 5000,
      estimatedFlashTokens: 2000,
      estimatedCost: 0.002,
    };

    const clusterDag = builder.build(teamPlan);
    const executableDag = builder.toExecutableDAG(clusterDag);

    expect(executableDag).toBeInstanceOf(DAG);
    expect(executableDag.isComplete()).toBe(false);
    expect(executableDag.getReadyTasks().length).toBeGreaterThan(0);
    expect(executableDag.hasCycle()).toBe(false);
  });

  it("self-healing mode includes repair and re-test steps", () => {
    const builder = createClusterDAGBuilder();
    const teamPlan = {
      runId: "test_run",
      coordinator: {
        agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent", role: "researcher" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
        },
        {
          agentType: "CodeAgent", role: "code_agent" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "TestAgent", role: "tester" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "ReviewAgent", role: "reviewer" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "max" as const, skills: [],
        },
      ],
      collaborationMode: "self-healing" as const,
      modelPolicy: {},
      expectedArtifacts: [],
      estimatedProTokens: 15000,
      estimatedFlashTokens: 8000,
      estimatedCost: 0.008,
    };

    const clusterDag = builder.build(teamPlan);
    // Self-healing should have repair step and code_v2/test_v2
    expect(clusterDag.steps.some(s => s.id === "step_repair")).toBe(true);
    expect(clusterDag.steps.some(s => s.id === "step_code_v2")).toBe(true);
    expect(clusterDag.steps.some(s => s.id === "step_test_v2")).toBe(true);
  });

  it("computes max parallelism correctly", () => {
    const builder = createClusterDAGBuilder();
    const teamPlan = {
      runId: "test_run",
      coordinator: {
        agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent", role: "researcher" as const, count: 4,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
        },
      ],
      collaborationMode: "parallel-research" as const,
      modelPolicy: {},
      expectedArtifacts: [],
      estimatedProTokens: 5000,
      estimatedFlashTokens: 5000,
      estimatedCost: 0.002,
    };

    const clusterDag = builder.build(teamPlan);
    // 4 parallel research steps + aggregation
    expect(clusterDag.maxParallelism).toBeGreaterThanOrEqual(4);
  });
});

// ── ClusterReporter ─────────────────────────────────────────

describe("ClusterReporter", () => {
  it("starts tracking and records steps", () => {
    const reporter = new ClusterReporter();
    reporter.start();
    reporter.recordStepStart("step_plan");
    reporter.recordStepComplete("step_plan", 500);
    reporter.recordStepStart("step_code");
    reporter.recordStepFail("step_code");

    const report = reporter.generateReport({
      runId: "run_test",
      teamPlan: {
        runId: "run_test",
        coordinator: {
          agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        members: [
          {
            agentType: "CodeAgent", role: "code_agent" as const, count: 1,
            model: "deepseek-v4-pro", thinking: "enabled" as const,
            reasoningEffort: "high" as const, skills: [],
          },
        ],
        collaborationMode: "pipeline",
        modelPolicy: {},
        expectedArtifacts: [],
        estimatedProTokens: 1000,
        estimatedFlashTokens: 0,
        estimatedCost: 0.001,
      },
      clusterDag: {
        runId: "run_test",
        mode: "pipeline",
        steps: [
          {
            id: "step_plan", name: "Plan", agentRole: "planner",
            inputArtifacts: [], outputArtifact: "plan", dependencies: [],
            canParallelize: false, model: "deepseek-v4-pro",
            thinking: "enabled", reasoningEffort: "high",
          },
          {
            id: "step_code", name: "Code", agentRole: "code_agent",
            inputArtifacts: ["plan"], outputArtifact: "patch",
            dependencies: ["step_plan"], canParallelize: false,
            model: "deepseek-v4-pro", thinking: "enabled", reasoningEffort: "high",
          },
        ],
        maxParallelism: 1,
        criticalPath: ["step_plan", "step_code"],
      },
      artifacts: [],
      status: "failed",
    });

    expect(report.runId).toBe("run_test");
    expect(report.status).toBe("failed");
    expect(report.timeline.length).toBe(4);
    expect(report.timeline[0].event).toBe("start");
    expect(report.timeline[3].event).toBe("fail");
    expect(report.workers.length).toBeGreaterThan(0);
  });

  it("calculates cache hit rate", () => {
    const reporter = new ClusterReporter();
    reporter.start();
    reporter.recordTokenUsage("CodeAgent", {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheHitTokens: 800,
      cacheMissTokens: 200,
    });

    const report = reporter.generateReport({
      runId: "run_test",
      teamPlan: {
        runId: "run_test",
        coordinator: {
          agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        members: [],
        collaborationMode: "pipeline",
        modelPolicy: {},
        expectedArtifacts: [],
        estimatedProTokens: 1000,
        estimatedFlashTokens: 0,
        estimatedCost: 0.001,
      },
      clusterDag: {
        runId: "run_test", mode: "pipeline", steps: [],
        maxParallelism: 1, criticalPath: [],
      },
      artifacts: [],
      status: "completed",
    });

    expect(report.cacheHitRate).toBe(0.8); // 800/1000
  });

  it("generates display report without errors", () => {
    const reporter = new ClusterReporter();
    reporter.start();

    const report = reporter.generateReport({
      runId: "run_display",
      teamPlan: {
        runId: "run_display",
        coordinator: {
          agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        members: [
          {
            agentType: "ResearchAgent", role: "researcher" as const, count: 2,
            model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
          },
        ],
        collaborationMode: "parallel-research",
        modelPolicy: {},
        expectedArtifacts: ["repo_context.json"],
        estimatedProTokens: 2000,
        estimatedFlashTokens: 3000,
        estimatedCost: 0.003,
      },
      clusterDag: {
        runId: "run_display", mode: "parallel-research",
        steps: [
          {
            id: "step_1", name: "Research src/", agentRole: "researcher",
            inputArtifacts: [], outputArtifact: "file_summary", dependencies: [],
            canParallelize: true, model: "deepseek-v4-flash",
            thinking: "disabled",
          },
        ],
        maxParallelism: 1, criticalPath: [],
      },
      artifacts: [],
      status: "completed",
    });

    const display = reporter.displayReport(report);
    expect(display).toContain("NAC DeepSeek Cluster Report");
    expect(display).toContain("run_display");
    expect(display).toContain("COMPLETED");
    expect(display).toContain("$");
  });
});

// ── Integration: Full team plan → cluster DAG → executable DAG ─

describe("Integration: TeamPlan → ClusterDAG → Execution", () => {
  it("full pipeline generates valid executable DAG", () => {
    const teamBuilder = new TeamBuilder({
      complete: async () => JSON.stringify({ steps: [] }),
    });
    const dagBuilder = createClusterDAGBuilder();

    const task: TaskProfile = {
      description: "Implement user login with JWT auth",
      intent: "code",
      capabilities: ["code-gen", "file-ops"],
      complexity: 6,
    };

    // Build team plan
    const teamPlanPromise = teamBuilder.buildTeam(task);

    // The cluster DAG builder generates from team plan synchronously
    const teamPlan = {
      runId: "integration_test",
      coordinator: {
        agentType: "CoordinatorAgent", role: "coordinator" as const, count: 1,
        model: "deepseek-v4-pro", thinking: "enabled" as const,
        reasoningEffort: "high" as const, skills: [],
      },
      members: [
        {
          agentType: "ResearchAgent", role: "researcher" as const, count: 3,
          model: "deepseek-v4-flash", thinking: "disabled" as const, skills: [],
        },
        {
          agentType: "CodeAgent", role: "code_agent" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "TestAgent", role: "tester" as const, count: 1,
          model: "deepseek-v4-flash", thinking: "enabled" as const,
          reasoningEffort: "high" as const, skills: [],
        },
        {
          agentType: "ReviewAgent", role: "reviewer" as const, count: 1,
          model: "deepseek-v4-pro", thinking: "enabled" as const,
          reasoningEffort: "max" as const, skills: [],
        },
      ],
      collaborationMode: "pipeline" as const,
      modelPolicy: {},
      expectedArtifacts: ["plan.json", "patch.diff", "test_report.json", "review_report.json"],
      estimatedProTokens: 20000,
      estimatedFlashTokens: 8000,
      estimatedCost: 0.01,
    };

    const clusterDag = dagBuilder.build(teamPlan);
    const execDag = dagBuilder.toExecutableDAG(clusterDag);

    // Verify
    expect(execDag).toBeInstanceOf(DAG);
    expect(execDag.hasCycle()).toBe(false);

    const allTasks = execDag.getAllTasks();
    expect(allTasks.length).toBeGreaterThanOrEqual(4);

    // Tasks should have correct agent types
    const agentTypes = allTasks.map(t => t.agentType);
    expect(agentTypes).toContain("PlannerAgent");
    expect(agentTypes).toContain("ResearchAgent");
    expect(agentTypes).toContain("CodeAgent");

    // Every step should have a final report
    expect(agentTypes).toContain("CoordinatorAgent");
  });
});
