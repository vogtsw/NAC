/**
 * Agent Loop — the core conversation engine.
 * Flow: build prompt → call LLM → parse response → execute tools → repeat
 *
 * v3: Uses typed Transcript layer instead of JSON-stringified tool calls.
 */
import { ContextBuilder, getDefaultSystemPrompt } from "./context.js";
import { ToolRegistry, getToolRegistry } from "../tools/registry.js";
import { redactSecrets, ToolExecutor } from "../tools/executor.js";
import { getBuiltinTools } from "../tools/builtin/index.js";
import type { LLMAdapter } from "../llm/adapter.js";
import { getDefaultAdapter } from "../llm/index.js";
import type {
  AgentConfig, AgentResult, AgentStopReason, AgentTurn,
  Message, TokenUsage, ToolCall, ToolResult, ToolExecutionContext,
} from "./types.js";
import {
  createAssistantMessage,
  createToolResultMessage,
  createUserMessage,
  extractToolCalls,
  extractText,
  hasToolCalls,
  toChatMessages,
  truncateTranscript,
  buildCompressionText,
  estimateTotalTokens,
} from "./transcript.js";

export interface LoopOptions {
  config?: Partial<AgentConfig>;
  llm?: LLMAdapter;
  registry?: ToolRegistry;
  contextBuilder?: ContextBuilder;
  history?: Message[];
  workingDir?: string;
  signal?: AbortSignal;
}

/** Error categories for structured error handling */
export type ErrorCategory =
  | "provider_protocol"   // API-level errors (tool_calls format, deserialization)
  | "context_overflow"    // Payload too large
  | "tool_schema"         // Tool schema validation failed
  | "tool_permission"     // Tool execution denied
  | "tool_loop"           // Repeated identical tool calls
  | "task_validation";    // Task quality check failed

export interface StructuredError {
  category: ErrorCategory;
  message: string;
  detail?: unknown;
}

export class AgentLoop {
  private config: AgentConfig;
  private llm: LLMAdapter;
  private registry: ToolRegistry;
  private contextBuilder: ContextBuilder;
  private executor: ToolExecutor;
  private history: Message[];
  private recentToolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  private readonly maxRepeatedCalls = 3;
  private readonly TOKEN_BUDGET = 8000;

  private static readonly VAGUE_PATTERNS: RegExp[] = [
    /improve\s+(?:the\s+)?(?:project|code|this|it)/i,
    /make\s+(?:it|this|the\s+(?:project|code))\s+better/i,
    /fix\s+(?:the\s+)?(?:issues?|problems?|bugs?)/i,
    /optimize\s+(?:the\s+)?(?:project|code|this)/i,
    /clean\s+up\s+(?:the\s+)?(?:project|code)/i,
    /refactor\s+(?:the\s+)?(?:project|code|everything)/i,
    /enhance\s+(?:the\s+)?(?:project|code)/i,
  ];

  private static readonly SPECIFICITY_PATTERNS: RegExp[] = [
    /(?:file|function|class|module|test|method|variable|type|interface|component)\s/i,
    /(?:error|exception|bug|failure|warning|stack\s*trace)/i,
    /(?:src\/|lib\/|test\/|app\/)/,
    /\.(ts|js|py|json|yaml|md)/,
  ];

  private static isTaskUnderspecified(userRequest: string): boolean {
    const isVague = AgentLoop.VAGUE_PATTERNS.some(p => p.test(userRequest));
    const hasSpecifics = AgentLoop.SPECIFICITY_PATTERNS.some(p => p.test(userRequest));
    return isVague && !hasSpecifics && userRequest.length < 200;
  }

  constructor(options: LoopOptions = {}) {
    this.config = {
      model: options.config?.model ?? "deepseek-chat",
      provider: options.config?.provider ?? "deepseek",
      maxIterations: options.config?.maxIterations ?? 50,
      temperature: options.config?.temperature ?? 0.7,
      maxTokens: options.config?.maxTokens ?? 4096,
      workingDir: options.config?.workingDir ?? options.workingDir ?? process.cwd(),
    };
    this.llm = options.llm ?? getDefaultAdapter();
    this.registry = options.registry ?? getToolRegistry();
    if (this.registry.size === 0) this.registry.registerAll(getBuiltinTools());
    this.contextBuilder = options.contextBuilder ?? new ContextBuilder({
      systemPrompt: options.config?.systemPrompt ?? getDefaultSystemPrompt(),
      tools: this.registry.getDefinitions(),
      workingDir: this.config.workingDir,
    });
    this.executor = new ToolExecutor(this.registry);
    this.history = options.history ?? [];
  }

