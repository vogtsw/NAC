/**
 * Transcript Manager — unified message protocol layer.
 *
 * Responsibilities:
 * - Store messages with typed content (TextContent | ToolCallContent | ToolResultContent),
 *   never as JSON-stringified blobs.
 * - Ensure every assistant message with tool_calls is immediately followed by
 *   corresponding tool messages.
 * - Truncate / compress without splitting tool-call/tool-result pairs.
 * - Emit a single `toChatMessages()` output that works for OpenAI, DeepSeek,
 *   and any OpenAI-compatible provider.
 */
import type {
  Message,
  MessageContent,
  TextContent,
  ToolCallContent,
  ToolResultContent,
  ToolCall,
  ToolResult,
  ToolDefinition,
} from "./types.js";

// ── Chat message shapes (provider-agnostic) ─────────────────

export interface FormattedChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

// ── Transcript helpers ──────────────────────────────────────

/** True when the message is an assistant message that carries tool calls. */
export function hasToolCalls(msg: Message): boolean {
  if (typeof msg.content === "string") return false;
  return msg.content.some((c) => c.type === "tool_call");
}

/** Extract ToolCall records from a typed message. */
export function extractToolCalls(msg: Message): ToolCall[] {
  if (typeof msg.content === "string") return [];
  return (msg.content as MessageContent[])
    .filter((c): c is ToolCallContent => c.type === "tool_call")
    .map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }));
}

/** Extract the text portion of an assistant message. */
export function extractText(msg: Message): string {
  if (typeof msg.content === "string") return msg.content;
  return (msg.content as MessageContent[])
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

/** True when the message is a tool result. */
export function isToolResult(msg: Message): boolean {
  return msg.role === "tool" && typeof msg.content !== "string";
}

/** Get the tool_call_id from a tool result message. */
export function getToolCallId(msg: Message): string | undefined {
  if (typeof msg.content === "string") return undefined;
  const tr = (msg.content as MessageContent[]).find(
    (c): c is ToolResultContent => c.type === "tool_result"
  );
  return tr?.toolCallId;
}

// ── Message construction (typed, never JSON-stringified) ────

export function createAssistantMessage(
  text: string,
  toolCalls?: ToolCall[]
): Message {
  const content: MessageContent[] = [];
  if (text) content.push({ type: "text", text });
  if (toolCalls) {
    for (const tc of toolCalls) {
      content.push({
        type: "tool_call",
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      });
    }
  }
  return { role: "assistant", content, timestamp: Date.now() };
}

export function createToolResultMessage(result: ToolResult): Message {
  const content: MessageContent[] = [
    {
      type: "tool_result",
      toolCallId: result.toolCallId,
      name: result.name,
      result: result.result,
      isError: result.isError,
    },
  ];
  return { role: "tool", content, timestamp: Date.now() };
}

export function createUserMessage(text: string): Message {
  const content: MessageContent[] = [{ type: "text", text }];
  return { role: "user", content, timestamp: Date.now() };
}

export function createSystemMessage(text: string): Message {
  return { role: "system", content: text, timestamp: Date.now() };
}

// ── Pair-aware truncation ───────────────────────────────────

/**
 * Truncate history to at most `maxTokens` estimated tokens while preserving
 * tool-call / tool-result atomicity.  Never splits a pair.
 *
 * Strategy: walk backwards from the end, counting tool messages as "glued"
 * to their preceding assistant message.  Once we exceed the budget, discard
 * everything older (except the first user message which anchors the task).
 */
export function truncateTranscript(
  messages: Message[],
  maxTokens: number
): Message[] {
  if (messages.length === 0) return [];

  // Always keep the first user message (task anchor)
  const anchor = messages[0].role === "user" ? [messages[0]] : [];
  const rest = anchor.length ? messages.slice(1) : messages;

  // Walk backwards to find the slice that fits
  let tokenCount = anchor.reduce((s, m) => s + estimateTokens(m), 0);
  const keep: Message[] = [];

  // Group: an assistant-with-tool-calls + its tool results form one atomic unit
  let i = rest.length - 1;
  while (i >= 0 && tokenCount < maxTokens) {
    const group: Message[] = [];

    // Collect tool results that belong to the preceding assistant
    while (i >= 0 && rest[i].role === "tool") {
      group.unshift(rest[i]);
      i--;
    }

    // Collect the assistant message that owns these tool calls
    if (i >= 0 && rest[i].role === "assistant") {
      group.unshift(rest[i]);
      i--;
    } else if (i >= 0 && rest[i].role === "user") {
      group.unshift(rest[i]);
      i--;
    } else if (i >= 0) {
      group.unshift(rest[i]);
      i--;
    }

    const groupTokens = group.reduce((s, m) => s + estimateTokens(m), 0);
    if (tokenCount + groupTokens <= maxTokens) {
      keep.unshift(...group);
      tokenCount += groupTokens;
    } else {
      // Can't fit this group — stop
      break;
    }
  }

  return [...anchor, ...keep];
}

// ── Pair-aware compression ──────────────────────────────────

/**
 * Build a compression prompt from a slice of history.  Tool-call/result pairs
 * are summarised together rather than individually.
 */
export function buildCompressionText(messages: Message[]): string {
  const lines: string[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === "assistant" && hasToolCalls(msg)) {
      const calls = extractToolCalls(msg);
      const text = extractText(msg);
      const callNames = calls.map((c) => c.name).join(", ");
      lines.push(
        `[assistant]${text ? " " + text.substring(0, 200) : ""} [called: ${callNames}]`
      );

      // Gather following tool results
      i++;
      while (i < messages.length && messages[i].role === "tool") {
        const tr = getToolResultContent(messages[i]);
        if (tr) {
          const status = tr.isError ? "ERROR" : "ok";
          lines.push(
            `  [tool ${tr.name}] ${status}: ${String(tr.result).substring(0, 200)}`
          );
        }
        i++;
      }
    } else if (msg.role === "user") {
      lines.push(`[user]: ${String(extractText(msg)).substring(0, 300)}`);
      i++;
    } else if (msg.role === "assistant") {
      lines.push(`[assistant]: ${String(extractText(msg)).substring(0, 300)}`);
      i++;
    } else {
      i++;
    }
  }

  return lines.join("\n");
}

