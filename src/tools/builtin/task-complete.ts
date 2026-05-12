/**
 * TaskCompleteTool — explicit signal that the agent has finished its task.
 */

import { Tool } from "../base.js";
import type { ToolExecutionContext, ToolResult } from "../../agent/types.js";

export class TaskCompleteTool extends Tool {
  readonly name = "task_complete";
  readonly description =
    "Call this tool when you have completed the user's task. " +
    "Provide a summary of what was done and any relevant results. " +
    "This signals to the harness that the agent loop should stop.";
  readonly metadata = { category: "read" as const, touchesPaths: false, safeForParallel: false, requiresApproval: false };
  readonly parameters = [
    {
      name: "summary",
      type: "string",
      description: "Summary of what was accomplished",
    },
    {
      name: "artifacts",
      type: "array",
      description: "List of created or modified files (optional)",
      required: false,
      items: { type: "string" },
    },
  ];

  async execute(
    args: Record<string, unknown>,
    _context: ToolExecutionContext
  ): Promise<ToolResult> {
    const summary = (args.summary as string) || "Task completed.";
    const artifacts = (args.artifacts as string[]) || [];

    return this.success("", summary, 0, {
      artifacts,
      completed: true,
    });
  }
}
