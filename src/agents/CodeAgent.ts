/**
 * Code Agent
 * Specialized agent for code generation and modification tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';

/**
 * Code Agent - Handles code-related tasks
 */
export class CodeAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'CodeAgent');
  }

  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    try {
      if (task.type === 'generate' || task.description?.includes('生成') || task.description?.includes('实现')) {
        return await this.executeGeneration(task);
      }

      if (task.type === 'review' || task.description?.includes('审查')) {
        return await this.executeReview(task);
      }

      if (task.type === 'refactor' || task.description?.includes('重构')) {
        return await this.executeRefactor(task);
      }

      // Default to generation
      return await this.executeGeneration(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  private async executeGeneration(task: any): Promise<any> {
    const { language = 'typescript', requirements, framework } = task;

    const result = await this.useSkill(
      'code-generation',
      { language, requirements, framework },
      {} as ExecutionContext
    );

    if (result.success && task.filePath) {
      await this.useSkill(
        'file-ops',
        { operation: 'write', path: task.filePath, content: result.result?.code || '' },
        {} as ExecutionContext
      );
    }

    return result;
  }

  private async executeReview(task: any): Promise<any> {
    const { code, language = 'typescript' } = task;

    const result = await this.useSkill(
      'code-review',
      { code, language },
      {} as ExecutionContext
    );

    return result;
  }

  private async executeRefactor(task: any): Promise<any> {
    const { code, language = 'typescript', goals } = task;

    const prompt = `请重构以下${language}代码：

目标：${goals || '提高代码质量'}

代码：
\`\`\`${language}
${code}
\`\`\`

请返回重构后的代码和改进说明。`;

    const response = await this.callLLM(prompt, { temperature: 0.3 });

    return {
      taskId: task.id,
      originalCode: code,
      refactoredCode: response,
    };
  }
}
