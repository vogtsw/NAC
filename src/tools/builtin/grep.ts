/**
 * GrepTool — search for text patterns in files.
 * Uses ripgrep-like regex matching.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { readFileSync, readdirSync, statSync } from "fs";
import { resolve, relative, normalize, join } from "path";

export class GrepTool extends Tool {
  readonly name = "grep";
  readonly description =
    "Search for a regex pattern in file contents. " +
    "Returns matching file paths and line content. Use for finding code, definitions, or patterns.";
  readonly parameters = [
    {
      name: "pattern",
      type: "string",
      description: "Regular expression pattern to search for",
    },
    {
      name: "path",
      type: "string",
      description: "Directory or file to search in (defaults to project root)",
      required: false,
    },
    {
      name: "include",
      type: "string",
      description: "Glob pattern to filter files (e.g. '*.ts', '*.{js,ts}')",
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
    const include = (args.include as string) || "*";

    try {
      const regex = new RegExp(pattern, "g");
      const results: string[] = [];
      const maxResults = 250;

      this.searchFiles(searchPath, regex, include, results, maxResults);

      if (results.length === 0) {
        return this.success("", "No matches found.", Date.now() - start);
      }

      return this.success("", results.join("\n"), Date.now() - start, {
        matchCount: results.length,
        truncated: results.length >= maxResults,
      });
    } catch (e: any) {
      return this.error("", `Grep error: ${e.message}`, Date.now() - start);
    }
  }

  private searchFiles(
    dir: string,
    regex: RegExp,
    include: string,
    results: string[],
    maxResults: number
  ): void {
    if (results.length >= maxResults) return;

    const includeRegex = this.globToRegex(include);
    const skipDirs = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", "venv", ".venv"]);

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;

        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith(".")) {
            this.searchFiles(fullPath, regex, include, results, maxResults);
          }
        } else if (entry.isFile() && includeRegex.test(entry.name)) {
          try {
            const stats = statSync(fullPath);
            if (stats.size > 1024 * 1024) continue; // skip >1MB files

            const content = readFileSync(fullPath, "utf-8");
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                const relPath = relative(process.cwd(), fullPath);
                results.push(`${relPath}:${i + 1}: ${lines[i].trim().substring(0, 200)}`);
                if (results.length >= maxResults) return;
              }
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    } catch {
      // skip inaccessible directories
    }
  }

  private globToRegex(pattern: string): RegExp {
    let p = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${p}$`);
  }
}
