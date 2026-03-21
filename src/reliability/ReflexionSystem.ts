/**
 * 反思系统 - 监控执行质量并自动纠正错误
 *
 * 功能：
 * 1. 监控Agent执行过程
 * 2. 验证输出质量
 * 3. 识别失败模式
 * 4. 自动反思和重试
 * 5. 学习并改进
 */

import { OutputValidator, ValidationResult } from './OutputValidator.js';
import { LLMClient } from '../llm/LLMClient.js';
import { Blackboard } from '../state/Blackboard.js';

export interface ExecutionAttempt {
  attemptNumber: number;
  agent: string;
  input: string;
  output: string;
  validation: ValidationResult;
  timestamp: number;
  duration: number;
}

export interface ReflexionConfig {
  maxAttempts: number;
  enableLearning: boolean;
  storeFailures: boolean;
}

export class ReflexionSystem {
  private validator: OutputValidator;
  private llmClient: LLMClient;
  private blackboard: Blackboard;
  private config: ReflexionConfig;
  private attempts: Map<string, ExecutionAttempt[]> = new Map();

  constructor(config: ReflexionConfig = {}) {
    this.validator = new OutputValidator();
    this.llmClient = new LLMClient();
    this.blackboard = new Blackboard();
    this.config = {
      maxAttempts: 3,
      enableLearning: true,
      storeFailures: true,
      ...config
    };
  }

  /**
   * 执行带反思的任务
   */
  async executeWithReflexion(
    taskId: string,
    userIntent: string,
    agent: string,
    executeFn: () => Promise<string>,
    context?: Record<string, any>
  ): Promise<{ output: string; attempts: ExecutionAttempt[] }> {
    const attempts: ExecutionAttempt[] = [];
    let finalOutput = '';
    let success = false;

    for (let i = 1; i <= this.config.maxAttempts; i++) {
      const startTime = Date.now();

      try {
        // 执行任务
        const output = await executeFn();
        const duration = Date.now() - startTime;

        // 验证输出
        const validation = await this.validator.validate(userIntent, output, context);

        // 记录尝试
        const attempt: ExecutionAttempt = {
          attemptNumber: i,
          agent,
          input: userIntent,
          output,
          validation,
          timestamp: Date.now(),
          duration
        };

        attempts.push(attempt);

        // 检查是否成功
        if (validation.isValid) {
          finalOutput = output;
          success = true;
          break;
        }

        // 如果不是最后一次尝试，进行反思和改进
        if (i < this.config.maxAttempts) {
          console.warn(`⚠️  第${i}次尝试未通过验证，正在进行反思...`);
          console.warn(`   质量分数: ${validation.score}/100`);
          console.warn(`   发现问题: ${validation.issues.join(', ')}`);

          // 生成改进后的输入/指令
          const refinedIntent = await this.refineIntent(userIntent, validation, output);

          // 更新执行函数的输入
          // 注意：这里假设executeFn可以从外部获取更新后的输入
          // 实际实现可能需要调整

          // 记录失败模式
          if (this.config.storeFailures) {
            await this.storeFailurePattern(taskId, attempt);
          }
        }

      } catch (error) {
        console.error(`❌ 第${i}次尝试执行失败:`, error);

        const attempt: ExecutionAttempt = {
          attemptNumber: i,
          agent,
          input: userIntent,
          output: '',
          validation: {
            isValid: false,
            score: 0,
            issues: [error.message],
            suggestions: [],
            shouldRetry: true
          },
          timestamp: Date.now(),
          duration: Date.now() - startTime
        };

        attempts.push(attempt);
      }
    }

    // 存储所有尝试
    this.attempts.set(taskId, attempts);

    // 如果所有尝试都失败，生成最终报告
    if (!success) {
      console.error(`❌ 任务${taskId}在${this.config.maxAttempts}次尝试后仍未成功`);
      finalOutput = await this.generateFailureReport(userIntent, attempts);
    }

    // 学习：分析成功和失败模式
    if (this.config.enableLearning) {
      await this.learnFromExecution(taskId, attempts, success);
    }

    return { output: finalOutput, attempts };
  }

  /**
   * 反思并优化意图
   */
  private async refineIntent(
    originalIntent: string,
    validation: ValidationResult,
    currentOutput: string
  ): Promise<string> {
    const prompt = `你是一个任务优化专家。原始任务执行失败，请根据反馈优化任务指令。

原始任务：${originalIntent}

当前输出问题：
${validation.issues.map(i => `- ${i}`).join('\n')}

改进建议：
${validation.suggestions.map(s => `- ${s}`).join('\n')}

请生成一个优化后的任务指令，确保：
1. 更加明确和具体
2. 避免之前的错误
3. 包含质量要求
4. 强调不要使用模板或占位符

优化后的任务指令：`;

    try {
      const refinedIntent = await this.llmClient.complete(prompt, {
        temperature: 0.3
      });

      return refinedIntent;
    } catch (error) {
      return originalIntent;
    }
  }

