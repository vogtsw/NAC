/**
 * Automation Agent
 * Specialized agent for automation and deployment tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';

/**
 * Automation Agent - Handles automation tasks
 */
export class AutomationAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'AutomationAgent');
  }

  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    try {
      if (task.type === 'deploy' || task.description?.includes('部署')) {
        return await this.executeDeploy(task);
      }

      if (task.type === 'automate' || task.description?.includes('自动化')) {
        return await this.executeAutomate(task);
      }

      if (task.type === 'command' || task.description?.includes('执行命令')) {
        return await this.executeCommand(task);
      }

      // Default automation
      return await this.executeAutomate(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  private async executeDeploy(task: any): Promise<any> {
    const { target, environment, config } = task;

    const prompt = `请制定部署计划：

目标：${target}
环境：${environment}
配置：${config ? JSON.stringify(config, null, 2) : '默认配置'}

请提供详细的部署步骤和验证方法。`;

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    return {
      taskId: task.id,
      deploymentPlan: response,
      target,
      environment,
    };
  }

  private async executeAutomate(task: any): Promise<any> {
    const { workflow, steps } = task;

    // Use terminal skill if available
    if (task.requiredSkills?.includes('terminal-exec')) {
      return await this.useSkill(
        'terminal-exec',
        { command: workflow || steps?.join(' && ') },
        {} as ExecutionContext
      );
    }

    const prompt = `请设计自动化工作流：

工作流描述：${workflow || task.description}
步骤：${steps ? steps.join(' -> ') : '自动生成'}

请提供详细的自动化方案。`;

    const response = await this.callLLM(prompt);

    return {
      taskId: task.id,
      automationPlan: response,
    };
  }

  private async executeCommand(task: any): Promise<any> {
    const { command, cwd, timeout = 30000 } = task;

    return await this.useSkill(
      'terminal-exec',
      { command, cwd, timeout },
      {} as ExecutionContext
    );
  }
}
