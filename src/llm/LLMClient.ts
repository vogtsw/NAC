/**
 * LLM Client
 * Abstract LLM provider interface supporting multiple APIs
 */

import OpenAI from 'openai';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';
import { scanForSensitiveData, RiskLevel } from '../security/SensitiveDataFilter.js';

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
   * Complete text generation
   */
  async complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
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

      // Use sanitized version
      prompt = scanResult.sanitizedContent || prompt;

      // Add warning about sanitization
      logger.info('⚠️ 敏感信息已被自动脱敏处理');
    }

    const messages: ChatMessage[] = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    try {
      logger.debug({ model: this.model, promptLength: prompt.length }, 'Sending completion request');

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
        response_format: options.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      });

      const content = this.extractContent(response);
      logger.debug({ responseLength: content.length }, 'Received completion response');

      return content;
    } catch (error: any) {
      logger.error({ error: error.message }, 'LLM API error');
      throw new Error(`LLM API error: ${error.message}`);
    }
  }

  /**
   * Stream completion (async generator)
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
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any,
        stream: true,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2000,
      });

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
   * Complete with JSON response
   */
  async completeJSON<T = any>(prompt: string, options: CompleteOptions = {}): Promise<T> {
    const response = await this.complete(prompt, {
      ...options,
      responseFormat: 'json',
    });

    try {
      return JSON.parse(response) as T;
    } catch (error: any) {
      logger.error({ response, error: error.message }, 'Failed to parse JSON response');
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
