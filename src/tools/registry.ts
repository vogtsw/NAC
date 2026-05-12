/**
 * Tool Registry — central registration, discovery, and schema generation.
 * All tools must be registered here before they can be used by the agent loop.
 */

import { Tool } from "./base.js";
import type { ToolDefinition } from "../agent/types.js";

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private toolOrder: string[] = [];

  /**
   * Register a tool instance.
   */
  register(tool: Tool): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
    this.toolOrder.push(tool.name);
    return this;
  }

  /**
   * Register multiple tools at once.
   */
  registerAll(tools: Tool[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools.
   */
  getAll(): Tool[] {
    return this.toolOrder.map((name) => this.tools.get(name)!);
  }

  /**
   * Get tool definitions (for prompt construction).
   */
  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      safeForParallel: t.metadata.safeForParallel,
      requiresApproval: t.metadata.requiresApproval,
      jsonSchema: t.toJSONSchema(),
    }));
  }

  /**
   * Generate OpenAI-compatible tool definitions for API calls.
   */
  toOpenAITools(): Record<string, unknown>[] {
    return this.getAll().map((t) => t.toOpenAITool());
  }

  /**
   * Get list of "safe for parallel" tools.
   */
  getParallelSafeTools(): string[] {
    return this.getAll()
      .filter((t) => t.metadata.safeForParallel)
      .map((t) => t.name);
  }

  /**
   * Get tools that require human approval.
   */
  getApprovalRequiredTools(): string[] {
    return this.getAll()
      .filter((t) => t.metadata.requiresApproval)
      .map((t) => t.name);
  }

  /**
   * Remove a tool.
   */
  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      this.toolOrder = this.toolOrder.filter((n) => n !== name);
    }
    return removed;
  }

  /**
   * Clear all registered tools.
   */
  clear(): void {
    this.tools.clear();
    this.toolOrder = [];
  }

  /**
   * Number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Iterate tools.
   */
  [Symbol.iterator](): Iterator<Tool> {
    return this.getAll()[Symbol.iterator]();
  }
}

// ── Singleton ──────────────────────────────────────────────

let defaultRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry();
  }
  return defaultRegistry;
}

export function resetToolRegistry(): void {
  defaultRegistry = null;
}