  /**
   * 存储失败模式
   */
  private async storeFailurePattern(taskId: string, attempt: ExecutionAttempt): Promise<void> {
    const failureKey = `failure:${taskId}:${attempt.attemptNumber}`;

    await this.blackboard.set(failureKey, {
      timestamp: attempt.timestamp,
      issues: attempt.validation.issues,
      output: attempt.output,
      agent: attempt.agent
    });
  }

  /**
   * 生成失败报告
   */
  private async generateFailureReport(
    userIntent: string,
    attempts: ExecutionAttempt[]
  ): Promise<string> {
    const lastAttempt = attempts[attempts.length - 1];

    return `# 任务执行失败报告

## 任务目标
${userIntent}

## 执行情况
- 尝试次数：${attempts.length}
- 最后一次质量分数：${lastAttempt.validation.score}/100

## 主要问题
${lastAttempt.validation.issues.map(i => `- ${i}`).join('\n')}

## 改进建议
${lastAttempt.validation.suggestions.map(s => `- ${s}`).join('\n')}

## 调试信息
- 使用的Agent：${attempts.map(a => a.agent).join(' → ')}
- 总耗时：${attempts.reduce((sum, a) => sum + a.duration, 0)}ms

建议：请重新表述您的需求，或者尝试更具体的指令。`;
  }

  /**
   * 从执行中学习
   */
  private async learnFromExecution(
    taskId: string,
    attempts: ExecutionAttempt[],
    success: boolean
  ): Promise<void> {
    const learningData = {
      taskId,
      success,
      attemptsCount: attempts.length,
      finalScore: attempts[attempts.length - 1].validation.score,
      commonIssues: this.extractCommonIssues(attempts),
      timestamp: Date.now()
    };

    // 存储到黑板
    await this.blackboard.set(`learning:${taskId}`, learningData);

    // 更新Agent性能统计
    const agent = attempts[0].agent;
    const stats = await this.blackboard.get(`agent:${agent}:stats`) || {
      successCount: 0,
      failureCount: 0,
      totalAttempts: 0,
      avgScore: 0
    };

    if (success) {
      stats.successCount++;
    } else {
      stats.failureCount++;
    }

    stats.totalAttempts += attempts.length;
    stats.avgScore = (
      (stats.avgScore * (stats.successCount + stats.failureCount - 1) +
       learningData.finalScore) /
      (stats.successCount + stats.failureCount)
    );

    await this.blackboard.set(`agent:${agent}:stats`, stats);
  }

  /**
   * 提取常见问题
   */
  private extractCommonIssues(attempts: ExecutionAttempt[]): string[] {
    const issueMap = new Map<string, number>();

    for (const attempt of attempts) {
      for (const issue of attempt.validation.issues) {
        issueMap.set(issue, (issueMap.get(issue) || 0) + 1);
      }
    }

    // 返回出现频率最高的问题
    return Array.from(issueMap.entries())
      .filter(([_, count]) => count >= 2)
      .map(([issue, _]) => issue);
  }

  /**
   * 获取执行历史
   */
  getExecutionHistory(taskId: string): ExecutionAttempt[] {
    return this.attempts.get(taskId) || [];
  }

  /**
   * 获取Agent性能统计
   */
  async getAgentStats(agent: string): Promise<{
    successCount: number;
    failureCount: number;
    totalAttempts: number;
    avgScore: number;
  } | null> {
    return await this.blackboard.get(`agent:${agent}:stats`);
  }

  /**
   * 批量分析失败案例
   */
  async analyzeFailurePatterns(): Promise<{
    commonFailures: string[];
    agentPerformance: Record<string, any>;
    recommendations: string[];
  }> {
    const allFailures = await this.blackboard.getPattern('failure:*');
    const commonFailures = this.extractCommonIssues(
      allFailures.map((f: any) => ({
        validation: { issues: f.issues }
      } as ExecutionAttempt))
    );

    // 生成改进建议
    const recommendations: string[] = [];

    if (commonFailures.includes('输出包含占位符或模板内容')) {
      recommendations.push('建议：Agent生成步骤时应具体化，避免使用模板');
    }

    if (commonFailures.includes('输出过短，可能不完整')) {
      recommendations.push('建议：增加输出长度要求，或要求更多细节');
    }

    if (commonFailures.includes('输出与用户意图不相关')) {
      recommendations.push('建议：改进意图解析逻辑，或要求Agent确认理解');
    }

    return {
      commonFailures,
      agentPerformance: {},
      recommendations
    };
  }
}