function getToolResultContent(
  msg: Message
): ToolResultContent | undefined {
  if (typeof msg.content === "string") return undefined;
  return (msg.content as MessageContent[]).find(
    (c): c is ToolResultContent => c.type === "tool_result"
  );
}

// ── Convert transcript → OpenAI-compatible chat messages ────

/**
 * Convert internal typed messages to the format expected by OpenAI / DeepSeek
 * chat completions API.  This is the single translation point — all providers
 * consume the same output.
 */
export function toChatMessages(
  messages: Message[],
  opts?: {
    /** Max chars for text content (default 4000) */
    maxTextChars?: number;
    /** Max chars for tool result content (default 2000) */
    maxToolResultChars?: number;
    /** Max chars for serialised tool call arguments (default 2000) */
    maxToolArgsChars?: number;
  }
): FormattedChatMessage[] {
  const maxText = opts?.maxTextChars ?? 4000;
  const maxResult = opts?.maxToolResultChars ?? 2000;
  const maxArgs = opts?.maxToolArgsChars ?? 2000;

  return messages
    .filter((m) => m.role !== "system") // system messages handled separately
    .map((m): FormattedChatMessage => {
      if (m.role === "user") {
        return {
          role: "user",
          content: String(
            typeof m.content === "string" ? m.content : extractText(m)
          ).substring(0, maxText),
        };
      }

      if (m.role === "tool") {
        const tr = getToolResultContent(m);
        const result = tr
          ? String(tr.result).substring(0, maxResult)
          : String(
              typeof m.content === "string"
                ? m.content
                : extractText(m)
            ).substring(0, maxResult);
        return {
          role: "tool",
          content: result,
          tool_call_id:
            tr?.toolCallId ??
            (typeof m.content === "string" ? undefined : getToolCallId(m)) ??
            "",
        };
      }

      if (m.role === "assistant") {
        const calls = extractToolCalls(m);
        const text = extractText(m);

        if (calls.length > 0) {
          return {
            role: "assistant",
            content: text.substring(0, maxText) || null,
            tool_calls: calls.map((tc) => ({
              id: tc.id,
              type: "function" as const,
              function: {
                name: tc.name,
                arguments: JSON.stringify(tc.arguments).substring(0, maxArgs),
              },
            })),
          };
        }

        return {
          role: "assistant",
          content: text.substring(0, maxText) || null,
        };
      }

      // Fallback
      return {
        role: m.role as "user",
        content: String(
          typeof m.content === "string" ? m.content : extractText(m)
        ).substring(0, maxText),
      };
    });
}

// ── Token estimation ─────────────────────────────────────────

/**
 * Rough token estimation without a tokenizer.  Conservative heuristic:
 * ~1 token per 4 characters for English text, with a floor.
 */
export function estimateTokens(msg: Message): number {
  const text = extractText(msg);
  const chars = text.length;

  // Tool calls add overhead
  const toolCalls = hasToolCalls(msg) ? extractToolCalls(msg) : [];
  let overhead = 0;
  for (const tc of toolCalls) {
    overhead +=
      20 + // overhead per tool_call block
      tc.name.length +
      JSON.stringify(tc.arguments).length;
  }

  // ~4 chars per token
  return Math.max(1, Math.ceil((chars + overhead) / 4));
}

/** Estimate total tokens for an array of messages. */
export function estimateTotalTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

// ── Pair validation ──────────────────────────────────────────

/**
 * Validate that the transcript is well-formed:
 * - Every assistant-with-tool-calls is followed by at least one tool result.
 * - No orphaned tool results (tool message without preceding assistant tool_call).
 *
 * Returns the list of issues found (empty = valid).
 */
export function validateTranscript(messages: Message[]): string[] {
  const issues: string[] = [];
  const pendingCallIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant" && hasToolCalls(msg)) {
      const calls = extractToolCalls(msg);
      // Check if previous pending calls were never answered
      if (pendingCallIds.size > 0) {
        issues.push(
          `Orphaned tool call(s) at message ${i}: ${[...pendingCallIds].join(", ")} never received results`
        );
      }
      pendingCallIds.clear();
      for (const c of calls) pendingCallIds.add(c.id);
      continue;
    }

    if (msg.role === "tool") {
      const id = getToolCallId(msg);
      if (id && pendingCallIds.has(id)) {
        pendingCallIds.delete(id);
      } else if (id && pendingCallIds.size === 0) {
        issues.push(
          `Tool result at message ${i} (id=${id}) has no preceding tool call`
        );
      }
    }
  }

  if (pendingCallIds.size > 0) {
    issues.push(
      `Unresolved tool calls at end of transcript: ${[...pendingCallIds].join(", ")}`
    );
  }

  return issues;
}

// ── Serialization helpers (for DB persistence) ──────────────

/**
 * Serialize messages to JSON-safe objects for storage.
 * Already typed internally, so this is straightforward.
 */
export function serializeMessages(messages: Message[]): object[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp,
  }));
}

/**
 * Deserialize messages from stored JSON.
 */
export function deserializeMessages(raw: object[]): Message[] {
  return raw as Message[];
}
