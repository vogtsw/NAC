/**
 * LLM Client
 * Abstract LLM provider interface supporting multiple APIs.
 * Extended with DeepSeek V4 thinking/reasoning_effort support.
 */

import OpenAI from 'openai';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';
import { scanForSensitiveData } from '../security/SensitiveDataFilter.js';
import type { DeepSeekModelPolicy, DeepSeekTokenUsage } from './DeepSeekModelPolicy.js';

const logger = getLogger('LLMClient');

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface CompleteOptions {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  /** DeepSeek V4: enable/disable thinking mode */
  thinking?: 'enabled' | 'disabled';
  /** DeepSeek V4: reasoning effort level */
  reasoningEffort?: 'high' | 'max';
  /** Extra body params for provider-specific extensions */
  extraBody?: Record<string, unknown>;
}

export interface CompleteResult {
  content: string;
  reasoningContent?: string;
  usage: DeepSeekTokenUsage;
  finishReason: string;
  model: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLM Client supporting multiple providers (DeepSeek, OpenAI, Qwen, etc.)
 */
export class LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(config: LLMConfig) {
    this.model = config.model;

    // Initialize OpenAI client (compatible with DeepSeek, Qwen, etc.)
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
    });

    logger.info({ provider: config.baseURL, model: config.model }, 'LLM client initialized');
  }

  /**
   * Complete text generation with full DeepSeek V4 support.
   */
  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
    return (await this.completeWithMeta(prompt, options)).content;
  }

  /**
   * Complete with metadata (reasoning, usage, model info).
   */
  async completeWithMeta(prompt: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    // SECURITY CHECK: Scan for sensitive data before sending to external API
    const scanResult = scanForSensitiveData(prompt);

    if (scanResult.shouldBlock) {
      logger.error({
        riskLevel: scanResult.riskLevel,
        detectionCount: scanResult.detections.length,
        types: scanResult.detections.map(d => d.type)
      }, 'Blocked content with sensitive data');

      throw new Error(
        `🔒 安全警告: 检测到敏感信息，已阻止发送到外部API\n` +
        `风险等级: ${scanResult.riskLevel}\n` +
        `检测到的敏感信息类型:\n` +
        scanResult.detections.map(d => `  - ${d.type}: ${d.match.substring(0, 20)}...`).join('\n') +
        `\n建议: 请移除敏感信息后重试，或使用环境变量/配置文件管理凭据`
      );
    }

    if (scanResult.hasSensitiveData) {
      logger.warn({
        riskLevel: scanResult.riskLevel,
        detectionCount: scanResult.detections.length,
        types: scanResult.detections.map(d => d.type)
      }, 'Content contains sensitive data, sanitizing');
      prompt = scanResult.sanitizedContent || prompt;
      logger.info('⚠️ 敏感信息已被自动脱敏处理');
    }

    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      logger.debug({ model: this.model, promptLength: prompt.length,
        thinking: options.thinking, reasoningEffort: options.reasoningEffort }, 'Sending completion request');

      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages as any,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
      };

      if (options.responseFormat === 'json') {
        body.response_format = { type: 'json_object' };
      }

      // DeepSeek V4 thinking/reasoning support
      if (options.thinking && this.model.startsWith('deepseek')) {
        (body as any).thinking = { type: options.thinking };
      }

      if (options.reasoningEffort && this.model.startsWith('deepseek')) {
        (body as any).reasoning_effort = options.reasoningEffort;
      }

      // Extra body params for provider-specific extensions
      if (options.extraBody) {
        Object.assign(body, options.extraBody);
      }

      const response = await this.client.chat.completions.create(body as any);

      const content = this.extractContent(response);
      const reasoningContent = this.extractReasoningContent(response);
      const usage = this.extractUsage(response);
      const finishReason = this.extractFinishReason(response);
      const model = this.extractModel(response);

      logger.debug({ responseLength: content.length, reasoningLength: reasoningContent?.length || 0,
        usage }, 'Received completion response');

      return { content, reasoningContent, usage, finishReason, model };
    } catch (error: any) {
      logger.error({ error: error.message }, 'LLM API error');
      throw new Error(`LLM API error: ${error.message}`);
    }
  }

  /**
   * Stream completion with DeepSeek V4 support.
   */
  async *streamComplete(prompt: string, options: CompleteOptions = {}): AsyncGenerator<string> {
    // SECURITY CHECK: Scan for sensitive data before sending to external API
    const scanResult = scanForSensitiveData(prompt);

    if (scanResult.shouldBlock) {
      logger.error({
        riskLevel: scanResult.riskLevel,
        detectionCount: scanResult.detections.length,
        types: scanResult.detections.map(d => d.type)
      }, 'Blocked streaming content with sensitive data');

      throw new Error(
        `🔒 安全警告: 检测到敏感信息，已阻止发送到外部API\n` +
        `风险等级: ${scanResult.riskLevel}\n` +
        `检测到的敏感信息类型: ${scanResult.detections.map(d => d.type).join(', ')}\n` +
        `\n建议: 请移除敏感信息后重试`
      );
    }

    if (scanResult.hasSensitiveData) {
      prompt = scanResult.sanitizedContent || prompt;
      logger.warn('Content contains sensitive data, sanitizing for streaming');
    }

    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: messages as any,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        stream_options: { include_usage: true },
      };

      if (options.thinking && this.model.startsWith('deepseek')) {
        (body as any).extra_body = (body as any).extra_body || {};
        (body as any).thinking = { type: options.thinking };
      }

      const stream = await this.client.chat.completions.create(body as any) as any;

      for await (const chunk of stream) {
        const content = this.extractStreamingContent(chunk);
        if (content) {
          yield content;
        }
      }
    } catch (error: any) {
      logger.error({ error: error.message }, 'LLM stream error');
      throw error;
    }
  }

  /**
   * Complete with JSON response (preserves reasoning metadata).
   */
  async completeJSON<T = any>(prompt: string, options: CompleteOptions = {}): Promise<T> {
    const result = await this.completeWithMeta(prompt, {
      ...options,
      responseFormat: 'json',
    });

    try {
      return JSON.parse(result.content) as T;
    } catch (error: any) {
      logger.error({ response: result.content.substring(0, 200), error: error.message }, 'Failed to parse JSON response');
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }

  /**
   * Extract content from API response
   */
  private extractContent(response: any): string {
    if (response.choices && response.choices[0]) {
      return response.choices[0].message?.content || '';
    }
    if (response.output && response.output.text) {
      return response.output.text;
    }
    throw new Error('Unexpected response format');
  }

  /**
   * Extract reasoning_content from DeepSeek response.
   */
  private extractReasoningContent(response: any): string | undefined {
    return response.choices?.[0]?.message?.reasoning_content || undefined;
  }

  /**
   * Extract token usage with DeepSeek cache fields.
   */
  private extractUsage(response: any): DeepSeekTokenUsage {
    const usage = response.usage || {};
    return {
      promptTokens: usage.prompt_tokens || 0,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens || 0,
      cacheHitTokens: usage.prompt_tokens_details?.cached_tokens || 0,
      cacheMissTokens: Math.max(0, (usage.prompt_tokens || 0) - (usage.prompt_tokens_details?.cached_tokens || 0)),
    };
  }

  /**
   * Extract finish reason from response.
   */
  private extractFinishReason(response: any): string {
    return response.choices?.[0]?.finish_reason || 'stop';
  }

  /**
   * Extract model name from response.
   */
  private extractModel(response: any): string {
    return response.model || this.model;
  }

  /**
   * Extract content from streaming chunk
   */
  private extractStreamingContent(chunk: any): string | null {
    if (chunk.choices && chunk.choices[0]) {
      return chunk.choices[0].delta?.content || null;
    }
    if (chunk.output && chunk.output.text) {
      return chunk.output.text;
    }
    return null;
  }

  /**
   * Close the client
   */
  async close(): Promise<void> {
    // OpenAI client doesn't need explicit closing
  }
}

/**
 * Factory function to create LLM client from config
 */
export function createLLMClient(): LLMClient {
  const config = loadConfig();
  return new LLMClient({
    ...config.orchestrator.llmConfig,
  });
}

// Singleton instance
let llmClient: LLMClient | null = null;

export function getLLMClient(): LLMClient {
  if (!llmClient) {
    llmClient = createLLMClient();
  }
  return llmClient;
}
