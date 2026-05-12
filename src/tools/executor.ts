/**
 * Tool Executor — handles parallel/sequential execution of tool calls.
 * Implements the execution logic from Claude Code (parallel for safe tools)
 * and Hermes Agent (sequential for overlapping/dangerous tools).
 */

import { ToolRegistry } from "./registry.js";
import type { ToolCall, ToolResult, ToolExecutionContext } from "../agent/types.js";

export interface ExecutorOptions {
  /** Max parallel concurrent tool executions */
  maxParallel?: number;
  /** Timeout per tool call in ms */
  timeout?: number;
}

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private options: ExecutorOptions = {}
  ) {}

  /**
   * Execute a list of tool calls.
   * Safe tools run in parallel; dangerous/overlapping tools run sequentially.
   */
  async execute(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];
    if (toolCalls.length === 1) {
      return [await this.executeOne(toolCalls[0], context)];
    }

    // Classify: safe vs needs-sequential
    const safeTools = new Set(this.registry.getParallelSafeTools());

    const allSafe = toolCalls.every((tc) => safeTools.has(tc.name));
    const noPathOverlap = this.checkNoPathOverlap(toolCalls);

    if (allSafe && noPathOverlap) {
      return this.executeParallel(toolCalls, context);
    }

    return this.executeSequential(toolCalls, context);
  }

  /**
   * Execute a single tool call with timeout and error handling.
   */
  private async executeOne(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Unknown tool: ${toolCall.name}`,
        isError: true,
        duration: 0,
      };
    }

    const timeout = this.options.timeout ?? 120_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        tool.execute(toolCall.arguments, context),
        new Promise<ToolResult>((_, reject) =>
          timeoutId = setTimeout(
            () => reject(new Error(`Tool "${toolCall.name}" timed out after ${timeout}ms`)),
            timeout
          )
        ),
      ]);

      return {
        ...result,
        toolCallId: toolCall.id,
      };
    } catch (e: any) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Tool execution error: ${e.message}`,
        isError: true,
        duration: 0,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Execute tool calls in parallel (for safe, non-overlapping tools).
   */
  private async executeParallel(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    const maxParallel = this.options.maxParallel ?? 8;
    const results: ToolResult[] = [];

    for (let i = 0; i < toolCalls.length; i += maxParallel) {
      const batch = toolCalls.slice(i, i + maxParallel);
      const batchResults = await Promise.all(
        batch.map((tc) => this.executeOne(tc, context))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Execute tool calls sequentially.
   */
  private async executeSequential(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const tc of toolCalls) {
      results.push(await this.executeOne(tc, context));
    }
    return results;
  }

  /**
   * Check if any two tool calls might operate on the same file paths.
   * If so, they should not be parallelized.
   */
  private checkNoPathOverlap(toolCalls: ToolCall[]): boolean {
    const paths = new Set<string>();

    for (const tc of toolCalls) {
      const args = tc.arguments;
      const filePath =
        (args.path as string) ||
        (args.filePath as string) ||
        (args.target as string) ||
        (args.file as string);

      if (filePath) {
        if (paths.has(filePath)) return false;
        paths.add(filePath);
      }
    }

    return true;
  }
}
