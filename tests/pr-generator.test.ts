/**
 * PR Generator Tests
 * Phase 6: PR summary generation, preflight checks, display formatting.
 */
import { describe, it, expect } from "vitest";
import { PRGenerator } from "../src/orchestrator/PRGenerator.js";
import type { ClusterReport } from "../src/orchestrator/ClusterReporter.js";
import type { PatchArtifact, ReviewArtifact } from "../src/orchestrator/AgentHandoff.js";

function makeReport(overrides: Partial<ClusterReport> = {}): ClusterReport {
  return {
    runId: "run_test_12345",
    startTime: Date.now() - 5000,
    endTime: Date.now(),
    duration: 5000,
    mode: "pipeline",
    status: "completed",
    coordinator: { model: "deepseek-v4-pro", tokens: 3000, cost: 0.001 },
    workers: [{ agentType: "CodeAgent", model: "deepseek-v4-pro", steps: 1, tokens: 2000, cost: 0.001, duration: 3000 }],
    artifacts: [],
    totalProTokens: 5000,
    totalFlashTokens: 2000,
    totalCost: 0.002,
    cacheHitRate: 0.85,
    timeline: [],
    summary: "Test run",
    ...overrides,
  };
}

function makePatch(overrides: Partial<PatchArtifact> = {}): PatchArtifact {
  return {
    files: [{ path: "src/auth.ts", operation: "modify", diff: "- old\n+ new", newContent: "new" }],
    summary: "Fix auth token validation",
    breakingChanges: false,
    fileCount: 1,
    linesAdded: 3,
    linesRemoved: 2,
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    overallScore: 8,
    issues: [],
    approved: true,
    suggestions: [],
    riskLevel: "low",
    ...overrides,
  };
}

describe("PRGenerator", () => {
  const gen = new PRGenerator();

  it("generates PR summary from cluster report", () => {
    const summary = gen.generatePRSummary({
      clusterReport: makeReport(),
      patch: makePatch(),
      review: makeReview(),
    });

    expect(summary.title).toContain("Fix auth token validation");
    expect(summary.branch).toContain("nac-cluster-");
    expect(summary.baseBranch).toBe("main");
    expect(summary.stats.filesChanged).toBe(1);
    expect(summary.stats.insertions).toBe(3);
    expect(summary.review.approved).toBe(true);
    expect(summary.clusterReport.cacheHitRate).toBe(0.85);
  });

  it("marks PR as not approved when review fails", () => {
    const summary = gen.generatePRSummary({
      clusterReport: makeReport(),
      patch: makePatch(),
      review: makeReview({
        approved: false,
        riskLevel: "high",
        issues: [{ severity: "critical", category: "security", description: "XSS vulnerability" }],
      }),
    });

    expect(summary.review.approved).toBe(false);
    expect(summary.review.riskLevel).toBe("high");
    expect(summary.review.issues.length).toBe(1);
    expect(summary.review.issues[0].severity).toBe("critical");
  });

  it("handles missing patch and review gracefully", () => {
    const summary = gen.generatePRSummary({ clusterReport: makeReport() });
    expect(summary.title).toBeTruthy();
    expect(summary.stats.filesChanged).toBe(0);
    expect(summary.review.approved).toBe(true);
  });

  it("modified files are extracted from patch", () => {
    const summary = gen.generatePRSummary({
      clusterReport: makeReport(),
      patch: makePatch({
        files: [
          { path: "src/a.ts", operation: "modify", diff: "", newContent: "" },
          { path: "tests/a.test.ts", operation: "modify", diff: "", newContent: "" },
        ],
        fileCount: 2,
      }),
    });

    expect(summary.modifiedFiles).toContain("src/a.ts");
    expect(summary.modifiedFiles).toContain("tests/a.test.ts");
    expect(summary.modifiedFiles.length).toBe(2);
  });

  it("generates displayable PR summary", () => {
    const summary = gen.generatePRSummary({
      clusterReport: makeReport(),
      patch: makePatch(),
      review: makeReview(),
    });

    const display = gen.displayPRSummary(summary);
    expect(display).toContain("Fix auth token validation");
    expect(display).toContain("✅");
    expect(display).toContain("NAC DeepSeek Cluster Agent");
    expect(display).toContain("$0.0020");
  });

  it("preflight checks work (TypeScript check)", async () => {
    const result = await gen.runPreflight();
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.some(c => c.name === "TypeScript")).toBe(true);
  });

  it("review issues are included in PR body", () => {
    const summary = gen.generatePRSummary({
      clusterReport: makeReport(),
      review: makeReview({ approved: false, issues: [
        { severity: "major", category: "performance", description: "N+1 query" },
      ] }),
    });
    const display = gen.displayPRSummary(summary);
    expect(display).toContain("N+1 query");
    expect(display).toContain("major");
  });
});
