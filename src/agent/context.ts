/**
 * Context Builder — assembles the full prompt context for each agent turn.
 * Follows the "stable prefix + variable suffix" pattern for prompt caching.
 *
 * Key insight from Claude Code / Hermes Agent:
 * - System prompt + tool defs = stable prefix (rarely changes, cache-friendly)
 * - Conversation history + user request = variable suffix (changes every turn)
 * - Memory / skills injection happens at the boundary
 */

import type { Message, ToolDefinition } from "./types.js";

export interface ContextConfig {
  systemPrompt: string;
  tools: ToolDefinition[];
  skills?: string[];
  memoryNotes?: string;
  workingDir?: string;
  maxHistoryMessages?: number;
}

export interface BuildContextResult {
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
  }>;
  /** Byte offset where the cacheable prefix ends */
  cacheBreakpoint?: number;
}

export class ContextBuilder {
  private config: ContextConfig;
  private cachedSystemPrompt?: string;
  private cachedSystemPromptHash?: string;

  constructor(config: ContextConfig) {
    this.config = config;
  }

  /**
   * Build the list of messages to send to the LLM.
   * Structure: [system_prompt, ...history, user_request]
   */
  build(
    userRequest: string,
    history: Message[] = [],
    options: { skipSystemPrompt?: boolean } = {}
  ): BuildContextResult {
    const messages: Array<{
      role: "system" | "user" | "assistant" | "tool";
      content: string;
    }> = [];

    let cacheBreakpoint: number | undefined;

    if (!options.skipSystemPrompt) {
      const systemContent = this.buildSystemPrompt();
      messages.push({ role: "system", content: systemContent });
      // Cache breakpoint: the system prompt is the stable prefix
      cacheBreakpoint = Buffer.byteLength(systemContent, "utf-8");
    }

    // Inject memory notes as a system-level message if available
    if (this.config.memoryNotes) {
      messages.push({
        role: "system",
        content: `[Memory Notes]\n${this.config.memoryNotes}`,
      });
    }

    // Add relevant history (limited by maxHistoryMessages)
    const maxHistory = this.config.maxHistoryMessages ?? 50;
    const recentHistory = history.slice(-maxHistory);

    for (const msg of recentHistory) {
      if (msg.role === "system") continue; // skip old system messages
      const content = typeof msg.content === "string" ? msg.content : this.flattenContent(msg.content);
      messages.push({ role: msg.role, content });
    }

    // Add current user request
    messages.push({ role: "user", content: userRequest });

    return { messages, cacheBreakpoint };
  }

  /**
   * Build the complete system prompt from components.
   * This is cached aggressively — it only changes when tools/skills change.
   */
  private buildSystemPrompt(): string {
    const parts: string[] = [];

    // 1. Core system prompt
    parts.push(this.config.systemPrompt);

    // 2. Working directory context
    if (this.config.workingDir) {
      parts.push(`\n## Working Directory\n${this.config.workingDir}`);
    }

    // 3. Available skills
    if (this.config.skills && this.config.skills.length > 0) {
      parts.push(`\n## Available Skills\n${this.config.skills.join(", ")}`);
    }

    // 4. Tool definitions
    parts.push(`\n## Available Tools\n`);
    parts.push(this.formatToolDefinitions());

    // 5. Important instructions
    parts.push(this.getBaseInstructions());

    return parts.join("\n");
  }

  /**
   * Format tool definitions for the system prompt.
   */
  private formatToolDefinitions(): string {
    return this.config.tools
      .map((t) => {
        const params = t.parameters
          .map((p) => `  - ${p.name} (${p.type}${p.required === false ? ", optional" : ""}): ${p.description}`)
          .join("\n");
        return `### ${t.name}\n${t.description}\nParameters:\n${params}`;
      })
      .join("\n\n");
  }

  /**
   * Core behavioral instructions for the agent.
   */
  private getBaseInstructions(): string {
    return `
## Instructions
1. Analyze the user's request carefully. Break complex tasks into smaller steps.
2. Use tools to gather information before taking action. Read files first, then edit.
3. After completing file operations, summarize what was done.
4. If a tool fails, analyze the error and try an alternative approach.
5. Call \`task_complete\` when you have fully addressed the user's request.
6. Do not ask for confirmation for safe operations — just execute.
7. If you are unsure about a destructive operation, explain the risk first.

## Important
- Use \`file_read\` before \`file_edit\` to see current file contents.
- Use \`grep\` to find where something is defined before editing.
- Use \`glob\` to find files matching a pattern.
- Use \`bash\` for running commands (tests, builds, git, etc.).
- Edit existing files with \`file_edit\` using exact string matching.
- Create new files with \`file_write\`.`;
  }

  /**
   * Invalidate the cached system prompt (e.g. after tool registration).
   */
  invalidateCache(): void {
    this.cachedSystemPrompt = undefined;
    this.cachedSystemPromptHash = undefined;
  }

  /**
   * Get the current system prompt (cached).
   */
  getSystemPrompt(): string {
    if (!this.cachedSystemPrompt) {
      this.cachedSystemPrompt = this.buildSystemPrompt();
    }
    return this.cachedSystemPrompt;
  }

  private flattenContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (c.type === "text") return c.text;
          if (c.type === "tool_call") return `[Tool Call: ${c.name}(${JSON.stringify(c.arguments)})]`;
          if (c.type === "tool_result") return `[Tool Result: ${c.result}]`;
          return JSON.stringify(c);
        })
        .join("\n");
    }
    return String(content);
  }
}

/**
 * Build the default system prompt for the harness.
 */
export function getDefaultSystemPrompt(): string {
  return `You are an AI Agent with access to tools for reading, writing, editing files, searching code, and running commands.

You are:
- Precise: make small, targeted edits rather than rewriting entire files
- Observant: read files and search code before making changes
- Safe: never execute dangerous commands or access files outside the project
- Thorough: verify your work by reading files or running tests after changes

Your primary role is to help with software engineering tasks — writing code, debugging, refactoring, running tests, and managing files.`;
}