  async run(userRequest: string, signal?: AbortSignal): Promise<AgentResult> {
    const startTime = Date.now();
    let iterations = 0;
    let totalTokens: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    const turns: AgentTurn[] = [];
    let finalResponse = "";
    let stopReason: AgentStopReason = "task_completed";
    const allToolResults: ToolResult[] = [];

    // Use typed message construction — no JSON strings
    this.history.push(createUserMessage(userRequest));

    // ── Underspecified task detection ─────────────────────────
    if (AgentLoop.isTaskUnderspecified(userRequest)) {
      this.history.push(createUserMessage(
        "[System Guidance] This request is too vague to execute safely. " +
        "Before using any tools, ask the user to clarify: " +
        "(1) What specific aspect should be changed? " +
        "(2) What is the acceptance criteria? " +
        "(3) Which files, functions, or modules are involved? " +
        "Do NOT execute tools until the user provides specifics."
      ));
    }

    const toolContext: ToolExecutionContext = {
      sessionId: `session_${Date.now()}`,
      workingDir: this.config.workingDir ?? process.cwd(),
      approvedPaths: new Set([this.config.workingDir ?? process.cwd()]),
      signal,
    };

    while (iterations < this.config.maxIterations) {
      if (signal?.aborted) { stopReason = "user_interrupt"; break; }
      iterations++;
      const turnStart = Date.now();

      // ── Context budget management ──────────────────────────
      // Use token-aware truncation instead of fixed MAX_HISTORY=10
      if (estimateTotalTokens(this.history) > this.TOKEN_BUDGET) {
        if (this.history.length > 12 && !(this as any)._compressionTriedThisTurn) {
          (this as any)._compressionTriedThisTurn = true;
          await this.compressHistory();
        }
        // Truncate to token budget preserving tool-call/result pairs
        this.history = truncateTranscript(this.history, this.TOKEN_BUDGET);
      }

      // Build messages for API call
      let apiMessages: any[];

      if (iterations === 1) {
        // First iteration: use context builder (system prompt + user request)
        const { messages: rawMsgs } = this.contextBuilder.build(
          userRequest,
          this.history,
          { skipSystemPrompt: false }
        );
        apiMessages = toChatMessages(rawMsgs);
      } else {
        // Subsequent iterations: build directly from typed history to preserve
        // tool_calls and tool_call_id (build() flattens them to strings, breaking API protocol)
        const systemPrompt = this.contextBuilder.getSystemPrompt();
        apiMessages = [
          { role: "system", content: systemPrompt },
          ...toChatMessages(this.history),
        ];
      }

      // ── Call LLM with fallback on payload errors ────────────
      let llmResponse = "";
      let reasoning: string | undefined;
      let toolCalls: ToolCall[] | undefined;
      let turnUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let llmSuccess = false;
      let lastError: any;

      for (const budgetTokens of [this.TOKEN_BUDGET, 5000, 2500]) {
        if (estimateTotalTokens(this.history) > budgetTokens) {
          this.history = truncateTranscript(this.history, budgetTokens);
          apiMessages = [
            { role: "system", content: this.contextBuilder.getSystemPrompt() },
            ...toChatMessages(this.history),
          ];
        }

        try {
          JSON.stringify(apiMessages); // validate serializable
          const response = await this.llm.complete(apiMessages as any, {
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            tools: this.registry.toOpenAITools(),
          });
          llmResponse = response.content;
          reasoning = response.reasoning;
          toolCalls = response.toolCalls;
          turnUsage = response.usage;
          llmSuccess = true;
          break;
        } catch (e: any) {
          lastError = e;
          const msg = e.message ?? "";
          // Only retry on protocol/overflow errors
          if (
            !msg.includes("tool_calls") &&
            !msg.includes("Unterminated") &&
            !msg.includes("deserialize") &&
            !msg.includes("maximum context") &&
            !msg.includes("too long")
          ) {
            break;
          }
        }
      }

      if (!llmSuccess) {
        if (this.history.length > 12 && !(this as any)._compressionTriedThisTurn) {
          (this as any)._compressionTriedThisTurn = true;
          await this.compressHistory();
          continue;
        }
        stopReason = "error";
        finalResponse = `Error calling LLM: ${lastError?.message}`;
        break;
      }
      (this as any)._compressionTriedThisTurn = false;

      totalTokens.promptTokens += turnUsage.promptTokens;
      totalTokens.completionTokens += turnUsage.completionTokens;
      totalTokens.totalTokens += turnUsage.totalTokens;

      // ── No tool calls = final response ──────────────────────
      if (!toolCalls || toolCalls.length === 0) {
        finalResponse = llmResponse;
        stopReason = "stop_sequence";
        this.history.push(createAssistantMessage(llmResponse));
        turns.push({
          index: iterations, messages: [...this.history],
          llmResponse, reasoning,
          duration: Date.now() - turnStart, tokenUsage: turnUsage,
        });
        break;
      }

      // ── Convergence nudge: too many search-only turns ───────
      if (this.recentToolCalls.length > 6 && iterations > 8) {
        const last6 = this.recentToolCalls.slice(-6);
        const allSearch = last6.every(c => c.name === "grep" || c.name === "glob");
        if (allSearch && !toolCalls.some(tc => tc.name === "task_complete" || tc.name === "file_read")) {
          this.history.push(createUserMessage(
            "[System] You have searched enough. Choose the most relevant file from your results, read it with file_read, then call task_complete with your findings."
          ));
        }
      }

      // ── Tool loop detection with reflection ─────────────────
      if (this.detectToolLoop(toolCalls)) {
        // First time: inject reflection nudge instead of hard stop
        if (!(this as any)._loopReflectionInjected) {
          (this as any)._loopReflectionInjected = true;
          this.history.push(createUserMessage(
            "[System] You have called the same tool with the same arguments multiple times. " +
            "This approach is not yielding new results. Please re-evaluate: what information " +
            "are you still missing? Is there a different tool or strategy you should try? " +
            "If you are truly stuck, call task_complete with an explanation."
          ));
          // Reset counters so we don't re-trigger immediately
          this.recentToolCalls = [];
          continue;
        }
        // Second time: actually stop
        stopReason = "tool_loop_detected";
        finalResponse = "I seem to be repeating the same tool calls. Let me try a different approach.";
        break;
      }
      this.recordToolCalls(toolCalls);

      // ── Handle task_complete ────────────────────────────────
      const completeCall = toolCalls.find((tc) => tc.name === "task_complete");
      if (completeCall) {
        finalResponse = (completeCall.arguments.summary as string) || llmResponse;
        stopReason = "task_completed";
        this.history.push(createAssistantMessage(llmResponse, toolCalls));
        turns.push({
          index: iterations, messages: [...this.history],
          toolCalls, llmResponse, reasoning,
          duration: Date.now() - turnStart, tokenUsage: turnUsage,
        });
        break;
      }

      // ── Execute tools ───────────────────────────────────────
      const toolResults = await this.executor.execute(toolCalls, toolContext);
      allToolResults.push(...toolResults);

      // Add to history using typed messages (no JSON strings)
      this.history.push(createAssistantMessage(llmResponse, toolCalls));
      for (const result of toolResults) {
        this.history.push(createToolResultMessage(result));
      }

      turns.push({
        index: iterations, messages: [...this.history],
        toolCalls, toolResults,
        llmResponse, reasoning,
        duration: Date.now() - turnStart, tokenUsage: turnUsage,
      });
    }

    if (iterations >= this.config.maxIterations && !finalResponse) {
      stopReason = "max_iterations";
      finalResponse = "I've reached the maximum number of iterations without completing the task.";
    }

    const totalDuration = Date.now() - startTime;
    const successfulTools = allToolResults.filter((r) => !r.isError);
    const toolSuccessRate = allToolResults.length > 0
      ? successfulTools.length / allToolResults.length
      : 1;

    // Redact secrets from final response before returning to user
    const safeResponse = redactSecrets(finalResponse);

    return {
      turns, stopReason, finalResponse: safeResponse, totalDuration, totalTokens,
      toolCallCount: allToolResults.length, toolSuccessRate,
    };
  }

