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

    // Fallback to task name/description if fields not provided
    const deployTarget = target ?? task.name;
    const deployEnvironment = environment ?? '生产环境';
    const deployConfig = config;

    const prompt = `请制定部署计划：

目标：${deployTarget}
环境：${deployEnvironment}
配置：${deployConfig ? JSON.stringify(deployConfig, null, 2) : '默认配置'}

请提供详细的部署步骤和验证方法。`;

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    return {
      taskId: task.id,
      deploymentPlan: response,
      target: deployTarget,
      environment: deployEnvironment,
    };
  }

  private async executeAutomate(task: any): Promise<any> {
    const { workflow, steps } = task;

    // Fallback to task name/description if fields not provided
    const autoWorkflow = workflow ?? task.description;
    const autoSteps = steps;

    // Handle web-search skill
    if (task.requiredSkills?.includes('web-search')) {
      // Extract search query from task - prefer explicit searchQuery field, then extract from description
      let searchQuery: string;

      if (task.searchQuery) {
        // Use the pre-extracted searchQuery from DAGBuilder
        searchQuery = task.searchQuery;
      } else {
        // Fallback to extraction from task description
        searchQuery = this.extractSearchQuery(task);
      }

      const result = await this.useSkill(
        'web-search',
        { query: searchQuery, numResults: 5, language: 'zh-CN' },
        {} as ExecutionContext
      );

      if (result.success) {
        return {
          taskId: task.id,
          searchQuery,
          ...result.result,
        };
      }

      // If skill failed, fallback to LLM below
    }

    // Use terminal skill if available
    if (task.requiredSkills?.includes('terminal-exec')) {
      const result = await this.useSkill(
        'terminal-exec',
        { command: autoWorkflow || autoSteps?.join(' && ') },
        {} as ExecutionContext
      );
      // If skill failed, fallback to LLM below
      if (result.success) {
        return result;
      }
    }

    const prompt = `请设计自动化工作流：

工作流描述：${autoWorkflow}
步骤：${autoSteps ? autoSteps.join(' -> ') : '自动生成'}

请提供详细的自动化方案。`;

    const response = await this.callLLM(prompt);

    return {
      taskId: task.id,
      automationPlan: response,
    };
  }

  /**
   * Extract search query from task
   * Removes search-related keywords to get the actual query
   */
  private extractSearchQuery(task: any): string {
    let query = task.description || task.name || '';

    // Remove common search keywords to get cleaner query
    const searchPrefixes = [
      'search for ', 'search ', '搜索', '查找', 'find ',
      'look for ', 'lookup ', 'google ', '百度',
      'search the ', '搜索关于', 'search about '
    ];

    for (const prefix of searchPrefixes) {
      if (query.toLowerCase().startsWith(prefix)) {
        query = query.substring(prefix.length).trim();
        break;
      }
    }

    // Remove common suffixes
    const searchSuffixes = [
      ' 的信息', '的信息', ' 的新闻', ' 的最新消息',
      ' news', ' latest', ' information'
    ];

    for (const suffix of searchSuffixes) {
      if (query.toLowerCase().endsWith(suffix)) {
        query = query.substring(0, query.length - suffix.length).trim();
        break;
      }
    }

    return query || task.description || task.name;
  }

  private async executeCommand(task: any): Promise<any> {
    const { command, cwd, timeout = 30000 } = task;

    // Fallback to task description if command not provided
    const execCommand = command ?? task.description;

    const result = await this.useSkill(
      'terminal-exec',
      { command: execCommand, cwd, timeout },
      {} as ExecutionContext
    );

    // If skill failed, return an error message via LLM
    if (!result.success) {
      const prompt = `执行命令失败，请提供替代方案：

命令：${execCommand}
工作目录：${cwd || '当前目录'}
错误：${result.error || '技能不可用'}

请提供手动执行步骤或替代方案。`;

      const response = await this.callLLM(prompt);

      return {
        taskId: task.id,
        error: result.error,
        alternative: response,
      };
    }

    return result;
  }
}
