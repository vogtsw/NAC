/**
 * LLM Adapter — abstract interface over OpenAI-compatible APIs.
 * Supports streaming, JSON mode, prompt caching hints, and multi-provider routing.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { TokenUsage } from "../agent/types.js";

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  jsonMode?: boolean;
  cacheBreakpoint?: number; // byte offset for Anthropic-style prompt caching hint
  tools?: Array<Record<string, unknown>>; // OpenAI tool definitions
}

export interface LLMResponse {
  content: string;
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: TokenUsage;
  finishReason: string;
}

export interface LLMStreamChunk {
  type: "text" | "reasoning" | "tool_call" | "done";
  content?: string;
  toolCall?: {
    id: string;
    name: string;
    arguments: string; // partial JSON
  };
  usage?: TokenUsage;
}

export abstract class LLMAdapter {
  protected client: OpenAI;
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  get model(): string {
    return this.config.model;
  }

  /**
   * Single-shot completion (non-streaming).
   */
  async complete(
    messages: ChatCompletionMessageParam[],
    options: LLMCallOptions = {}
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      stop: options.stop,
      ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      tools: options.tools || this.getToolDefinitions(),
    });

    return this.parseResponse(response);
  }

  /**
   * Streaming completion — yields chunks as they arrive.
   */
  async *stream(
    messages: ChatCompletionMessageParam[],
    options: LLMCallOptions = {}
  ): AsyncGenerator<LLMStreamChunk> {
    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
      stop: options.stop,
      stream: true,
      tools: options.tools || this.getToolDefinitions(),
    });

    let content = "";
    let reasoning = "";
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> =
      new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      // Handle reasoning_content (DeepSeek-style)
      if ((delta as any).reasoning_content) {
        reasoning += (delta as any).reasoning_content;
        yield { type: "reasoning", content: (delta as any).reasoning_content };
        continue;
      }

      if (delta.content) {
        content += delta.content;
        yield { type: "text", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls.has(idx)) {
            toolCalls.set(idx, {
              id: tc.id || "",
              name: tc.function?.name || "",
              arguments: "",
            });
          }
          const entry = toolCalls.get(idx)!;
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          if (tc.function?.arguments) entry.arguments += tc.function.arguments;

          yield {
            type: "tool_call",
            toolCall: { ...entry },
          };
        }
      }
    }

    yield {
      type: "done",
      content,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  /**
   * Override in provider subclass to inject tool defs.
   */
  protected getToolDefinitions(): any[] | undefined {
    return undefined; // overridden when tools are registered
  }

  protected parseResponse(response: any): LLMResponse {
    const choice = response.choices?.[0];
    if (!choice) throw new Error("No choices in LLM response");

    const message = choice.message;
    const reasoning = message?.reasoning_content as string | undefined;

    const toolCalls =
      message?.tool_calls?.map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
      })) ?? [];

    return {
      content: message?.content || "",
      reasoning,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      finishReason: choice.finish_reason || "stop",
    };
  }

  async close(): Promise<void> {
    // no-op for OpenAI client
  }
}
