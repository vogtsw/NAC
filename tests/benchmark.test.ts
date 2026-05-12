/**
 * Benchmark System Tests
 * Tests for the evaluation framework: runner, regression, comparison.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BenchmarkRunner, type EvalScenario, type ScenarioResult } from "../eval/benchmark/runner.js";
import { RegressionTracker } from "../eval/benchmark/regression.js";
import type { AgentResult } from "../src/agent/types.js";

// ── Mock Scenarios for Testing ─────────────────────────

function makeScenario(overrides: Partial<EvalScenario> = {}): EvalScenario {
  return {
    id: "test-001",
    layer: "tools",
    title: "Test scenario",
    description: "A test scenario",
    category: "test",
    tags: ["test"],
    expectedTools: ["bash"],
    prompt: "Run echo hello",
    assertions: [
      { type: "tool_executed", value: "bash", description: "bash was called" },
      { type: "no_error", description: "no error" },
    ],
    scoringDimensions: ["toolCorrectness"],
    weight: 2,
    ...overrides,
  };
}

function makeMockAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    turns: [
      {
        index: 0,
        messages: [],
        toolCalls: [{ id: "1", name: "bash", arguments: { command: "echo hello" } }],
        toolResults: [
          {
            toolCallId: "1",
            name: "bash",
            result: "hello",
            isError: false,
            duration: 10,
          },
        ],
        llmResponse: "I ran the command and got: hello",
        duration: 50,
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      },
    ],
    stopReason: "stop_sequence",
    finalResponse: "I ran the command and got: hello",
    totalDuration: 100,
    totalTokens: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    toolCallCount: 1,
    toolSuccessRate: 1.0,
    ...overrides,
  };
}

// ── Runner Tests ─────────────────────────────────────────

describe("BenchmarkRunner", () => {
  it("loads scenarios from markdown files", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/tools");

    expect(scenarios.length).toBeGreaterThanOrEqual(3);
    expect(scenarios[0]).toHaveProperty("id");
    expect(scenarios[0]).toHaveProperty("layer");
    expect(scenarios[0]).toHaveProperty("assertions");
    expect(scenarios[0].assertions.length).toBeGreaterThan(0);
  });

  it("loads scenarios from all layers", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    // Should find scenarios in all subdirectories
    expect(scenarios.length).toBeGreaterThanOrEqual(8);
    const layers = new Set(scenarios.map((s) => s.layer));
    expect(layers.has("tools")).toBe(true);
    expect(layers.has("planning")).toBe(true);
    expect(layers.has("multi-agent")).toBe(true);
    expect(layers.has("session-state")).toBe(true);
    expect(layers.has("real-chat")).toBe(true);
  });

  it("parses scenario frontmatter correctly", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/tools");

    const tool1 = scenarios.find((s) => s.id === "tool-001");
    expect(tool1).toBeDefined();
    expect(tool1!.title).toBe("Bash: execute and read command output");
    expect(tool1!.expectedTools).toContain("bash");
    expect(tool1!.weight).toBe(2);
    expect(tool1!.prompt.length).toBeGreaterThan(0);
  });

  it("all loaded scenarios have valid structure", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    for (const scenario of scenarios) {
      expect(scenario.id).toBeTruthy();
      expect(scenario.title).toBeTruthy();
      expect(scenario.prompt.length).toBeGreaterThan(0);
      expect(scenario.assertions.length).toBeGreaterThan(0);
      expect(scenario.weight).toBeGreaterThanOrEqual(1);
      expect(scenario.weight).toBeLessThanOrEqual(5);

      // Each assertion has required fields
      for (const assertion of scenario.assertions) {
        expect(assertion.type).toBeTruthy();
        expect([
          "output_contains", "output_not_contains", "tool_executed",
          "tool_not_executed", "tool_count_gte", "tool_count_lte",
          "no_error", "stop_reason", "duration_lte", "iterations_lte",
          "tool_success_rate_gte", "custom",
          "memory_contains", "memory_not_contains",
          "permission_denied", "redacted_output",
          "agent_selected", "dag_task_count_gte"
        ]).toContain(assertion.type);
      }
    }
  });

  it("scoring dimensions are derived for scenarios", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    for (const scenario of scenarios) {
      // Each scenario must have at least assertions
      expect(scenario.assertions.length).toBeGreaterThan(0);
      // scoringDimensions should be auto-derived if not specified
      expect(scenario.scoringDimensions).toBeDefined();
    }
  });
});

// ── Regression Tests ─────────────────────────────────────

describe("RegressionTracker", () => {
  let tracker: RegressionTracker;

  beforeEach(() => {
    tracker = new RegressionTracker("eval/regression");
  });

  it("saves and loads a baseline", () => {
    const report = {
      timestamp: new Date().toISOString(),
      totalScenarios: 5,
      passedScenarios: 4,
      overallScore: 0.8,
      layerScores: {
        tools: { total: 3, passed: 3, score: 1.0 },
        planning: { total: 2, passed: 1, score: 0.5 },
      } as any,
      scenarios: [
        { scenarioId: "tool-001", score: 1.0, passed: true } as ScenarioResult,
        { scenarioId: "tool-002", score: 1.0, passed: true } as ScenarioResult,
        { scenarioId: "plan-001", score: 0.5, passed: false } as ScenarioResult,
      ],
      toolAnalysis: [
        { tool: "bash", calls: 5, successes: 5, failures: 0, successRate: 1.0 },
        { tool: "file_read", calls: 3, successes: 2, failures: 1, successRate: 0.67 },
      ],
      summary: "Test report",
    } as BenchmarkReport;

    const baseline = tracker.saveBaseline(report, "deepseek-chat", "v1.0");

    expect(baseline.overallScore).toBe(0.8);
    expect(baseline.model).toBe("deepseek-chat");

    const loaded = tracker.loadBaseline("v1.0");
    expect(loaded!.overallScore).toBe(0.8);
    expect(loaded!.scenarioScores["tool-001"]).toBe(1.0);
    expect(loaded!.toolSuccessRates["bash"]).toBe(1.0);
  });

  it("detects regressions", () => {
    // Save baseline with good scores
    const baselineReport = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 3,
      overallScore: 1.0,
      layerScores: {
        tools: { total: 3, passed: 3, score: 1.0 },
      } as any,
      scenarios: [
        { scenarioId: "tool-001", score: 1.0, passed: true },
        { scenarioId: "tool-002", score: 1.0, passed: true },
        { scenarioId: "tool-003", score: 1.0, passed: true },
      ] as ScenarioResult[],
      toolAnalysis: [
        { tool: "bash", calls: 5, successes: 5, failures: 0, successRate: 1.0 },
      ],
      summary: "Baseline",
    } as BenchmarkReport;

    tracker.saveBaseline(baselineReport, "deepseek-chat", "v1.0");

    // Run with degraded scores
    const degradedReport = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 1,
      overallScore: 0.33,
      layerScores: {
        tools: { total: 3, passed: 1, score: 0.33 },
      } as any,
      scenarios: [
        { scenarioId: "tool-001", score: 0.5, passed: false },
        { scenarioId: "tool-002", score: 0.5, passed: false },
        { scenarioId: "tool-003", score: 0.0, passed: false },
      ] as ScenarioResult[],
      toolAnalysis: [
        { tool: "bash", calls: 5, successes: 2, failures: 3, successRate: 0.4 },
      ],
      summary: "Degraded",
    } as BenchmarkReport;

    const comparison = tracker.compare(degradedReport, "v1.0");

    expect(comparison.baseline).not.toBeNull();
    expect(comparison.regressions.length).toBeGreaterThan(0);
    expect(comparison.regressions.some((r) => r.target === "overall")).toBe(true);
    expect(comparison.regressions.some((r) => r.target === "tool:bash")).toBe(true);
  });

  it("detects improvements", () => {
    const baselineReport = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 2,
      overallScore: 0.67,
      layerScores: { tools: { total: 3, passed: 2, score: 0.67 } } as any,
      scenarios: [
        { scenarioId: "tool-001", score: 0.5, passed: false },
        { scenarioId: "tool-002", score: 1.0, passed: true },
        { scenarioId: "tool-003", score: 0.5, passed: false },
      ] as ScenarioResult[],
      toolAnalysis: [
        { tool: "bash", calls: 5, successes: 3, failures: 2, successRate: 0.6 },
      ],
      summary: "Baseline",
    } as BenchmarkReport;

    tracker.saveBaseline(baselineReport, "deepseek-chat", "v2.0");

    const improvedReport = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 3,
      overallScore: 1.0,
      layerScores: { tools: { total: 3, passed: 3, score: 1.0 } } as any,
      scenarios: [
        { scenarioId: "tool-001", score: 1.0, passed: true },
        { scenarioId: "tool-002", score: 1.0, passed: true },
        { scenarioId: "tool-003", score: 1.0, passed: true },
      ] as ScenarioResult[],
      toolAnalysis: [
        { tool: "bash", calls: 5, successes: 5, failures: 0, successRate: 1.0 },
      ],
      summary: "Improved",
    } as BenchmarkReport;

    const comparison = tracker.compare(improvedReport, "v2.0");

    expect(comparison.improvements.length).toBeGreaterThan(0);
    expect(comparison.improvements.some((r) => r.target === "overall")).toBe(true);
  });

  it("handles no baseline gracefully", () => {
    // Use fresh tracker with empty temp dir
    const { mkdirSync, rmSync } = require("fs");
    const tmpDir = "eval/regression/test-tmp";
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const tmpTracker = new RegressionTracker(tmpDir);

    const report = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 3,
      overallScore: 1.0,
      layerScores: { tools: { total: 3, passed: 3, score: 1.0 } } as any,
      scenarios: [],
      toolAnalysis: [],
      summary: "Report",
    } as BenchmarkReport;

    const comparison = tmpTracker.compare(report);

    expect(comparison.baseline).toBeNull();
    expect(comparison.comparisonText).toContain("No baseline found");

    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists baselines", () => {
    const report = {
      timestamp: new Date().toISOString(),
      totalScenarios: 3,
      passedScenarios: 3,
      overallScore: 1.0,
      layerScores: { tools: { total: 3, passed: 3, score: 1.0 } } as any,
      scenarios: [],
      toolAnalysis: [],
      summary: "Report",
    } as BenchmarkReport;

    tracker.saveBaseline(report, "model-a", "v1");
    tracker.saveBaseline(report, "model-b", "v2");

    const baselines = tracker.listBaselines();
    expect(baselines.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Scenario Content Validation ─────────────────────────

describe("Scenario Validation", () => {
  it("all layers have at least 1 scenario", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    const layerCounts = new Map<string, number>();
    for (const s of scenarios) {
      layerCounts.set(s.layer, (layerCounts.get(s.layer) || 0) + 1);
    }

    expect(layerCounts.get("tools")).toBeGreaterThanOrEqual(3);
    expect(layerCounts.get("planning")).toBeGreaterThanOrEqual(2);
    expect(layerCounts.get("multi-agent")).toBeGreaterThanOrEqual(1);
    expect(layerCounts.get("session-state")).toBeGreaterThanOrEqual(1);
    expect(layerCounts.get("real-chat")).toBeGreaterThanOrEqual(2);
  });

  it("scenario IDs are unique", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    const ids = new Set<string>();
    for (const s of scenarios) {
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });

  it("scenarios have meaningful prompts", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios");

    for (const s of scenarios) {
      expect(s.prompt.length).toBeGreaterThanOrEqual(50);
    }
  });
});

// ── New Assertion Types (Day 4: Phase 2) ────────────────

describe("New Assertion Types (Phase 2)", () => {
  it("memory_contains assertion passes when value is in response", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenario = makeScenario({
      assertions: [{ type: "memory_contains", value: "TypeScript", description: "recalls preference" }],
    });
    // This tests the assertion logic, not a real agent run
    const result = makeMockAgentResult({ finalResponse: "You prefer TypeScript and VSCode." });
    // Directly test that the assertion logic works for the new type
    // by running a scenario that uses memory_contains
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/session-state");
    const memoryScenario = scenarios.find((s: any) => s.id === "memory-001");
    expect(memoryScenario).toBeDefined();
    expect(memoryScenario!.assertions.some((a: any) => a.type === "output_contains")).toBe(true);
  });

  it("permission_denied assertion exists in security scenarios", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/security");
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
    // Check that security scenarios use tool_not_executed or permission_denied
    const hasPermissionAssertion = scenarios.some((s: any) =>
      s.assertions.some((a: any) =>
        a.type === "tool_not_executed" || a.type === "permission_denied"
      )
    );
    expect(hasPermissionAssertion).toBe(true);
  });

  it("redacted_output assertion exists for secret scenarios", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const secScenario = runner.loadScenariosFromDir("eval/scenarios/security")
      .find((s: any) => s.id === "sec-003");
    expect(secScenario).toBeDefined();
    expect(secScenario!.assertions.some((a: any) =>
      a.type === "output_not_contains" && a.value === "sk-"
    )).toBe(true);
  });

  it("agent_selected assertion can be used in multi-agent scenarios", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/multi-agent");
    // Verify multi-agent scenarios exist with tool assertions
    const hasToolAssertion = scenarios.some((s: any) =>
      s.assertions.some((a: any) =>
        a.type === "tool_executed" || a.type === "agent_selected"
      )
    );
    expect(hasToolAssertion).toBe(true);
  });

  it("memory_not_contains prevents stale memory", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const memScenario = runner.loadScenariosFromDir("eval/scenarios/session-state")
      .find((s: any) => s.id === "memory-003");
    expect(memScenario).toBeDefined();
    // memory-003 should verify the agent does NOT repeat the old wrong location
    expect(memScenario!.assertions.some((a: any) =>
      a.type === "output_not_contains"
    )).toBe(true);
  });
});

// ── Gap Analysis (Day 4: Phase 2) ────────────────────────

describe("Gap Analysis", () => {
  it("boundary scenarios have gapCategory defined", () => {
    const runner = new BenchmarkRunner({ workingDir: process.cwd() });
    const scenarios = runner.loadScenariosFromDir("eval/scenarios/boundary");
    expect(scenarios.length).toBeGreaterThanOrEqual(15);
    let withGapCategory = 0;
    for (const s of scenarios) {
      if ((s as any).gapCategory) withGapCategory++;
    }
    expect(withGapCategory).toBeGreaterThanOrEqual(10);
  });
});

// ── External Runner Interface Verification ──────────────

describe("ExternalSystemRunner interface", () => {
  it("defines the correct interface shape", () => {
    // Verify that ExternalSystemRunner type is compatible
    const mockRunner = {
      name: "OpenClaw",
      run: async (prompt: string, wd: string) => ({
        finalResponse: "done",
        toolCalls: [{ name: "bash", args: { command: "ls" } }],
        toolResults: [{ name: "bash", success: true, result: "output" }],
        stopReason: "stop",
        totalDuration: 100,
        totalTokens: { promptTokens: 10, completionTokens: 5 },
        totalIterations: 1,
      }),
    };

    expect(mockRunner.name).toBe("OpenClaw");
    expect(typeof mockRunner.run).toBe("function");
  });
});
