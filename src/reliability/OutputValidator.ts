/**
 * 输出验证器 - 检查Agent输出是否符合预期
 *
 * 功能：
 * 1. 验证输出完整性
 * 2. 验证输出相关性
 * 3. 验证输出质量
 * 4. 触发反思和重试
 */

import { LLMClient } from '../llm/LLMClient.js';

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  issues: string[];
  suggestions: string[];
  shouldRetry: boolean;
}

export interface OutputValidationConfig {
  expectedFormat?: string[];
  requiredKeywords?: string[];
  forbiddenPatterns?: string[];
  minQualityScore: number;
}

export class OutputValidator {
  private llmClient: LLMClient;
  private config: OutputValidationConfig;

  constructor(config: OutputValidationConfig = {}) {
    this.llmClient = new LLMClient();
    this.config = {
      minQualityScore: 60,
      ...config
    };
  }

  /**
   * 验证输出是否符合用户意图
   */
  async validate(
    userIntent: string,
    agentOutput: string,
    context?: Record<string, any>
  ): Promise<ValidationResult> {
    const issues: string[] = [];
    const suggestions: string[] = [];
    let score = 0;

    // 1. 基础检查
    const basicChecks = this.performBasicChecks(agentOutput);
    if (!basicChecks.passed) {
      issues.push(...basicChecks.issues);
      score += basicChecks.score;
    } else {
      score += 30;
    }

    // 2. 相关性检查（使用LLM）
    const relevanceCheck = await this.checkRelevance(userIntent, agentOutput, context);
    if (!relevanceCheck.isRelevant) {
      issues.push(...relevanceCheck.issues);
      suggestions.push(...relevanceCheck.suggestions);
    } else {
      score += relevanceCheck.score;
    }

    // 3. 完整性检查
    const completenessCheck = await this.checkCompleteness(userIntent, agentOutput);
    if (!completenessCheck.isComplete) {
      issues.push(...completenessCheck.issues);
      suggestions.push(...completenessCheck.suggestions);
    } else {
      score += completenessCheck.score;
    }

    // 4. 质量检查
    const qualityCheck = await this.checkQuality(agentOutput);
    score += qualityCheck.score;

    // 判断是否需要重试
    const shouldRetry = score < this.config.minQualityScore || issues.length > 0;

    return {
      isValid: !shouldRetry,
      score,
      issues,
      suggestions,
      shouldRetry
    };
  }

  /**
   * 基础检查：空输出、过短、占位符等
   */
  private performBasicChecks(output: string): { passed: boolean; score: number; issues: string[] } {
    const issues: string[] = [];
    let score = 0;

    // 检查空输出
    if (!output || output.trim().length === 0) {
      issues.push('输出为空');
      return { passed: false, score: 0, issues };
    }

    // 检查输出长度
    if (output.length < 50) {
      issues.push('输出过短，可能不完整');
    } else {
      score += 10;
    }

    // 检查占位符
    const placeholders = [
      '步骤名称（使用中文）',
      'TODO',
      '待填写',
      'TBD',
      '[插入',
      '步骤1',
      '步骤2'
    ];

    const hasPlaceholders = placeholders.some(p => output.includes(p));
    if (hasPlaceholders) {
      issues.push('输出包含占位符或模板内容，未真正执行任务');
    } else {
      score += 20;
    }

    return {
      passed: issues.length === 0,
      score,
      issues
    };
  }

  /**
   * 相关性检查：输出是否与用户意图相关
   */
  private async checkRelevance(
    intent: string,
    output: string,
    context?: Record<string, any>
  ): Promise<{ isRelevant: boolean; score: number; issues: string[]; suggestions: string[] }> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 构建验证提示
    const prompt = `请验证以下输出是否与用户意图相关：

用户意图：${intent}

Agent输出：
${output.slice(0, 1000)}

请判断：
1. 输出是否真正解决了用户的问题？
2. 输出是否包含了用户要求的具体内容？
3. 是否偏离了主题或给出了通用模板？

返回格式（JSON）：
{
  "isRelevant": true/false,
  "score": 0-40,
  "issues": ["问题1", "问题2"],
  "suggestions": ["建议1", "建议2"]
}`;

