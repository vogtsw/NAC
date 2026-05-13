/**
 * GitSkill
 * Git operations for the DeepSeek cluster agent.
 * Supports: status, diff, branch, commit, worktree create/remove.
 */

import { execSync, spawn } from "child_process";
import { Skill, SkillCategory, SkillContext, SkillResult } from "../types.js";
import { getLogger } from "../../monitoring/logger.js";

const logger = getLogger("GitSkill");

export interface GitStatusResult {
  branch: string;
  clean: boolean;
  files: Array<{
    path: string;
    status: "modified" | "added" | "deleted" | "untracked" | "renamed";
    staged: boolean;
  }>;
  ahead: number;
  behind: number;
}

export interface GitDiffResult {
  files: string[];
  diff: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

function runGit(args: string[], cwd?: string): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: any) {
    logger.warn({ args, error: error.message }, "Git command failed");
    throw new Error(`Git command failed: ${error.message}`);
  }
}

function runGitSpawn(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("git", args, {
      cwd: cwd || process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `git exited with ${code}`));
    });
  });
}

export const GitSkill: Skill = {
  name: "git",
  description: "Git operations: status, diff, branch, commit, worktree management",
  category: SkillCategory.GIT,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: ["operation"],
    optional: ["path", "message", "branchName", "baseBranch", "worktreePath"],
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const cwd = params.path || process.cwd();

    try {
      let result: any;

      switch (params.operation) {
        case "status":
          result = await gitStatus(cwd);
          break;
        case "diff":
          result = await gitDiff(params.baseBranch || "HEAD", cwd);
          break;
        case "branch":
          result = await gitBranch(params.branchName, cwd);
          break;
        case "commit":
          result = await gitCommit(params.message, cwd);
          break;
        case "worktree_create":
          result = await gitWorktreeCreate(params.branchName, params.worktreePath, params.baseBranch, cwd);
          break;
        case "worktree_remove":
          result = await gitWorktreeRemove(params.worktreePath, cwd);
          break;
        default:
          throw new Error(`Unknown git operation: ${params.operation}`);
      }

      return { success: true, result };
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(params: any): boolean {
    return !!params.operation;
  },
};

async function gitStatus(cwd: string): Promise<GitStatusResult> {
  const branch = runGit(["rev-parse --abbrev-ref HEAD"], cwd).trim();
  const shortStatus = runGit(["status --short"], cwd);
  const aheadBehind = runGit(["rev-list --left-right --count origin/" + branch + "..." + branch], cwd)
    .trim().split("\t");

  const files: GitStatusResult["files"] = [];
  for (const line of shortStatus.split("\n")) {
    if (!line.trim()) continue;
    const statusCode = line.substring(0, 2).trim();
    const filePath = line.substring(3).trim();
    const staged = line[0] !== " " && line[0] !== "?";
    const status = mapStatus(statusCode);
    files.push({ path: filePath, status, staged });
  }

  return {
    branch,
    clean: files.length === 0,
    files,
    ahead: parseInt(aheadBehind[0] || "0"),
    behind: parseInt(aheadBehind[1] || "0"),
  };
}

function mapStatus(code: string): GitStatusResult["files"][0]["status"] {
  if (code.includes("M")) return "modified";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  if (code.includes("R")) return "renamed";
  return "untracked";
}

async function gitDiff(baseBranch: string, cwd: string): Promise<GitDiffResult> {
  const nameOnly = runGit(["diff --name-only", baseBranch], cwd);
  const files = nameOnly.split("\n").filter(f => f.trim());
  const diff = runGit(["diff", baseBranch], cwd);
  const shortStat = runGit(["diff --shortstat", baseBranch], cwd).trim();

  const statMatch = shortStat.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  const filesChanged = statMatch ? parseInt(statMatch[1]) : files.length;
  const insertions = statMatch?.[2] ? parseInt(statMatch[2]) : 0;
  const deletions = statMatch?.[3] ? parseInt(statMatch[3]) : 0;

  return { files, diff, stats: { filesChanged, insertions, deletions } };
}

async function gitBranch(name: string, cwd: string): Promise<{ branches: string[]; current: string }> {
  const current = runGit(["rev-parse --abbrev-ref HEAD"], cwd).trim();
  if (name) {
    runGit(["checkout -b", name], cwd);
    return { branches: [name], current: name };
  }
  const list = runGit(["branch --list"], cwd)
    .split("\n")
    .map(b => b.replace(/^\*?\s*/, "").trim())
    .filter(b => b);
  return { branches: list, current };
}

async function gitCommit(message: string, cwd: string): Promise<{ hash: string; message: string }> {
  if (!message) throw new Error("Commit message is required");
  runGit(["add -A"], cwd);
  runGit(["commit -m", `"${message.replace(/"/g, '\\"')}"`], cwd);
  const hash = runGit(["rev-parse HEAD"], cwd).trim();
  return { hash, message };
}

async function gitWorktreeCreate(
  branch: string, worktreePath: string, baseBranch: string, cwd: string,
): Promise<{ branch: string; path: string }> {
  if (!branch) throw new Error("Branch name required for worktree");
  if (!worktreePath) throw new Error("Worktree path required");

  const args = ["worktree add", worktreePath, "-b", branch];
  if (baseBranch) {
    args.push(baseBranch);
  }
  runGit(args, cwd);
  return { branch, path: worktreePath };
}

async function gitWorktreeRemove(
  worktreePath: string, cwd: string,
): Promise<{ path: string; removed: boolean }> {
  if (!worktreePath) throw new Error("Worktree path required");
  runGit(["worktree remove", worktreePath, "--force"], cwd);
  return { path: worktreePath, removed: true };
}
