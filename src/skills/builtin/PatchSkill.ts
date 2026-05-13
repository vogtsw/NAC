/**
 * PatchSkill
 * Apply unified diffs to files in the workspace.
 * Supports create, modify, and delete operations via unified diff format.
 */

import { promises as fs, existsSync } from "fs";
import { dirname } from "path";
import { execSync } from "child_process";
import { Skill, SkillCategory, SkillContext, SkillResult } from "../types.js";
import { getLogger } from "../../monitoring/logger.js";

const logger = getLogger("PatchSkill");

export interface PatchResult {
  files: Array<{
    path: string;
    operation: "created" | "modified" | "deleted" | "skipped";
    hunksApplied: number;
    hunksFailed: number;
  }>;
  summary: string;
  applied: boolean;
}

export const PatchSkill: Skill = {
  name: "apply-patch",
  description: "Apply unified diff patches to workspace files. Supports create, modify, delete via patch format.",
  category: SkillCategory.FILE,
  version: "1.0.0",
  enabled: true,
  builtin: true,
  parameters: {
    required: [],
    optional: ["patch", "files", "cwd"],
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const cwd = params.cwd || process.cwd();

    try {
      let result: PatchResult;

      if (params.patch && typeof params.patch === "string") {
        result = await applyUnifiedDiff(params.patch, cwd);
      } else if (params.files && Array.isArray(params.files)) {
        const fileResults: PatchResult["files"] = [];
        for (const file of params.files) {
          fileResults.push(await applyFileOperation(file, cwd));
        }
        result = {
          files: fileResults,
          summary: `${fileResults.filter(r => r.operation !== "skipped").length} files changed`,
          applied: fileResults.every(r => r.hunksFailed === 0),
        };
      } else {
        return { success: false, error: "Either 'patch' or 'files' parameter is required", result: null };
      }

      return { success: result.applied, result };
    } catch (error: any) {
      return { success: false, error: error.message, result: null };
    }
  },

  validate(params: any): boolean {
    return !!(params.patch || (params.files && Array.isArray(params.files)));
  },
};

async function applyUnifiedDiff(diff: string, cwd: string): Promise<PatchResult> {
  // Write diff to temp file and apply
  const tmpFile = `${cwd}/.nac_patch_${Date.now()}.diff`;
  await fs.writeFile(tmpFile, diff, "utf-8");

  try {
    // Try dry-run first
    const dryRun = execSync(`git apply --stat "${tmpFile}"`, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    }).trim();

    // Apply the patch
    execSync(`git apply "${tmpFile}"`, {
      cwd,
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });

    const filesChanged = dryRun.split("\n").length;
    const files = dryRun
      .split("\n")
      .map(line => {
        const match = line.match(/^ (.+?)\s+\|/);
        return match ? match[1].trim() : "";
      })
      .filter(Boolean)
      .map(path => ({
        path,
        operation: existsSync(`${cwd}/${path}`) ? "modified" as const : "created" as const,
        hunksApplied: 1,
        hunksFailed: 0,
      }));

    await fs.unlink(tmpFile).catch(() => {});
    return {
      files,
      summary: dryRun,
      applied: true,
    };
  } catch (error: any) {
    await fs.unlink(tmpFile).catch(() => {});
    logger.warn({ error: error.message }, "Failed to apply unified diff");

    // Fall back to manual parsing and application
    return applyDiffManually(diff, cwd);
  }
}

