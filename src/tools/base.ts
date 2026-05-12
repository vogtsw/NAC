/**
 * Base Tool definition — every tool in the harness must implement this.
 *
 * v3 enhancements:
 * - Optional zod schema per tool for args validation
 * - Tool metadata: category (read/write/network/shell/destructive) + path tracking
 * - Unified `validateArgs()` before execution
 * - Structured permission result support
 */
import type {
  ToolDefinition,
  ToolExecutorFn,
  ToolExecutionContext,
  ToolResult,
} from "../agent/types.js";
import { z } from "zod";

// ── Tool metadata ────────────────────────────────────────────

export type ToolCategory =
  | "read"        // file reads, glob, grep — safe, parallelizable
  | "write"       // file writes, edits — serial by path
  | "network"     // external API calls
  | "shell"       // bash / command execution
  | "destructive"; // rm, chmod, sudo, etc.

export interface ToolMetadata {
  category: ToolCategory;
  /** File paths this tool may touch (for read/write locking) */
  touchesPaths?: boolean;
  /** Whether this tool is safe to run in parallel with other safe tools */
  safeForParallel: boolean;
  /** Whether this tool requires human approval */
  requiresApproval: boolean;
  /** Detailed description of what this tool modifies */
  sideEffects?: string;
}

// ── Permission result ────────────────────────────────────────

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
}

// ── Validation result ────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

// ── Abstract Tool ─────────────────────────────────────────────

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolDefinition["parameters"];

  /** Zod schema for runtime args validation (optional, falls back to parameter defs) */
  readonly schema?: z.ZodType<any>;

  /** Tool metadata */
  abstract readonly metadata: ToolMetadata;

  /** Execute the tool */
  abstract execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  /** Generate the JSON Schema for this tool's parameters */
  toJSONSchema(): Record<string, unknown> {
    // If a zod schema is provided, use it to generate the JSON Schema
    if (this.schema) {
      return zodToJsonSchema(this.schema);
    }

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

    return { type: "object", properties, required };
  }

  /** Validate arguments before execution */
  validateArgs(args: Record<string, unknown>): ValidationResult {
    if (!this.schema) {
      // Fall back to basic parameter-based validation
      return this.validateFromParams(args);
    }

    const result = this.schema.safeParse(args);
    if (result.success) return { valid: true, errors: [] };

    const errors = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return { valid: false, errors };
  }

  /** Basic validation from parameter definitions */
  private validateFromParams(args: Record<string, unknown>): ValidationResult {
    const errors: Array<{ path: string; message: string }> = [];

    for (const param of this.parameters) {
      const hasKey = param.name in args;
      const value = args[param.name];

      if (param.required !== false && (!hasKey || value === undefined)) {
        errors.push({ path: param.name, message: `Required parameter "${param.name}" is missing` });
        continue;
      }

      if (hasKey && value !== undefined && value !== null) {
        // Basic type checking
        const expectedType = param.type;
        if (expectedType === "string" && typeof value !== "string") {
          errors.push({ path: param.name, message: `Expected string, got ${typeof value}` });
        }
        if (expectedType === "number" && typeof value !== "number") {
          errors.push({ path: param.name, message: `Expected number, got ${typeof value}` });
        }
        if (expectedType === "boolean" && typeof value !== "boolean") {
          errors.push({ path: param.name, message: `Expected boolean, got ${typeof value}` });
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /** Get the permission decision for this tool in the given context */
  getPermission(context: ToolExecutionContext): PermissionResult {
    if (this.metadata.requiresApproval) {
      // Check if path is in approved set
      const args = context as any;
      const filePath = args._pendingArgs?.path || args._pendingArgs?.filePath;
      if (filePath && context.approvedPaths?.has(filePath)) {
        return { decision: "allow", reason: "Path in approved set" };
      }
      return { decision: "ask", reason: this.metadata.sideEffects ?? "Requires approval" };
    }
    if (this.metadata.category === "destructive") {
      return { decision: "ask", reason: "Destructive operation" };
    }
    return { decision: "allow" };
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

// ── Function tool factory ────────────────────────────────────

export function createFunctionTool(
  name: string,
  description: string,
  parameters: ToolDefinition["parameters"],
  fn: (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<string>,
  opts?: {
    safeForParallel?: boolean;
    requiresApproval?: boolean;
    category?: ToolCategory;
    touchesPaths?: boolean;
    schema?: z.ZodType<any>;
    sideEffects?: string;
  }
): Tool {
  return new (class extends Tool {
    readonly name = name;
    readonly description = description;
    readonly parameters = parameters;
    readonly schema = opts?.schema;
    readonly metadata: ToolMetadata = {
      category: opts?.category ?? "read",
      touchesPaths: opts?.touchesPaths ?? false,
      safeForParallel: opts?.safeForParallel ?? (opts?.category === "read"),
      requiresApproval: opts?.requiresApproval ?? (opts?.category === "destructive"),
      sideEffects: opts?.sideEffects,
    };

    async execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext
    ): Promise<ToolResult> {
      const start = Date.now();

      // Validate args before execution
      const validation = this.validateArgs(args);
      if (!validation.valid) {
        return this.error(
          "fn",
          `Schema validation failed: ${validation.errors.map(e => `${e.path}: ${e.message}`).join("; ")}`,
          Date.now() - start
        );
      }

      try {
        const result = await fn(args, ctx);
        return this.success("fn", result, Date.now() - start);
      } catch (e: any) {
        return this.error("fn", e.message, Date.now() - start);
      }
    }
  })();
}

// ── Zod → JSON Schema conversion (minimal) ───────────────────

function zodToJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  return zodTypeToJson(schema);
}

function zodTypeToJson(zodType: z.ZodType<any>): Record<string, unknown> {
  const def = (zodType as any)._def ?? {};

  // Handle effects (refine, transform, etc.)
  let innerType = zodType;
  if (def.typeName === "ZodEffects") {
    innerType = def.schema;
    return zodTypeToJson(innerType);
  }

  switch (def.typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodArray":
      return { type: "array", items: def.type ? zodTypeToJson(def.type) : {} };
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const props: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        props[key] = zodTypeToJson(value as z.ZodType<any>);
        if (!(value as any).isOptional?.()) required.push(key);
      }
      const result: Record<string, unknown> = { type: "object", properties: props };
      if (required.length > 0) result.required = required;
      return result;
    }
    case "ZodOptional":
      return zodTypeToJson(def.innerType);
    case "ZodEnum": {
      const values = def.values ?? [];
      const valueType = values.length > 0 ? typeof values[0] : "string";
      return { type: valueType, enum: values };
    }
    case "ZodUnion": {
      const opts = (def.options ?? []) as z.ZodType<any>[];
      // Try to extract a common type
      const types = opts.map((o) => zodTypeToJson(o));
      if (types.every((t) => t.type === "string")) return { type: "string" };
      if (types.every((t) => t.type === "number")) return { type: "number" };
      return { type: "string" }; // fallback
    }
    default:
      return { type: "string" };
  }
}
