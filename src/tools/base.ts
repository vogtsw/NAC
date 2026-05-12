/**
 * Base Tool definition — every tool in the harness must implement this.
 * Inspired by Claude Code's Tool.ts and Hermes Agent's tool registry.
 */

import type {
  ToolDefinition,
  ToolExecutorFn,
  ToolExecutionContext,
  ToolResult,
} from "../agent/types.js";
import { z } from "zod";

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolDefinition["parameters"];

  /** Whether safe to run in parallel with other safe tools */
  readonly safeForParallel: boolean = false;

  /** Whether this tool requires human approval */
  readonly requiresApproval: boolean = false;

  /** Execute the tool */
  abstract execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  /** Generate the JSON Schema for this tool's parameters */
  toJSONSchema(): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of this.parameters) {
      const propDef: Record<string, unknown> = {
        type: param.type,
        description: param.description,
      };
      if (param.enum) propDef.enum = param.enum;
      if (param.items) propDef.items = param.items;
      if (param.properties) {
        const nested: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(param.properties)) {
          const nestedDef: Record<string, unknown> = { type: v.type, description: v.description };
          if (v.enum) nestedDef.enum = v.enum;
          nested[k] = nestedDef;
        }
        propDef.properties = nested;
      }
      properties[param.name] = propDef;
      if (param.required !== false) required.push(param.name);
    }

    return {
      type: "object",
      properties,
      required,
    };
  }

  /** Convert to OpenAI-style tool definition */
  toOpenAITool(): Record<string, unknown> {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.toJSONSchema(),
      },
    };
  }

  /** Convenience: wrap result for success */
  protected success(
    toolCallId: string,
    result: string,
    duration: number,
    metadata?: Record<string, unknown>
  ): ToolResult {
    return { toolCallId, name: this.name, result, isError: false, duration, metadata };
  }

  /** Convenience: wrap result for error */
  protected error(
    toolCallId: string,
    error: string,
    duration: number
  ): ToolResult {
    return { toolCallId, name: this.name, result: error, isError: true, duration };
  }
}

/**
 * Create a tool from a plain function (for simple tools).
 */
export function createFunctionTool(
  name: string,
  description: string,
  parameters: ToolDefinition["parameters"],
  fn: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>,
  opts?: { safeForParallel?: boolean; requiresApproval?: boolean }
): Tool {
  return new (class extends Tool {
    readonly name = name;
    readonly description = description;
    readonly parameters = parameters;
    readonly safeForParallel = opts?.safeForParallel ?? false;
    readonly requiresApproval = opts?.requiresApproval ?? false;

    async execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext
    ): Promise<ToolResult> {
      const start = Date.now();
      try {
        const result = await fn(args, ctx);
        return this.success("fn", result, Date.now() - start);
      } catch (e: any) {
        return this.error("fn", e.message, Date.now() - start);
      }
    }
  })();
}
