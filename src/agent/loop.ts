/**
 * Agent Loop — the core conversation engine.
 * Flow: build prompt → call LLM → parse response → execute tools → repeat
 */
import { ContextBuilder, getDefaultSystemPrompt } from "./context.js";
import { ToolRegistry, getToolRegistry } from "../tools/registry.js";
import { ToolExecutor } from "../tools/executor.js";
import { getBuiltinTools } from "../tools/builtin/index.js";
import type { LLMAdapter } from "../llm/adapter.js";
import { getDefaultAdapter } from "../llm/index.js";
import type {
  AgentConfig, AgentResult, AgentStopReason, AgentTurn,
  Message, TokenUsage, ToolCall, ToolResult, ToolExecutionContext,
} from "./types.js";

export interface LoopOptions {
  config?: Partial<AgentConfig>;
  llm?: LLMAdapter;
  registry?: ToolRegistry;
  contextBuilder?: ContextBuilder;
  history?: Message[];
  workingDir?: string;
  signal?: AbortSignal;
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

    this.history.push({ role: "user", content: userRequest, timestamp: Date.now() });

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

      // Compress if history too large (with cooldown to avoid per-turn LLM calls)
      if (this.history.length > 20 && (this._lastCompressionAt || 0) < this.history.length - 8) {
        await this.compressHistory();
        (this as any)._lastCompressionAt = this.history.length;
      }

      // Build messages: keep last N, but ensure first message is safe
      const MAX_HISTORY = 10;
      let h = [...this.history];
      if (h.length > MAX_HISTORY) {
        let cut = h.length - MAX_HISTORY;
        while (cut > 0 && h[cut]?.role === "tool") cut--;
        h = [h[0], ...h.slice(Math.max(1, cut))];
      }
      const { messages: rawMsgs } = this.contextBuilder.build(userRequest, h, {
        skipSystemPrompt: iterations > 1,
      });

