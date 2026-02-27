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

    // Fallback to task description if requirements not provided
    const codeRequirements = requirements ?? task.description;
    const codeFramework = framework ?? '';

    const result = await this.useSkill(
      'code-generation',
      { language, requirements: codeRequirements, framework: codeFramework },
      {} as ExecutionContext
    );

    if (result.success && task.filePath) {
      await this.useSkill(
        'file-ops',
        { operation: 'write', path: task.filePath, content: result.result?.code || '' },
        {} as ExecutionContext
      );
    }

    // If skill failed, fallback to LLM
    if (!result.success) {
      const prompt = `请生成代码：

编程语言：${language}
${codeFramework ? `框架：${codeFramework}` : ''}
需求：
${codeRequirements}

请提供完整的代码实现。`;

      const response = await this.callLLM(prompt);

      return {
        taskId: task.id,
        success: true,
        result: { code: response },
      };
    }

    return result;
  }

  private async executeReview(task: any): Promise<any> {
    const { code, language = 'typescript' } = task;

    // Fallback to task description if code not provided
    const reviewCode = code ?? task.description;

    const result = await this.useSkill(
      'code-review',
      { code: reviewCode, language },
      {} as ExecutionContext
    );

    // If skill failed, fallback to LLM
    if (!result.success) {
      const prompt = `请审查以下代码：

语言：${language}
代码：
\`\`\`${language}
${reviewCode}
\`\`\`

请提供详细的审查意见和改进建议。`;

      const response = await this.callLLM(prompt, { temperature: 0.5 });

      return {
        taskId: task.id,
        success: true,
        result: { review: response },
      };
    }

    return result;
  }

  private async executeRefactor(task: any): Promise<any> {
    const { code, language = 'typescript', goals } = task;

    // Fallback to task description if code/goals not provided
    const refactorCode = code ?? task.description;
    const refactorGoals = goals ?? task.name;

    const prompt = `请重构以下${language}代码：

目标：${refactorGoals}

代码：
\`\`\`${language}
${refactorCode}
\`\`\`

请返回重构后的代码和改进说明。`;

    const response = await this.callLLM(prompt, { temperature: 0.3 });

    return {
      taskId: task.id,
      originalCode: refactorCode,
      refactoredCode: response,
    };
  }
}
