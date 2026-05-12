/**
 * FileWriteTool — writes content to a file.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { writeFileSync, mkdirSync } from "fs";
import { dirname, resolve, normalize } from "path";

export class FileWriteTool extends Tool {
  readonly name = "file_write";
  readonly description =
    "Write content to a file. Creates parent directories if needed. " +
    "Overwrites existing files. Use this to create or update files.";
  readonly parameters = [
    {
      name: "filePath",
      type: "string",
      description: "Path to the file to write (absolute or relative to project root)",
    },
    {
      name: "content",
      type: "string",
      description: "Content to write to the file",
    },
  ];
  readonly metadata = { category: "write" as const, touchesPaths: true, safeForParallel: false, requiresApproval: true, sideEffects: "Creates or overwrites files" };

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const filePath = normalize(resolve(context.workingDir, args.filePath as string));
    const content = args.content as string;

    if (!this.isPathSafe(filePath, context)) {
      return this.error(
        "",
        `Access denied: "${filePath}" is outside the allowed working directory`,
        Date.now() - start
      );
    }

    try {
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, "utf-8");
      return this.success("", `File successfully written: ${filePath}`, Date.now() - start, {
        filePath,
        size: Buffer.byteLength(content, "utf-8"),
      });
    } catch (e: any) {
      return this.error("", `Failed to write file: ${e.message}`, Date.now() - start);
    }
  }

  private isPathSafe(filePath: string, context: ToolExecutionContext): boolean {
    const normalizedWd = normalize(context.workingDir);
    return filePath.startsWith(normalizedWd);
  }
}
