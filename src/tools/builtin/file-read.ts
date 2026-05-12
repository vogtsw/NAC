/**
 * FileReadTool — reads a file from the local filesystem.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { readFileSync, statSync } from "fs";
import { resolve, normalize } from "path";

export class FileReadTool extends Tool {
  readonly name = "file_read";
  readonly description =
    "Read the contents of a file. Returns the file content with line numbers. " +
    "Use this to inspect files in the project.";
  readonly parameters = [
    {
      name: "filePath",
      type: "string",
      description: "Path to the file to read (absolute or relative to project root)",
    },
    {
      name: "offset",
      type: "number",
      description: "Line number to start reading from (1-indexed, optional)",
      required: false,
    },
    {
      name: "limit",
      type: "number",
      description: "Maximum number of lines to read (optional, default: 2000)",
      required: false,
    },
  ];
  readonly safeForParallel = true;

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const filePath = normalize(resolve(context.workingDir, args.filePath as string));
    const offset = (args.offset as number) || 1;
    const limit = (args.limit as number) || 2000;

    // Path sandbox: ensure file is within working directory
    if (!this.isPathSafe(filePath, context)) {
      return this.error(
        "",
        `Access denied: "${filePath}" is outside the allowed working directory`,
        Date.now() - start
      );
    }

    try {
      const stats = statSync(filePath);
      if (stats.isDirectory()) {
        return this.error("", `"${filePath}" is a directory, not a file`, Date.now() - start);
      }

      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const selected = lines.slice(offset - 1, offset - 1 + limit);

      // Format with line numbers
      const formatted = selected
        .map((line, i) => `${offset + i}\t${line}`)
        .join("\n");

      const result = formatted || "(empty file)";
      return this.success("", result, Date.now() - start, {
        totalLines: lines.length,
        displayedLines: selected.length,
        offset,
        limit,
      });
    } catch (e: any) {
      return this.error("", `Failed to read file: ${e.message}`, Date.now() - start);
    }
  }

  private isPathSafe(filePath: string, context: ToolExecutionContext): boolean {
    const normalizedWd = normalize(context.workingDir);
    return filePath.startsWith(normalizedWd);
  }
}
