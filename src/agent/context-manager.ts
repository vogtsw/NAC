/**
 * ContextManager — intelligent context management with token budgets,
 * structured state tracking, and pair-aware compression.
 *
 * Replaces the ad-hoc "MAX_HISTORY = 10" approach with:
 * - Token budget allocation across layers (system, task, code, state, memory)
 * - Structured state: task objectives, read/modified files, failed tools, todos
 * - Pair-aware truncation that never splits tool-call/tool-result
 * - Optional session-DB retrieval for long-running tasks
 */
import type { Message, ToolResult } from "./types.js";
import {
  estimateTotalTokens,
  truncateTranscript,
  buildCompressionText,
  hasToolCalls,
  extractToolCalls,
  extractText,
  getToolCallId,
  isToolResult,
} from "./transcript.js";

// ── Structured state ─────────────────────────────────────────

export interface TaskObjective {
  description: string;
  constraints: string[];
  priority: "high" | "medium" | "low";
}

export interface FileState {
  path: string;
  operation: "read" | "modified" | "created" | "deleted";
  timestamp: number;
  summary?: string;
}

export interface FailedTool {
  name: string;
  args: Record<string, unknown>;
  error: string;
  timestamp: number;
}

export interface TodoItem {
  description: string;
  status: "pending" | "done" | "blocked";
}

export interface StructuredState {
  objectives: TaskObjective[];
  files: FileState[];
  failedTools: FailedTool[];
  todos: TodoItem[];
  keyFindings: string[];
  lastModifiedAt: number;
}

// ── Token budget allocation ──────────────────────────────────

export interface TokenBudget {
  /** Total token ceiling */
  total: number;
  /** Allocation per layer */
  system: number;    // system prompt + tool defs
  task: number;      // current task context
  code: number;      // file contents, symbol info
  state: number;     // recent conversation / tool results
  memory: number;    // relevant historical notes
}

export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
  total: 8000,
  system: 2000,
  task: 1000,
  code: 2000,
  state: 2000,
  memory: 1000,
};

// ── ContextManager ───────────────────────────────────────────

export interface ContextManagerConfig {
  budget?: Partial<TokenBudget>;
  /** Session DB for retrieving relevant history */
  sessionDB?: any;
  /** Whether to track structured state */
  trackState?: boolean;
}

export class ContextManager {
  private budget: TokenBudget;
  private state: StructuredState;
  private sessionDB?: any;
  private trackState: boolean;

  constructor(config: ContextManagerConfig = {}) {
    this.budget = { ...DEFAULT_TOKEN_BUDGET, ...config.budget };
    this.sessionDB = config.sessionDB;
    this.trackState = config.trackState ?? true;
    this.state = this.createEmptyState();
  }

  // ── State tracking ─────────────────────────────────────────

  createEmptyState(): StructuredState {
    return {
      objectives: [],
      files: [],
      failedTools: [],
      todos: [],
      keyFindings: [],
      lastModifiedAt: Date.now(),
    };
  }

  resetState(): void {
    this.state = this.createEmptyState();
  }

  getState(): Readonly<StructuredState> {
    return this.state;
  }

  addObjective(objective: TaskObjective): void {
    this.state.objectives.push(objective);
    this.state.lastModifiedAt = Date.now();
  }

  trackFile(path: string, operation: FileState["operation"], summary?: string): void {
    // Update existing entry if already tracked
    const existing = this.state.files.find((f) => f.path === path);
    if (existing) {
      existing.operation = operation;
      existing.timestamp = Date.now();
      if (summary) existing.summary = summary;
    } else {
      this.state.files.push({ path, operation, timestamp: Date.now(), summary });
    }
    this.state.lastModifiedAt = Date.now();
  }

  trackFailedTool(name: string, args: Record<string, unknown>, error: string): void {
    this.state.failedTools.push({ name, args, error, timestamp: Date.now() });
    // Keep only last 20 failures
    if (this.state.failedTools.length > 20) {
      this.state.failedTools = this.state.failedTools.slice(-20);
    }
    this.state.lastModifiedAt = Date.now();
  }

  addTodo(description: string): void {
    this.state.todos.push({ description, status: "pending" });
    this.state.lastModifiedAt = Date.now();
  }

  updateTodo(index: number, status: TodoItem["status"]): void {
    if (this.state.todos[index]) {
      this.state.todos[index].status = status;
      this.state.lastModifiedAt = Date.now();
    }
  }

  addKeyFinding(finding: string): void {
    this.state.keyFindings.push(finding);
    if (this.state.keyFindings.length > 30) {
      this.state.keyFindings = this.state.keyFindings.slice(-30);
    }
    this.state.lastModifiedAt = Date.now();
  }

  /** Extract structured state from tool results */
  ingestToolResult(result: ToolResult): void {
    if (result.isError) {
      this.trackFailedTool(result.name, {}, result.result);
      return;
    }

    // Track file operations
    const meta = result.metadata ?? {};
    if (meta.filePath && typeof meta.filePath === "string") {
      const op = result.name.includes("write") ? "created" as const
        : result.name.includes("edit") ? "modified" as const
        : "read" as const;
      this.trackFile(meta.filePath as string, op, result.result.substring(0, 200));
    }

    if (result.name === "grep" || result.name === "glob") {
      const lines = result.result.split("\n").filter(Boolean);
      if (lines.length > 0 && lines.length < 20) {
        for (const line of lines.slice(0, 5)) {
          this.addKeyFinding(line.substring(0, 200));
        }
      }
    }
  }

  // ── Token budget management ────────────────────────────────

