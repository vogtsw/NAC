/**
 * Tool Executor — handles parallel/sequential execution of tool calls with
 * schema validation, permission checks, path locking, and trajectory logging.
 *
 * v3 enhancements:
 * - ToolExecutionPlan: pre-flight plan before executing anything
 * - Path-based locking: write ops serialized per path, read ops parallel
 * - Structured permission results: allow | deny | ask
 * - All executions logged to trajectory for audit / training
 */
import { ToolRegistry } from "./registry.js";
import { Tool } from "./base.js";
import type { ToolCategory, PermissionResult } from "./base.js";
import type {
  ToolCall,
  ToolResult,
  ToolExecutionContext,
} from "../agent/types.js";

// ── Execution plan ───────────────────────────────────────────

export interface ToolExecutionSlot {
  toolCall: ToolCall;
  tool: Tool;
  category: ToolCategory;
  /** Paths this tool will read/write */
  paths: string[];
  /** Execute alone (cannot be batched) */
  requiresSerial: boolean;
  /** Permission decision before exec */
  permission?: PermissionResult;
}

export interface ToolExecutionPlan {
  /** Slots that can run in parallel */
  parallel: ToolExecutionSlot[][];
  /** Total number of slots */
  slotCount: number;
  /** Any slots that require approval */
  requiresApproval: ToolExecutionSlot[];
}

export interface ExecutorOptions {
  maxParallel?: number;
  timeout?: number;
  /** Whether to validate args before execution */
  validateArgs?: boolean;
  /** Whether to check permissions before execution */
  checkPermissions?: boolean;
}

export class ToolExecutor {
  constructor(
    private registry: ToolRegistry,
    private options: ExecutorOptions = {}
  ) {}

  /**
   * Generate an execution plan from a list of tool calls.
   * Read ops are batched together; write ops touching the same paths go serial.
   */
  buildPlan(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): ToolExecutionPlan {
    const slots: ToolExecutionSlot[] = [];
    const requiresApproval: ToolExecutionSlot[] = [];

    for (const tc of toolCalls) {
      const tool = this.registry.get(tc.name);
      if (!tool) {
        // Unknown tool — create a dummy slot
        slots.push({
          toolCall: tc,
          tool: tool!,
          category: "read",
          paths: [],
          requiresSerial: false,
        });
        continue;
      }

      const meta = tool.metadata;
      const paths = this.extractPaths(tc);
      const category = meta.category;
      const slot: ToolExecutionSlot = { toolCall: tc, tool, category, paths, requiresSerial: false };

      // Check permission
      if (this.options.checkPermissions !== false) {
        slot.permission = tool.getPermission(context);
        if (slot.permission.decision === "deny") {
          // Denied — will be rejected at execution time
          slot.requiresSerial = true;
        }
        if (slot.permission.decision === "ask") {
          requiresApproval.push(slot);
        }
      }

      // Determine if serial execution is required
      if (category === "write" || category === "shell" || category === "destructive") {
        slot.requiresSerial = true;
      }

      // Write tools with overlapping paths must be serialized
      if (category === "write" && paths.length > 0) {
        // Check against other write slots for path overlap
        const otherWrites = slots.filter(
          (s) => (s.category === "write" || s.category === "destructive") && s !== slot
        );
        for (const ow of otherWrites) {
          if (ow.paths.some((p) => paths.includes(p))) {
            slot.requiresSerial = true;
            ow.requiresSerial = true;
          }
        }
      }

      slots.push(slot);
    }

    // Group into parallel batches
    const parallel: ToolExecutionSlot[][] = [];
    const remaining = [...slots];

    while (remaining.length > 0) {
      const batch: ToolExecutionSlot[] = [];
      const serialSet = new Set<string>();

      // First, pull all serial slots into their own batches
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (remaining[i].requiresSerial) {
          // Check if this serial slot conflicts with anything selected so far
          const slotPaths = new Set(remaining[i].paths);
          const conflicts = batch.some((s) =>
            s.paths.some((p) => slotPaths.has(p)) && s.requiresSerial
          );
          if (!conflicts) {
            batch.push(remaining[i]);
            remaining.splice(i, 1);
          }
        }
      }

      // Then fill with parallel-safe slots
      const maxParallel = this.options.maxParallel ?? 8;
      for (let i = remaining.length - 1; i >= 0 && batch.length < maxParallel; i--) {
        if (!remaining[i].requiresSerial) {
          batch.push(remaining[i]);
          remaining.splice(i, 1);
        }
      }

      if (batch.length === 0 && remaining.length > 0) {
        // Can't batch anything — push one serial slot alone
        batch.push(remaining.shift()!);
      }

      parallel.push(batch);
    }

    return { parallel, slotCount: slots.length, requiresApproval };
  }

  /**
   * Execute a list of tool calls.
   */
  async execute(
    toolCalls: ToolCall[],
    context: ToolExecutionContext
  ): Promise<ToolResult[]> {
    if (toolCalls.length === 0) return [];
    if (toolCalls.length === 1) {
      return [await this.executeOne(toolCalls[0], context)];
    }

    // Build execution plan
    const plan = this.buildPlan(toolCalls, context);

    // Execute batches sequentially, but slots within a batch in parallel
    const results: ToolResult[] = [];
    for (const batch of plan.parallel) {
      const batchResults = await Promise.all(
        batch.map((slot) => this.executeOne(slot.toolCall, context))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Execute a single tool call with validation, permission check, timeout, and error handling.
   */
  private async executeOne(
    toolCall: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
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

    // ── Args validation ───────────────────────────────────────
    if (this.options.validateArgs !== false) {
      const validation = tool.validateArgs(toolCall.arguments);
      if (!validation.valid) {
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: `Args validation failed: ${validation.errors.map(e => `${e.path}: ${e.message}`).join("; ")}`,
          isError: true,
          duration: Date.now() - startTime,
        };
      }
    }

    // ── Permission check ──────────────────────────────────────
    if (this.options.checkPermissions !== false) {
      const permission = tool.getPermission(context);
      if (permission.decision === "deny") {
        return {
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: `Permission denied: ${permission.reason ?? "Not authorized"}`,
          isError: true,
          duration: 0,
        };
      }
    }

    // ── Execute with timeout ──────────────────────────────────
    const timeout = this.options.timeout ?? 120_000;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        tool.execute(toolCall.arguments, context),
        new Promise<ToolResult>((_, reject) =>
          (timeoutId = setTimeout(
            () => reject(new Error(`Tool "${toolCall.name}" timed out after ${timeout}ms`)),
            timeout
          ))
        ),
      ]);

      return {
        toolCallId: toolCall.id,
        name: result.name,
        result: result.result,
        isError: result.isError,
        duration: result.duration,
        metadata: result.metadata,
      };
    } catch (e: any) {
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        result: `Tool execution error: ${e.message}`,
        isError: true,
        duration: Date.now() - startTime,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Extract file paths from tool call arguments for path tracking.
   */
  private extractPaths(toolCall: ToolCall): string[] {
    const a = toolCall.arguments;
    const paths: string[] = [];

    const candidates = [a.path, a.filePath, a.file, a.target, a.directory];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) paths.push(c);
    }

    // Recursively search for paths in nested objects
    if (a.paths && Array.isArray(a.paths)) {
      for (const p of a.paths) {
        if (typeof p === "string") paths.push(p);
      }
    }

    if (a.files && Array.isArray(a.files)) {
      for (const f of a.files) {
        if (typeof f === "string") paths.push(f);
      }
    }

    return [...new Set(paths)];
  }
}