  /** Stream support (delegates to run) */
  async runWithStreaming(userRequest: string, options: LoopOptions & {
    onText?: (text: string) => void;
    onToolStart?: (name: string) => void;
    onToolEnd?: (result: ToolResult) => void;
  } = {}): Promise<AgentResult> {
    const result = await this.run(userRequest, options.signal);
    for (const turn of result.turns) {
      if (turn.toolCalls) for (const tc of turn.toolCalls) options.onToolStart?.(tc.name);
      if (turn.toolResults) for (const tr of turn.toolResults) options.onToolEnd?.(tr);
      if (turn.llmResponse) options.onText?.(turn.llmResponse);
    }
    return result;
  }

  // ── Tool loop detection ────────────────────────────────────

  private detectToolLoop(toolCalls: ToolCall[]): boolean {
    if (this.recentToolCalls.length < this.maxRepeatedCalls) return false;
    const last = this.recentToolCalls.slice(-1)[0];
    const sameAsLast = toolCalls.some((tc) =>
      tc.name === last.name && JSON.stringify(tc.arguments) === JSON.stringify(last.args));
    if (!sameAsLast) return false;
    const lastN = this.recentToolCalls.slice(-this.maxRepeatedCalls);
    return lastN.every((call) =>
      call.name === last.name && JSON.stringify(call.args) === JSON.stringify(last.args));
  }