async function applyDiffManually(diff: string, cwd: string): Promise<PatchResult> {
  const results: PatchResult["files"] = [];
  const fileSections = diff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const headerMatch = section.match(/^a\/(.+?) b\/(.+?)$/m);
    if (!headerMatch) continue;

    const filePath = headerMatch[2];
    const fullPath = `${cwd}/${filePath}`;

    try {
      // Check if this is a new file, deletion, or modification
      if (section.includes("new file mode")) {
        const content = extractNewFileContent("diff --git " + section);
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        results.push({ path: filePath, operation: "created", hunksApplied: 1, hunksFailed: 0 });
      } else if (section.includes("deleted file mode")) {
        if (existsSync(fullPath)) {
          await fs.unlink(fullPath);
          results.push({ path: filePath, operation: "deleted", hunksApplied: 1, hunksFailed: 0 });
        } else {
          results.push({ path: filePath, operation: "skipped", hunksApplied: 0, hunksFailed: 1 });
        }
      } else {
        // Modify file
        const hunkSections = ("diff --git " + section).split(/^@@ /m).slice(1);
        if (hunkSections.length > 0 && existsSync(fullPath)) {
          const original = await fs.readFile(fullPath, "utf-8");
          let modified = original;
          for (const hunk of hunkSections) {
            const lines = hunk.split("\n");
            const context: string[] = [];
            for (const line of lines) {
              if (line.startsWith("+")) context.push(line.substring(1));
              else if (!line.startsWith("-")) context.push(line);
            }
            const hunkHeader = lines[0]?.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
          }
          await fs.writeFile(fullPath, applyHunks(original, hunkSections), "utf-8");
          results.push({ path: filePath, operation: "modified", hunksApplied: hunkSections.length, hunksFailed: 0 });
        } else if (!existsSync(fullPath)) {
          results.push({ path: filePath, operation: "skipped", hunksApplied: 0, hunksFailed: 1 });
        }
      }
    } catch (error: any) {
      logger.warn({ filePath, error: error.message }, "Failed to apply patch to file");
      results.push({ path: filePath, operation: "skipped", hunksApplied: 0, hunksFailed: 1 });
    }
  }

  const applied = results.filter(r => r.operation !== "skipped");
  return {
    files: results,
    summary: `${applied.length} files changed, ${results.length - applied.length} skipped`,
    applied: applied.length > 0,
  };
}

function extractNewFileContent(diffSection: string): string {
  const lines = diffSection.split("\n");
  const contentLines: string[] = [];
  let inContent = false;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      inContent = true;
      continue;
    }
    if (inContent && line.startsWith("+")) {
      contentLines.push(line.substring(1));
    }
  }

  return contentLines.join("\n") + "\n";
}

function applyHunks(original: string, hunkSections: string[]): string {
  let result = original;
  for (const hunk of hunkSections) {
    const headerMatch = hunk.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (!headerMatch) continue;
    const oldStart = parseInt(headerMatch[1]) - 1;

    const lines = hunk.split("\n").slice(1);
    const newLines: string[] = [];
    let oldIdx = oldStart;
    for (const line of lines) {
      if (line.startsWith(" ")) {
        const origLines = result.split("\n");
        if (oldIdx < origLines.length) newLines.push(origLines[oldIdx]);
        oldIdx++;
      } else if (line.startsWith("-")) {
        oldIdx++;
      } else if (line.startsWith("+")) {
        newLines.push(line.substring(1));
      }
    }

    const origLines = result.split("\n");
    const before = origLines.slice(0, oldStart);
    const after = origLines.slice(oldStart + (lines.filter(l => !l.startsWith("+")).length));
    result = [...before, ...newLines, ...after].join("\n");
  }
  return result;
}

async function applyFileOperation(
  file: { path: string; content: string; operation: string },
  cwd: string,
): Promise<PatchResult["files"][0]> {
  const fullPath = `${cwd}/${file.path}`;

  try {
    switch (file.operation) {
      case "create":
        await fs.mkdir(dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, "utf-8");
        return { path: file.path, operation: "created", hunksApplied: 1, hunksFailed: 0 };

      case "modify":
        if (existsSync(fullPath)) {
          await fs.writeFile(fullPath, file.content, "utf-8");
          return { path: file.path, operation: "modified", hunksApplied: 1, hunksFailed: 0 };
        }
        return { path: file.path, operation: "skipped", hunksApplied: 0, hunksFailed: 1 };

      case "delete":
        if (existsSync(fullPath)) {
          await fs.unlink(fullPath);
          return { path: file.path, operation: "deleted", hunksApplied: 1, hunksFailed: 0 };
        }
        return { path: file.path, operation: "skipped", hunksApplied: 0, hunksFailed: 1 };

      default:
        return { path: file.path, operation: "skipped", hunksApplied: 0, hunksFailed: 1 };
    }
  } catch (error: any) {
    logger.warn({ path: file.path, error: error.message }, "File operation failed");
    return { path: file.path, operation: "skipped", hunksApplied: 0, hunksFailed: 1 };
  }
}
