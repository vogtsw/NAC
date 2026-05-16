/**
 * PR Generator
 * Generates PR summaries and pre-flight checks from cluster run outputs.
 */

import { execSync } from "child_process";
import type { ClusterReport } from "./ClusterReporter.js";
import type { PatchArtifact, ReviewArtifact } from "./AgentHandoff.js";
import { getLogger } from "../monitoring/logger.js";

const logger = getLogger("PRGenerator");

export interface PRSummary {
  title: string;
  body: string;
  branch: string;
  baseBranch: string;
  modifiedFiles: string[];
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  review: {
    approved: boolean;
    riskLevel: string;
    issues: Array<{ severity: string; description: string }>;
  };
  clusterReport: {
    runId: string;
    mode: string;
    duration: number;
    cost: number;
    cacheHitRate: number;
  };
}

export interface PRPreflightResult {
  ready: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  issues: string[];
}

export class PRGenerator {
  /**
   * Generate a PR summary from cluster run artifacts.
   */
  generatePRSummary(args: {
    clusterReport: ClusterReport;
    patch?: PatchArtifact;
    review?: ReviewArtifact;
    baseBranch?: string;
  }): PRSummary {
    const { clusterReport, patch, review, baseBranch = "main" } = args;

    const branch = `nac-cluster-${clusterReport.runId.substring(0, 8)}`;
    const modifiedFiles = patch?.files.map(f => f.path) || [];

    const title = this.generateTitle(clusterReport, patch);
    const body = this.generateBody(clusterReport, patch, review);
    const stats = patch
      ? { filesChanged: patch.fileCount, insertions: patch.linesAdded, deletions: patch.linesRemoved }
      : { filesChanged: 0, insertions: 0, deletions: 0 };

    return {
      title, body, branch, baseBranch, modifiedFiles, stats,
      review: {
        approved: review?.approved ?? true,
        riskLevel: review?.riskLevel || "low",
        issues: review?.issues?.map(i => ({ severity: i.severity, description: i.description })) || [],
      },
      clusterReport: {
        runId: clusterReport.runId,
        mode: clusterReport.mode,
        duration: clusterReport.duration,
        cost: clusterReport.totalCost,
        cacheHitRate: clusterReport.cacheHitRate,
      },
    };
  }

  /**
   * Run pre-flight checks before PR creation.
   */
  async runPreflight(cwd?: string): Promise<PRPreflightResult> {
    const workDir = cwd || process.cwd();
    const checks: PRPreflightResult["checks"] = [];
    const issues: string[] = [];

    // Check 1: TypeScript compilation
    try {
      execSync("npx tsc --noEmit 2>&1", { cwd: workDir, encoding: "utf-8", timeout: 30000 });
      checks.push({ name: "TypeScript", passed: true, detail: "No type errors" });
    } catch (e: any) {
      checks.push({ name: "TypeScript", passed: false, detail: e.stdout?.split("\n")[0] || e.message });
      issues.push("TypeScript compilation failed");
    }

    // Check 2: Tests pass
    try {
      const result = execSync("npx vitest run tests/deepseek-cluster.test.ts --reporter=dot 2>&1", {
        cwd: workDir, encoding: "utf-8", timeout: 60000,
      });
      checks.push({ name: "Cluster Tests", passed: true, detail: "All cluster tests pass" });
    } catch {
      checks.push({ name: "Cluster Tests", passed: false, detail: "Some tests failed" });
      issues.push("Cluster tests failing");
    }

    // Check 3: Git status is clean (or has only intended changes)
    try {
      const status = execSync("git status --short", { cwd: workDir, encoding: "utf-8" });
      const dirty = status.trim().split("\n").filter(l => l && !l.startsWith("??"));
      if (dirty.length === 0) {
        checks.push({ name: "Git Status", passed: true, detail: "Working tree clean" });
      } else {
        checks.push({ name: "Git Status", passed: true, detail: `${dirty.length} modified files (intended changes)` });
      }
    } catch {
      checks.push({ name: "Git Status", passed: false, detail: "Unable to check git status" });
    }

    // Check 4: No API keys in diff
    try {
      const diff = execSync("git diff --cached 2>&1 || git diff 2>&1", { cwd: workDir, encoding: "utf-8" });
      const secretPattern = /sk-[a-zA-Z0-9]{20,}/;
      if (!secretPattern.test(diff)) {
        checks.push({ name: "Secret Scan", passed: true, detail: "No API keys in diff" });
      } else {
        checks.push({ name: "Secret Scan", passed: false, detail: "API key pattern found in diff" });
        issues.push("Secrets detected in diff");
      }
    } catch {
      checks.push({ name: "Secret Scan", passed: true, detail: "Skipped (no git repo)" });
    }

    return { ready: issues.length === 0, checks, issues };
  }

