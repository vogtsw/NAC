/**
 * GitHub Integration
 * Create PRs from cluster run results via gh CLI.
 */
import { execSync } from "child_process";
import type { PRSummary } from "./PRGenerator.js";
import { getLogger } from "../monitoring/logger.js";

const logger = getLogger("GitHubIntegration");

export interface PRCreateResult {
  created: boolean;
  url?: string;
  number?: number;
  error?: string;
}

export class GitHubIntegration {
  /**
   * Create a PR using gh CLI from cluster run results.
   */
  async createPR(summary: PRSummary): Promise<PRCreateResult> {
    try {
      // Check gh CLI is available
      execSync("gh --version", { encoding: "utf-8", timeout: 5000 });
    } catch {
      return { created: false, error: "gh CLI not found. Install: https://cli.github.com" };
    }

    try {
      // Check we're in a git repo with a remote
      const remotes = execSync("git remote -v", { encoding: "utf-8", timeout: 5000 });
      if (!remotes.includes("origin")) {
        return { created: false, error: "No origin remote configured" };
      }
    } catch {
      return { created: false, error: "Not in a git repository" };
    }

    try {
      // Create branch
      execSync(`git checkout -b ${summary.branch} 2>/dev/null || git checkout ${summary.branch}`, {
        encoding: "utf-8", timeout: 10000,
      });

      // Stage and commit changes
      execSync("git add -A", { encoding: "utf-8", timeout: 5000 });
      execSync(`git commit -m "${summary.title}" --allow-empty 2>&1 || true`, {
        encoding: "utf-8", timeout: 5000,
      });

      // Push branch
      execSync(`git push -u origin ${summary.branch} 2>&1 || true`, {
        encoding: "utf-8", timeout: 30000,
      });

      // Create PR via gh CLI
      const body = summary.body
        .replace(/"/g, '\\"')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');

      const cmd = `gh pr create --title "${summary.title}" --body "${body}" --base ${summary.baseBranch} --head ${summary.branch}`;
      const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 }).trim();

      // Parse PR URL from output
      const urlMatch = output.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/);
      const numberMatch = output.match(/\/pull\/(\d+)/);

      return {
        created: true,
        url: urlMatch?.[0] || output,
        number: numberMatch ? parseInt(numberMatch[1]) : undefined,
      };
    } catch (error: any) {
      logger.warn({ error: error.message }, "Failed to create PR");
      return { created: false, error: error.message };
    }
  }

  /**
   * Dry-run: show what would be created without actually creating.
   */
  async dryRunPR(summary: PRSummary): Promise<string> {
    const lines: string[] = [];
    lines.push("=== PR Dry Run ===");
    lines.push(`Title: ${summary.title}`);
    lines.push(`Branch: ${summary.branch} → ${summary.baseBranch}`);
    lines.push(`Files: ${summary.modifiedFiles.join(", ") || "none"}`);
    lines.push(`Review: ${summary.review.approved ? "✅" : "❌"} (risk: ${summary.review.riskLevel})`);
    lines.push(`Body preview:`);
    lines.push(summary.body.substring(0, 500));
    return lines.join("\n");
  }

  /**
   * Check if PR creation is feasible.
   */
  async checkReadiness(): Promise<{ ready: boolean; issues: string[] }> {
    const issues: string[] = [];

    try { execSync("gh --version", { encoding: "utf-8", timeout: 5000 }); }
    catch { issues.push("gh CLI not installed"); }

    try {
      const status = execSync("git status --short", { encoding: "utf-8", timeout: 5000 });
      if (!status.trim()) issues.push("No changes to commit");
    } catch { issues.push("Not in a git repo"); }

    try {
      const branch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 5000 }).trim();
      if (branch === "main" || branch === "master") issues.push("On main branch — create a feature branch first");
    } catch { /* ignore */ }

    return { ready: issues.length === 0, issues };
  }
}

export function createGitHubIntegration(): GitHubIntegration {
  return new GitHubIntegration();
}
