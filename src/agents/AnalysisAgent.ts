/**
 * Analysis Agent
 * Specialized agent for analysis and review tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';

/**
 * Analysis Agent - Handles analysis and review tasks
 */
export class AnalysisAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'AnalysisAgent');
  }

  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    try {
      if (task.type === 'review' || task.description?.includes('审查')) {
        return await this.executeReview(task);
      }

      if (task.type === 'analyze' || task.description?.includes('分析')) {
        return await this.executeAnalysis(task);
      }

      if (task.type === 'test' || task.description?.includes('测试')) {
        return await this.executeTest(task);
      }

      // Default analysis
      return await this.executeAnalysis(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  private async executeReview(task: any): Promise<any> {
    const { target, type = 'code', content } = task;

    if (type === 'code' && content) {
      return await this.useSkill(
        'code-review',
        { code: content, language: task.language || 'typescript' },
        {} as ExecutionContext
      );
    }

    const prompt = `请审查以下内容：

类型：${type}
目标：${target}
${content ? `内容：\n${content}` : ''}

请提供详细的审查意见和改进建议。`;

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    return {
      taskId: task.id,
      review: response,
      type,
    };
  }

  private async executeAnalysis(task: any): Promise<any> {
    const { subject, context, focus } = task;

    const prompt = `请进行深入分析：

分析主题：${subject}
上下文：${context || '通用'}
关注点：${focus || '全面分析'}

请提供结构化的分析结果，包括：
1. 现状分析
2. 问题识别
3. 根本原因
4. 改进建议`;

    const response = await this.callLLM(prompt, { temperature: 0.6 });

    return {
      taskId: task.id,
      analysis: response,
      subject,
    };
  }

  private async executeTest(task: any): Promise<any> {
    const { target, type = 'unit', framework = 'vitest' } = task;

    const prompt = `请设计测试方案：

测试目标：${target}
测试类型：${type}
测试框架：${framework}

请提供：
1. 测试用例设计
2. 测试数据准备
3. 预期结果
4. 验证方法`;

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    return {
      taskId: task.id,
      testPlan: response,
      target,
      type,
    };
  }
}