    try {
      const response = await this.llmClient.complete(prompt, {
        temperature: 0.1,
        responseFormat: { type: 'json_object' }
      });

      const result = JSON.parse(response);
      return result;
    } catch (error) {
      // LLM调用失败时的降级策略
      return {
        isRelevant: true,
        score: 20,
        issues: [],
        suggestions: []
      };
    }
  }

  /**
   * 完整性检查：是否包含了用户要求的所有要素
   */
  private async checkCompleteness(
    intent: string,
    output: string
  ): Promise<{ isComplete: boolean; score: number; issues: string[]; suggestions: string[] }> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 从意图中提取具体要求
    const requirements = this.extractRequirements(intent);

    // 检查每个要求是否在输出中得到满足
    for (const req of requirements) {
      if (!this.checkRequirementMet(req, output)) {
        issues.push(`缺少要求的内容：${req}`);
        suggestions.push(`请补充：${req}`);
      }
    }

    const isComplete = issues.length === 0;
    const score = isComplete ? 30 : Math.max(0, 30 - issues.length * 10);

    return { isComplete, score, issues, suggestions };
  }

  /**
   * 质量检查：输出的专业性、准确性等
   */
  private async checkQuality(output: string): Promise<{ score: number }> {
    let score = 0;

    // 检查是否有具体的数据/事实
    const hasData = /\d+/.test(output) ||
                    /https?:\/\//.test(output) ||
                    /第[一二三四五六七八九十]/.test(output);
    if (hasData) score += 10;

    // 检查是否有结构化内容
    const hasStructure = output.includes('##') ||
                        output.includes('###') ||
                        output.includes('|') ||
                        output.includes('1.');
    if (hasStructure) score += 10;

    // 检查是否包含具体的项目名称/实体
    const hasEntities = /[A-Z][a-z]+[A-Z]/.test(output) || // CamelCase
                       /github\.com/i.test(output) ||
                       /[A-Z]{2,}/.test(output); // 缩写
    if (hasEntities) score += 10;

    return { score };
  }

  /**
   * 从用户意图中提取具体要求
   */
  private extractRequirements(intent: string): string[] {
    const requirements: string[] = [];

    // 提取"前N个"类要求
    const topNMatch = intent.match(/前(\d+)(个|名|条)?(.+?)(项目| repo|仓库)?/i);
    if (topNMatch) {
      requirements.push(`前${topNMatch[1]}个${topNMatch[3] || '项目'}`);
    }

    // 提取"总结/摘要"要求
    if (/总结|摘要|概要|概述/i.test(intent)) {
      requirements.push('总结或摘要');
    }

    // 提取"详细"要求
    if (/详细|详解|深入/i.test(intent)) {
      requirements.push('详细分析');
    }

    // 提取具体平台/来源
    if (/github|gitlab|gitee/i.test(intent)) {
      requirements.push('GitHub/GitLab/Gitee项目');
    }

    return requirements;
  }

  /**
   * 检查特定要求是否在输出中得到满足
   */
  private checkRequirementMet(requirement: string, output: string): boolean {
    // 简单的关键词匹配检查
    const keywords = requirement.split(/[,，、]/);
    return keywords.some(kw => output.toLowerCase().includes(kw.toLowerCase()));
  }

  /**
   * 生成改进建议
   */
  async generateImprovement(
    validation: ValidationResult,
    userIntent: string,
    currentOutput: string
  ): Promise<string> {
    if (!validation.shouldRetry) {
      return currentOutput;
    }

    const prompt = `请根据以下反馈改进Agent的输出：

用户意图：${userIntent}

当前输出：
${currentOutput.slice(0, 1000)}

发现的问题：
${validation.issues.map(i => `- ${i}`).join('\n')}

改进建议：
${validation.suggestions.map(s => `- ${s}`).join('\n')}

请提供一个改进后的输出，要求：
1. 真正解决用户的问题
2. 包含具体的数据和事实
3. 不要使用模板或占位符
4. 直接给出结果，不要解释过程

改进后的输出：`;

    try {
      const improvedOutput = await this.llmClient.complete(prompt, {
        temperature: 0.3
      });

      return improvedOutput;
    } catch (error) {
      // 如果改进失败，返回原始输出
      return currentOutput;
    }
  }
}
