/**
 * GlobTool — find files matching a glob pattern.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { globSync } from "fs";
import { readdirSync, statSync } from "fs";
import { resolve, relative, normalize, join } from "path";

export class GlobTool extends Tool {
  readonly name = "glob";
  readonly description =
    "Find files matching a glob pattern (e.g. '**/*.ts', 'src/**/*.test.*'). " +
    "Returns matching file paths sorted by modification time.";
  readonly parameters = [
    {
      name: "pattern",
      type: "string",
      description: "Glob pattern to match files (e.g. 'src/**/*.ts')",
    },
    {
      name: "path",
      type: "string",
      description: "Directory to search in (defaults to project root)",
      required: false,
    },
  ];
  readonly safeForParallel = true;

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const pattern = args.pattern as string;
    const searchPath = args.path
      ? normalize(resolve(context.workingDir, args.path as string))
      : context.workingDir;

    try {
      // Simple glob implementation using recursive directory walk
      const matches = this.simpleGlob(searchPath, pattern);
      const relativePaths = matches
        .map((p) => relative(context.workingDir, p))
        .sort((a, b) => {
          try {
            const statA = statSync(resolve(context.workingDir, a));
            const statB = statSync(resolve(context.workingDir, b));
            return statB.mtimeMs - statA.mtimeMs;
          } catch {
            return 0;
          }
        })
        .slice(0, 100);

      if (relativePaths.length === 0) {
        return this.success("", "No files matched the pattern.", Date.now() - start);
      }

      return this.success(
        "",
        relativePaths.join("\n"),
        Date.now() - start,
        { totalMatches: relativePaths.length }
      );
    } catch (e: any) {
      return this.error("", `Glob error: ${e.message}`, Date.now() - start);
    }
  }

  private simpleGlob(baseDir: string, pattern: string): string[] {
    const results: string[] = [];
    const parts = pattern.replace(/\\/g, "/").split("/");

    const walk = (dir: string, partIdx: number) => {
      if (partIdx >= parts.length) {
        results.push(dir);
        return;
      }

      const part = parts[partIdx];

      if (part === "**") {
        // Recurse into all subdirectories
        results.push(dir); // match current level
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              walk(join(dir, entry.name), partIdx); // stay at **
              walk(join(dir, entry.name), partIdx + 1); // consume **
            } else {
              walk(join(dir, entry.name), partIdx + 1); // consume **
            }
          }
        } catch {
          // skip inaccessible directories
        }
        return;
      }

      // Simple glob match
      const regex = this.globPartToRegex(part);
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (regex.test(entry.name)) {
            const fullPath = join(dir, entry.name);
            if (partIdx === parts.length - 1) {
              results.push(fullPath);
            } else if (entry.isDirectory()) {
              walk(fullPath, partIdx + 1);
            }
          }
        }
      } catch {
        // skip
      }
    };

    walk(baseDir, 0);
    return results;
  }

  private globPartToRegex(part: string): RegExp {
    let pattern = part
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${pattern}$`);
  }
}
