/**
 * Base Agent
 * Abstract base class for all agent types
 */

import { CompleteResult, LLMClient } from '../llm/LLMClient.js';
import { SkillManager } from '../skills/SkillManager.js';
import { AgentStatus, ExecutionContext, SkillResult } from '../state/models.js';
import { getLogger, childLogger } from '../monitoring/logger.js';
import { getPromptBuilder } from '../llm/PromptBuilder.js';
import type { ModeToolDecision } from '../security/ModeToolGate.js';

const logger = getLogger('BaseAgent');

/**
 * Abstract base agent class
 */
export interface ModelPolicy {
  model?: "deepseek-v4-pro" | "deepseek-v4-flash";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

export abstract class BaseAgent {
  protected logger: ReturnType<typeof childLogger>;
  protected status: AgentStatus = AgentStatus.IDLE;
  protected tasksCompleted: number = 0;
  protected totalExecutionTime: number = 0;
  protected promptBuilder: ReturnType<typeof getPromptBuilder>;
  protected modelPolicy: ModelPolicy = {};
  protected runtimeMode: 'plan' | 'agent' | 'yolo' = 'agent';
  protected toolGate?: (toolName: string, mode?: string, params?: Record<string, unknown>) => ModeToolDecision;
  protected lastLLMMetadata?: CompleteResult;

  // Cached system prompt
  private cachedSystemPrompt: string | null = null;

  constructor(
    protected llm: LLMClient,
    protected skillManager: SkillManager,
    public readonly agentType: string
  ) {
    this.logger = childLogger(logger, { agent: agentType });
    this.promptBuilder = getPromptBuilder();
  }

  /**
   * Set per-task model policy from ClusterDAGBuilder routing.
   * Called by AgentFactory after construction.
   */
  setModelPolicy(policy: ModelPolicy): void {
    this.modelPolicy = policy;
    this.logger.debug(policy, 'Model policy applied');
  }

  setRuntimeContext(context: {
    mode?: 'plan' | 'agent' | 'yolo';
    toolGate?: (toolName: string, mode?: string, params?: Record<string, unknown>) => ModeToolDecision;
  }): void {
    if (context.mode) this.runtimeMode = context.mode;
    if (context.toolGate) this.toolGate = context.toolGate;
  }

  getLastLLMMetadata(): CompleteResult | undefined {
    return this.lastLLMMetadata;
  }

  /**
   * Execute a task (must be implemented by subclasses)
   */
  abstract execute(task: any): Promise<any>;

  /**
   * Use a skill
   */
  protected async useSkill(skillName: string, params: any, context?: ExecutionContext): Promise<SkillResult> {
    this.logger.debug({ skill: skillName, params }, 'Using skill');

    const gate = this.toolGate?.(skillName, this.runtimeMode, params);
    if (gate && !gate.allowed) {
      this.logger.warn({ skill: skillName, mode: this.runtimeMode, reason: gate.reason }, 'Skill blocked by runtime mode gate');
      return {
        success: false,
        error: `Mode gate denied ${skillName}: ${gate.reason || 'not allowed'}`,
        metadata: { mode: this.runtimeMode, deniedBy: 'ModeToolGate' },
      };
    }

    const result = await this.skillManager.executeSkill(skillName, params, {
      ...(context || {}),
      agentType: this.agentType,
      mode: this.runtimeMode,
    } as any);

    if (!result.success) {
      this.logger.warn({ skill: skillName, error: result.error }, 'Skill execution failed');
    }

    return result;
  }

  /**
   * Call LLM with system prompt from config/agents/
   */
  protected async callLLM(prompt: string, options?: any): Promise<string> {
    if (this.shouldUseDeterministicFallback()) {
      return this.createDeterministicResponse(prompt);
    }

    // Get system prompt from MD file
    const systemPrompt = await this.getSystemPrompt();

    // Merge per-task model policy from ClusterDAGBuilder
    const modelOverrides: any = {};
    if (this.modelPolicy.model) modelOverrides.model = this.modelPolicy.model;
    if (this.modelPolicy.thinking) modelOverrides.thinking = this.modelPolicy.thinking;
    if (this.modelPolicy.reasoningEffort) modelOverrides.reasoningEffort = this.modelPolicy.reasoningEffort;

    const result = await this.completeWithOptionalMeta(prompt, {
      systemPrompt,
      ...modelOverrides,
      ...options, // task-level options override model policy
    });
    this.lastLLMMetadata = result;
    return result.content;
  }