  private recordToolCalls(toolCalls: ToolCall[]): void {
    for (const tc of toolCalls) this.recentToolCalls.push({ name: tc.name, args: tc.arguments });
    if (this.recentToolCalls.length > 10) this.recentToolCalls = this.recentToolCalls.slice(-10);
  }

  // ── Public helpers ─────────────────────────────────────────

  getHistory(): Message[] { return [...this.history]; }
  clearHistory(): void { this.history = []; this.recentToolCalls = []; }
  addMessage(message: Message): void { this.history.push(message); }
  registerTool(tool: import("../tools/base.js").Tool): void {
    this.registry.register(tool);
    this.contextBuilder.invalidateCache();
  }
  getRegistry(): ToolRegistry { return this.registry; }
  getContextBuilder(): ContextBuilder { return this.contextBuilder; }

  // ── History compression ────────────────────────────────────

  /** Compress old history into a summary using transcript helpers */
  private async compressHistory(): Promise<void> {
    const KEEP_FIRST = 2;
    const KEEP_LAST = 6;
    if (this.history.length <= KEEP_FIRST + KEEP_LAST + 4) return;

    const first = this.history.slice(0, KEEP_FIRST);
    const last = this.history.slice(-KEEP_LAST);
    const middle = this.history.slice(KEEP_FIRST, -KEEP_LAST);
    if (middle.length === 0) return;

    // Use transcript's buildCompressionText for pair-aware summarization
    const middleText = buildCompressionText(middle);
    if (!middleText.trim()) { this.history = [...first, ...last]; return; }

    const summaryPrompt = [
      "Summarize the following conversation excerpt in 2-3 sentences.",
      "Focus on: what was searched, what files were read, what was created/modified.",
      "Be specific — include file names and key findings.\n",
      middleText,
    ].join("\n");

    try {
      const resp = await this.llm.complete(
        [
          { role: "system", content: "You compress conversation history. Output only the summary, no preamble." },
          { role: "user", content: summaryPrompt },
        ],
        { temperature: 0.3, maxTokens: 500 }
      );
      const summary = resp.content.trim();
      if (summary) {
        this.history = [
          ...first,
          createUserMessage(`[Context from earlier turns: ${summary}]`),
          ...last,
        ];
      }
    } catch {
      this.history = [...first, ...last];
    }
  }
}