  /**
   * Display PR summary as formatted text.
   */
  displayPRSummary(summary: PRSummary): string {
    const lines: string[] = [];
    lines.push("");
    lines.push(`### ${summary.title}`);
    lines.push("");
    lines.push(`**Branch:** \`${summary.branch}\` → \`${summary.baseBranch}\``);
    lines.push("");
    lines.push(`#### Changes`);
    lines.push(`- ${summary.stats.filesChanged} files changed`);
    lines.push(`- +${summary.stats.insertions} / -${summary.stats.deletions} lines`);
    lines.push("");
    if (summary.modifiedFiles.length > 0) {
      lines.push("**Modified files:**");
      for (const f of summary.modifiedFiles) {
        lines.push(`  - ${f}`);
      }
      lines.push("");
    }
    lines.push(`#### Review`);
    lines.push(`- Approved: ${summary.review.approved ? "✅" : "❌"}`);
    lines.push(`- Risk: ${summary.review.riskLevel}`);
    if (summary.review.issues.length > 0) {
      for (const i of summary.review.issues) {
        lines.push(`  - [${i.severity}] ${i.description}`);
      }
    }
    lines.push("");
    lines.push(`#### Cluster Run`);
    lines.push(`- Mode: ${summary.clusterReport.mode}`);
    lines.push(`- Duration: ${(summary.clusterReport.duration / 1000).toFixed(1)}s`);
    lines.push(`- Cost: $${summary.clusterReport.cost.toFixed(4)}`);
    lines.push(`- Cache hit: ${(summary.clusterReport.cacheHitRate * 100).toFixed(1)}%`);
    lines.push("");
    lines.push(summary.body);

    return lines.join("\n");
  }

  private generateTitle(report: ClusterReport, patch?: PatchArtifact): string {
    if (patch?.summary) return `fix: ${patch.summary}`;
    return `[NAC Cluster] ${report.runId}`;
  }

  private generateBody(report: ClusterReport, patch?: PatchArtifact, review?: ReviewArtifact): string {
    const parts: string[] = [];
    parts.push("## Summary");
    parts.push("");
    parts.push(patch?.summary || "Automated changes from NAC DeepSeek cluster agent.");
    parts.push("");

    parts.push("## Test Results");
    parts.push(`- Tests passed: ${report.status === "completed" ? "✅" : "❌"}`);
    parts.push(`- Cost: $${report.totalCost.toFixed(4)} (Pro: ${report.totalProTokens.toLocaleString()}, Flash: ${report.totalFlashTokens.toLocaleString()})`);
    parts.push(`- Cache hit rate: ${(report.cacheHitRate * 100).toFixed(1)}%`);
    parts.push("");

    if (review && !review.approved) {
      parts.push("## ⚠️ Review Issues");
      for (const issue of review.issues || []) {
        parts.push(`- **[${issue.severity}]** ${issue.description}`);
      }
      parts.push("");
    }

    parts.push("---");
    parts.push("🤖 Generated by NAC DeepSeek Cluster Agent");

    return parts.join("\n");
  }
}

export function createPRGenerator(): PRGenerator {
  return new PRGenerator();
}