  /**
   * Call LLM with full context (system prompt + session history + skills)
   */
  protected async callLLMWithContext(options: {
    userInput: string;
    sessionId?: string;
    includeSessionHistory?: boolean;
    includeSkills?: boolean;
    additionalContext?: string;
    llmOptions?: any;
  }): Promise<string> {
    const {
      userInput,
      sessionId,
      includeSessionHistory = true,
      includeSkills = true,
      additionalContext = '',
      llmOptions = {},
    } = options;

    if (this.shouldUseDeterministicFallback()) {
      return this.createDeterministicResponse(userInput);
    }

    // Build complete context using PromptBuilder
    const fullContext = await this.promptBuilder.buildContext({
      agentType: this.agentType,
      sessionId,
      userInput,
      includeSessionHistory,
      includeSkills,
      additionalContext,
    });

    this.logger.debug({ contextLength: fullContext.length, sessionId }, 'Built LLM context');

    // Get system prompt separately for the LLM call
    const systemPrompt = await this.getSystemPrompt();

    const result = await this.completeWithOptionalMeta(fullContext, {
      systemPrompt,
      ...llmOptions,
    });
    this.lastLLMMetadata = result;
    const response = result.content;

    // Post-process: check if response contains file operations
    const fileOpResult = await this.processFileOperations(response);

    return fileOpResult.processedResponse;
  }

  private shouldUseDeterministicFallback(): boolean {
    const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    return isTestRuntime && process.env.USE_LIVE_LLM_FOR_TESTS !== 'true';
  }

  private async completeWithOptionalMeta(prompt: string, options: any): Promise<CompleteResult> {
    const llm = this.llm as any;
    if (typeof llm.completeWithMeta === 'function') {
      return await llm.completeWithMeta(prompt, options);
    }

    const content = await llm.complete(prompt, options);
    return {
      content,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      },
      finishReason: 'unknown',
      model: options?.model || 'unknown',
    };
  }

  private createDeterministicResponse(input: string): string {
    const preview = input.replace(/\s+/g, ' ').trim().slice(0, 200);
    return `[${this.agentType}] Deterministic test response for: ${preview}`;
  }

  /**
   * Get system prompt for this agent type from config/agents/*.system.md
   * Public API for tests and external access
   */
  async getSystemPrompt(): Promise<string> {
    if (this.cachedSystemPrompt) {
      return this.cachedSystemPrompt;
    }

    this.cachedSystemPrompt = await this.promptBuilder.getSystemPrompt(this.agentType);
    return this.cachedSystemPrompt;
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.status;
  }

  /**
   * Get agent statistics
   */
  getStats() {
    return {
      agentType: this.agentType,
      status: this.status,
      tasksCompleted: this.tasksCompleted,
      totalExecutionTime: this.totalExecutionTime,
      averageExecutionTime: this.tasksCompleted > 0
        ? this.totalExecutionTime / this.tasksCompleted
        : 0,
    };
  }

  /**
   * 解析并执行响应中的文件操作指令
   * 支持格式：FILE_OP:<operation>:<params>
   */
  protected async processFileOperations(response: string): Promise<{ originalResponse: string; processedResponse: string; fileOps: any[] }> {
    const fileOps: any[] = [];
    const lines = response.split('\n');
    const processedLines: string[] = [];
    let hasFileOps = false;

    for (const line of lines) {
      const fileOpMatch = line.match(/^FILE_OP:(\w+):\s*(.+)$/);
      if (fileOpMatch) {
        const operation = fileOpMatch[1];
        const paramsStr = fileOpMatch[2];

        try {
          let params: any = {};

          if (operation === 'read') {
            params = { path: paramsStr.trim(), operation: 'read' };
          } else if (operation === 'write') {
            // 格式: FILE_OP:write: <path>|<content>
            const pipeIndex = paramsStr.indexOf('|');
            if (pipeIndex > 0) {
              const filePath = paramsStr.substring(0, pipeIndex).trim();
              const content = paramsStr.substring(pipeIndex + 1).trim();
              params = { path: filePath, content, operation: 'write' };
            }
          } else if (operation === 'modify') {
            // 格式: FILE_OP:modify: <path>|<search>|<replace>
            const parts = paramsStr.split('|').map((s: string) => s.trim());
            if (parts.length >= 3) {
              params = { path: parts[0], operation: 'modify', search: parts[1], replace: parts[2] };
            }
          } else if (operation === 'list') {
            params = { path: paramsStr.trim(), operation: 'list' };
          }

          if (Object.keys(params).length > 0) {
            this.logger.info({ operation, params }, 'Executing file operation');
            const result = await this.useSkill('file-ops', params, {} as ExecutionContext);

            fileOps.push({
              operation,
              params,
              success: result.success,
              result: result.result,
              error: result.error
            });

            if (result.success) {
              processedLines.push(`[文件操作成功] ${operation}: ${JSON.stringify(params)} → ${JSON.stringify(result.result).substring(0, 50)}...`);
            } else {
              processedLines.push(`[文件操作失败] ${operation}: ${result.error}`);
            }
            hasFileOps = true;
          }
        } catch (error: any) {
          this.logger.warn({ operation, error: error.message }, 'File operation parsing failed');
          processedLines.push(line); // 保留原始行
        }
      } else {
        processedLines.push(line);
      }
    }

    if (hasFileOps) {
      return {
        originalResponse: response,
        processedResponse: processedLines.join('\n'),
        fileOps
      };
    }

    return {
      originalResponse: response,
      processedResponse: response,
      fileOps
    };
  }

  /**
   * Set agent status
   */
  protected setStatus(status: AgentStatus): void {
    this.status = status;
    this.logger.debug({ status }, 'Agent status changed');
  }
}
