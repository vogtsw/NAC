/**
 * FileEditTool — edit a file by exact string replacement.
 * Inspired by Claude Code's Edit tool — uses exact string matching.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";
import { readFileSync, writeFileSync } from "fs";
import { resolve, normalize } from "path";

export class FileEditTool extends Tool {
  readonly name = "file_edit";
  readonly description =
    "Edit a file by replacing an exact string with a new string. " +
    "The old_string must match exactly (including whitespace) and must be unique in the file. " +
    "Use this for precise, small changes to existing files.";
  readonly parameters = [
    {
      name: "filePath",
      type: "string",
      description: "Path to the file to edit",
    },
    {
      name: "oldString",
      type: "string",
      description: "The exact string to find and replace (must be unique in the file)",
    },
    {
      name: "newString",
      type: "string",
      description: "The replacement string",
    },
    {
      name: "replaceAll",
      type: "boolean",
      description: "Replace all occurrences (default: false)",
      required: false,
    },
  ];
  readonly requiresApproval = true;

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const start = Date.now();
    const filePath = normalize(resolve(context.workingDir, args.filePath as string));
    const oldString = args.oldString as string;
    const newString = args.newString as string;
    const replaceAll = (args.replaceAll as boolean) || false;

    if (!this.isPathSafe(filePath, context)) {
      return this.error("", `Access denied: "${filePath}" outside working directory`, Date.now() - start);
    }

    try {
      const content = readFileSync(filePath, "utf-8");

      if (!replaceAll) {
        const count = this.countOccurrences(content, oldString);
        if (count === 0) {
          return this.error("", `String not found in file: "${oldString.substring(0, 100)}"`, Date.now() - start);
        }
        if (count > 1) {
          return this.error(
            "",
            `Found ${count} occurrences of the string. Use replaceAll=true or provide more context to make it unique.`,
            Date.now() - start
          );
        }
        const newContent = content.replace(oldString, newString);
        writeFileSync(filePath, newContent, "utf-8");
        return this.success("", `File edited: ${filePath} (1 replacement)`, Date.now() - start);
      } else {
        const count = this.countOccurrences(content, oldString);
        if (count === 0) {
          return this.error("", `String not found in file`, Date.now() - start);
        }
        const newContent = content.split(oldString).join(newString);
        writeFileSync(filePath, newContent, "utf-8");
        return this.success("", `File edited: ${filePath} (${count} replacements)`, Date.now() - start);
      }
    } catch (e: any) {
      return this.error("", `Failed to edit file: ${e.message}`, Date.now() - start);
    }
  }

  private countOccurrences(str: string, search: string): number {
    return str.split(search).length - 1;
  }

  private isPathSafe(filePath: string, context: ToolExecutionContext): boolean {
    return filePath.startsWith(normalize(context.workingDir));
  }
}