  /**
   * Check if the current messages fit within the allocated budget
   * and return the recommended action.
   */
  assessBudget(messages: Message[]): {
    fits: boolean;
    currentTokens: number;
    budget: number;
    action: "ok" | "truncate" | "compress" | "emergency";
  } {
    const currentTokens = estimateTotalTokens(messages);
    const budgetTokens = this.budget.state + this.budget.task;

    if (currentTokens <= budgetTokens * 0.7) {
      return { fits: true, currentTokens, budget: budgetTokens, action: "ok" };
    }
    if (currentTokens <= budgetTokens) {
      return { fits: true, currentTokens, budget: budgetTokens, action: "truncate" };
    }
    if (currentTokens <= budgetTokens * 1.5) {
      return { fits: false, currentTokens, budget: budgetTokens, action: "compress" };
    }
    return { fits: false, currentTokens, budget: budgetTokens, action: "emergency" };
  }

  /**
   * Manage message array within the token budget.
   * Uses truncation first, then compression if needed.
   */
  manageMessages(messages: Message[]): Message[] {
    const assessment = this.assessBudget(messages);

    switch (assessment.action) {
      case "ok":
        return messages;
      case "truncate":
        return truncateTranscript(messages, Math.floor(assessment.budget * 0.9));
      case "compress":
      case "emergency":
        // Will be called from loop.ts compressHistory, here just truncate aggressively
        return truncateTranscript(messages, Math.floor(assessment.budget * 0.6));
    }
  }

  // ── Structured state serialization ─────────────────────────

  /**
   * Build a compact text representation of the structured state
   * for injection into the system prompt.
   */
  buildStateInjection(): string {
    const parts: string[] = [];

    // Objectives
    if (this.state.objectives.length > 0) {
      parts.push("## Task Objectives");
      for (const obj of this.state.objectives) {
        parts.push(`- [${obj.priority}] ${obj.description}`);
        if (obj.constraints.length > 0) {
          parts.push(`  Constraints: ${obj.constraints.join("; ")}`);
        }
      }
    }

    // Files touched
    if (this.state.files.length > 0) {
      const recent = this.state.files.slice(-20);
      const reads = recent.filter((f) => f.operation === "read");
      const writes = recent.filter((f) => f.operation !== "read");

      if (reads.length > 0) {
        parts.push("\n## Files Read");
        for (const f of reads.slice(-10)) {
          parts.push(`- ${f.path}${f.summary ? ` — ${f.summary.substring(0, 80)}` : ""}`);
        }
      }
      if (writes.length > 0) {
        parts.push("\n## Files Modified");
        for (const f of writes.slice(-10)) {
          parts.push(`- [${f.operation}] ${f.path}${f.summary ? ` — ${f.summary.substring(0, 80)}` : ""}`);
        }
      }
    }

    // Failed tools
    if (this.state.failedTools.length > 0) {
      const recent = this.state.failedTools.slice(-5);
      parts.push("\n## Recent Tool Failures");
      for (const ft of recent) {
        parts.push(`- ${ft.name}: ${ft.error.substring(0, 100)}`);
      }
    }

    // Key findings
    if (this.state.keyFindings.length > 0) {
      parts.push("\n## Key Findings");
      for (const kf of this.state.keyFindings.slice(-15)) {
        parts.push(`- ${kf}`);
      }
    }

    // Todos
    const pending = this.state.todos.filter((t) => t.status !== "done");
    if (pending.length > 0) {
      parts.push("\n## Pending Tasks");
      for (const t of pending) {
        parts.push(`- [${t.status}] ${t.description}`);
      }
    }

    return parts.length > 1 ? parts.join("\n") : "";
  }

  /**
   * Build compression text from messages, augmented with structured state.
   * This produces richer summaries than raw message text alone.
   */
  buildCompressionText(messages: Message[]): string {
    const base = buildCompressionText(messages);

    const stateParts: string[] = [];
    if (this.state.files.length > 0) {
      const fileList = this.state.files
        .map((f) => `  [${f.operation}] ${f.path}`)
        .join("\n");
      stateParts.push(`Files touched:\n${fileList}`);
    }
    if (this.state.keyFindings.length > 0) {
      stateParts.push(`Key findings:\n${this.state.keyFindings.slice(-10).map((f) => `  - ${f}`).join("\n")}`);
    }
    if (this.state.failedTools.length > 0) {
      stateParts.push(`Failures:\n${this.state.failedTools.slice(-5).map((f) => `  - ${f.name}: ${f.error}`).join("\n")}`);
    }

    if (stateParts.length > 0) {
      return base + "\n\n## Structured State\n" + stateParts.join("\n\n");
    }
    return base;
  }

  // ── Memory retrieval ───────────────────────────────────────

  /**
   * Retrieve relevant historical context from session DB.
   * Returns empty string if no session DB is configured or no relevant history found.
   */
  async retrieveRelevantHistory(taskDescription: string): Promise<string> {
    if (!this.sessionDB) return "";

    try {
      const sessions = await this.sessionDB.search(taskDescription, 3);
      if (!sessions || sessions.length === 0) return "";

      const parts: string[] = ["## Relevant Past Sessions"];
      for (const s of sessions) {
        const msgCount = s.messages?.length ?? 0;
        const outcome = s.metadata?.outcome ?? "unknown";
        parts.push(`- Session ${s.id}: ${msgCount} msgs, outcome=${outcome}`);
      }
      return parts.join("\n");
    } catch {
      return "";
    }
  }
}

// ── Singleton ────────────────────────────────────────────────

let defaultManager: ContextManager | null = null;

export function getContextManager(): ContextManager {
  if (!defaultManager) defaultManager = new ContextManager();
  return defaultManager;
}

export function resetContextManager(): void {
  defaultManager = null;
}