      // Format for OpenAI-compatible API
      const apiMessages = rawMsgs.map((m: any) => {
        const base: any = { role: m.role };
        if (m.role === "tool") {
          try {
            const p = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
            base.content = String(p.result || m.content).substring(0, 2000);
            if (p.tool_call_id) base.tool_call_id = p.tool_call_id;
          } catch { base.content = String(m.content).substring(0, 2000); }
        } else if (m.role === "assistant") {
          try {
            const p = typeof m.content === "string" ? JSON.parse(m.content) : null;
            if (p?.tool_calls) {
              base.content = p.text || null;
              base.tool_calls = p.tool_calls.map((tc: any) => ({
                id: tc.id, type: "function",
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments).substring(0, 2000) },
              }));
            } else {
              base.content = String(m.content).substring(0, 4000);
            }
          } catch { base.content = String(m.content).substring(0, 4000); }
        } else {
          base.content = String(m.content).substring(0, 4000);
        }
        return base;
      });

      // Call LLM
      let llmResponse = "";
      let reasoning: string | undefined;
      let toolCalls: ToolCall[] | undefined;
      let turnUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      let llmSuccess = false;
      let lastError: any;
      // Try with current history; fall back to shorter on payload errors
      for (const maxHist of [MAX_HISTORY, 8, 4]) {
        const h2 = this.history.length > maxHist
          ? (() => { let cut = this.history.length - maxHist; while (cut > 0 && this.history[cut]?.role === "tool") cut--; return [this.history[0], ...this.history.slice(Math.max(1, cut))]; })()
          : h;
        const { messages: msgs } = this.contextBuilder.build(userRequest, h2, { skipSystemPrompt: iterations > 1 });
        const msgs2 = msgs.map((m: any) => {
          const b: any = { role: m.role };
          if (m.role === "tool") { try { const p = JSON.parse(m.content as string); b.content = String(p.result||"").substring(0,2000); if(p.tool_call_id) b.tool_call_id = p.tool_call_id; } catch { b.content = String(m.content).substring(0,1000); } }
          else if (m.role === "assistant") { try { const p = JSON.parse(m.content as string); if(p?.tool_calls) { b.content = p.text||null; b.tool_calls = p.tool_calls.map((tc:any) => ({id:tc.id,type:"function",function:{name:tc.name,arguments:JSON.stringify(tc.arguments).substring(0,1000)}})); } else b.content = String(m.content).substring(0,2000); } catch { b.content = String(m.content).substring(0,2000); } }
          else b.content = String(m.content).substring(0,2000);
          return b;
        });
        try {
          JSON.stringify(msgs2);
          const response = await this.llm.complete(msgs2, { temperature: this.config.temperature, maxTokens: this.config.maxTokens, tools: this.registry.toOpenAITools() });
          llmResponse = response.content; reasoning = response.reasoning; toolCalls = response.toolCalls; turnUsage = response.usage;
          llmSuccess = true;
          break;
        } catch (e: any) {
          lastError = e;
          if (!e.message?.includes("tool_calls") && !e.message?.includes("Unterminated") && !e.message?.includes("deserialize")) break;
        }
      }
      if (!llmSuccess) {
        // If we haven't tried compression yet, compress and retry
        if (this.history.length > 12 && !(this as any)._compressionTriedThisTurn) {
          (this as any)._compressionTriedThisTurn = true;
          await this.compressHistory();
          continue; // retry the iteration
        }
        stopReason = "error";
        finalResponse = `Error calling LLM: ${lastError?.message}`;
        break;
      }
      (this as any)._compressionTriedThisTurn = false; // reset flag

      totalTokens.promptTokens += turnUsage.promptTokens;
      totalTokens.completionTokens += turnUsage.completionTokens;
      totalTokens.totalTokens += turnUsage.totalTokens;

      // No tool calls = final response
      if (!toolCalls || toolCalls.length === 0) {
        finalResponse = llmResponse;
        stopReason = "stop_sequence";
        this.history.push({ role: "assistant", content: llmResponse, timestamp: Date.now() });
        turns.push({ index: iterations, messages: [...this.history], llmResponse, reasoning,
          duration: Date.now() - turnStart, tokenUsage: turnUsage });
        break;
      }

      // Push agent to converge if too many search-only turns
      if (this.recentToolCalls.length > 6 && iterations > 8) {
        const last6 = this.recentToolCalls.slice(-6);
        const allSearch = last6.every(c => c.name === "grep" || c.name === "glob");
        if (allSearch && !toolCalls.some(tc => tc.name === "task_complete" || tc.name === "file_read")) {
          // Inject a convergence nudge
          this.history.push({
            role: "user",
            content: "[System] You have searched enough. Choose the most relevant file from your results, read it with file_read, then call task_complete with your findings.",
            timestamp: Date.now(),
          });
        }
      }

      // Detect tool loops
      if (this.detectToolLoop(toolCalls)) {
        stopReason = "tool_loop_detected";
        finalResponse = "I seem to be repeating the same tool calls. Let me try a different approach.";
        break;
      }
      this.recordToolCalls(toolCalls);

      // Check for task_complete
      const completeCall = toolCalls.find((tc) => tc.name === "task_complete");
      if (completeCall) {
        finalResponse = (completeCall.arguments.summary as string) || llmResponse;
        stopReason = "task_completed";
        this.history.push({ role: "assistant", content: llmResponse, timestamp: Date.now() });
        turns.push({ index: iterations, messages: [...this.history], toolCalls, llmResponse, reasoning,
          duration: Date.now() - turnStart, tokenUsage: turnUsage });
        break;
      }

      // Execute tools
      const toolResults = await this.executor.execute(toolCalls, toolContext);
      allToolResults.push(...toolResults);

      // Add to history
      this.history.push({
        role: "assistant",
        content: JSON.stringify({ text: llmResponse, tool_calls: toolCalls.map((tc) =>
          ({ id: tc.id, name: tc.name, arguments: tc.arguments })) }),
        timestamp: Date.now(),
      });
      for (const result of toolResults) {
        this.history.push({
          role: "tool",
          content: JSON.stringify({ tool_call_id: result.toolCallId, name: result.name,
            result: result.result, is_error: result.isError }),
          timestamp: Date.now(),
        });
      }

      turns.push({ index: iterations, messages: [...this.history], toolCalls, toolResults,
        llmResponse, reasoning, duration: Date.now() - turnStart, tokenUsage: turnUsage });
    }

    if (iterations >= this.config.maxIterations && !finalResponse) {
      stopReason = "max_iterations";
      finalResponse = "I've reached the maximum number of iterations without completing the task.";
    }

    const totalDuration = Date.now() - startTime;
    const successfulTools = allToolResults.filter((r) => !r.isError);
    const toolSuccessRate = allToolResults.length > 0 ? successfulTools.length / allToolResults.length : 1;

    return { turns, stopReason, finalResponse, totalDuration, totalTokens,
      toolCallCount: allToolResults.length, toolSuccessRate };
  }

  // Stream support (delegates to run)
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

  getHistory(): Message[] { return [...this.history]; }
  clearHistory(): void { this.history = []; this.recentToolCalls = []; }
  addMessage(message: Message): void { this.history.push(message); }
  registerTool(tool: import("../tools/base.js").Tool): void { this.registry.register(tool); this.contextBuilder.invalidateCache(); }
  getRegistry(): ToolRegistry { return this.registry; }
  getContextBuilder(): ContextBuilder { return this.contextBuilder; }

  /** Compress old history into a summary to prevent payload overflow */
  private async compressHistory(): Promise<void> {
    const KEEP_FIRST = 2;  // original task + first assistant response
    const KEEP_LAST = 6;   // most recent tool calls and results
    if (this.history.length <= KEEP_FIRST + KEEP_LAST + 4) return; // nothing to compress

    const first = this.history.slice(0, KEEP_FIRST);
    const last = this.history.slice(-KEEP_LAST);
    const middle = this.history.slice(KEEP_FIRST, -KEEP_LAST);
    if (middle.length === 0) return;

    // Build summary prompt
    const middleText = middle.map((m) => {
      if (m.role === "user") return `[user]: ${String(m.content).substring(0, 300)}`;
      if (m.role === "assistant") {
        try {
          const p = JSON.parse(m.content as string);
          if (p?.tool_calls) return `[assistant called: ${p.tool_calls.map((t:any) => t.name).join(", ")}]`;
          return `[assistant]: ${String(p?.text || m.content).substring(0, 300)}`;
        } catch { return `[assistant]: ${String(m.content).substring(0, 200)}`; }
      }
      if (m.role === "tool") {
        try {
          const p = JSON.parse(m.content as string);
          return `[tool ${p.name}: ${String(p.result||"").substring(0, 200)}]`;
        } catch { return `[tool result]`; }
      }
      return `[${m.role}]`;
    }).join("\n");

    const summaryPrompt = [
      "Summarize the following conversation excerpt in 2-3 sentences.",
      "Focus on: what was searched, what files were read, what was created/modified.",
      "Be specific — include file names and key findings.\n",
      middleText,
    ].join("\n");

    // Call LLM for compression (lightweight call, no tools)
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
          { role: "user", content: `[Context from earlier turns: ${summary}]`, timestamp: Date.now() },
          ...last,
        ];
      }
    } catch {
      // Compression failed — just truncate
      this.history = [...first, ...last];
    }
  }
}
