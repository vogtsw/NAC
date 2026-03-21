/**
 * DAG Builder
 * Build task execution DAG from intent using LLM
 */

import { LLMClient } from '../llm/LLMClient.js';
import { TaskPlanningPrompt } from '../llm/prompts.js';
import { Intent, Task, DAGNode } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';
import { DAGValidator } from './DAGValidator.js';

const logger = getLogger('DAGBuilder');

/**
 * DAG (Directed Acyclic Graph) - Task dependency graph
 */
export class DAG {
  private nodes: Map<string, DAGNode> = new Map();

  addTask(task: Task): void {
    this.nodes.set(task.id, { task, dependencies: task.dependencies });
  }

  getReadyTasks(): Task[] {
    return Array.from(this.nodes.values())
      .filter((node) => node.dependencies.length === 0)
      .map((node) => node.task);
  }

  markTaskComplete(taskId: string): void {
    // Remove completed task and update dependencies
    this.nodes.forEach((node) => {
      node.dependencies = node.dependencies.filter((d) => d !== taskId);
    });
    this.nodes.delete(taskId);
  }

  isComplete(): boolean {
    return this.nodes.size === 0;
  }

  hasCycle(): boolean {
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const hasCycle = (taskId: string): boolean => {
      if (!this.nodes.has(taskId)) return false;
      if (recStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      recStack.add(taskId);

      const node = this.nodes.get(taskId)!;
      for (const dep of node.dependencies) {
        if (hasCycle(dep)) return true;
      }

      recStack.delete(taskId);
      return false;
    };

    for (const taskId of this.nodes.keys()) {
      if (hasCycle(taskId)) return true;
    }
    return false;
  }

  topologicalSort(): Task[] {
    const sorted: Task[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (taskId: string): void => {
      if (temp.has(taskId)) {
        throw new Error('Circular dependency detected');
      }
      if (visited.has(taskId)) return;

      temp.add(taskId);
      const node = this.nodes.get(taskId);
      if (node) {
        node.dependencies.forEach(visit);
        sorted.push(node.task);
      }
      temp.delete(taskId);
      visited.add(taskId);
    };

    this.nodes.forEach((_, id) => visit(id));
    return sorted;
  }

  getAllTasks(): Task[] {
    return Array.from(this.nodes.values()).map((node) => node.task);
  }
}

/**
 * DAG Builder - Create execution DAG from intent
 */
export class DAGBuilder {
  constructor(private llm?: LLMClient) {}

  /**
   * Build DAG from intent
   */
  async build(intent: Intent): Promise<DAG> {
    logger.info({ intentType: intent.type, primaryGoal: intent.primaryGoal }, 'Building DAG');

    const steps = await this.generateSteps(intent);

    const dag = new DAG();
    const mappedSkills = this.mapCapabilitiesToSkills(intent.capabilities);

    // 对于 automation + web-search 类型，从 primaryGoal 中提取搜索查询
    let extractedSearchQuery: string | undefined;
    if (intent.type === 'automation' && mappedSkills.includes('web-search')) {
      extractedSearchQuery = this.extractSearchQueryFromGoal(intent.primaryGoal);
      logger.debug({ extractedSearchQuery }, 'Extracted search query from primaryGoal');
    }

    steps.forEach((step: any, index: number) => {
      // 对于 automation 类型的任务，从 intent.capabilities 映射技能
      // 如果 LLM 生成的步骤包含技能，使用 LLM 的技能；否则使用映射的技能
      let requiredSkills: string[] = [];

      if (intent.type === 'automation') {
        // 如果步骤有定义 required_skills 且不为空，使用步骤的技能
        if (step.required_skills && step.required_skills.length > 0) {
          requiredSkills = step.required_skills;
        } else if (mappedSkills.length > 0) {
          // 否则使用从 intent.capabilities 映射的技能
          requiredSkills = mappedSkills;
        }
      }

      const taskData: any = {
        id: step.id || `task-${index + 1}`,
        name: step.name,
        description: step.description,
        agentType: step.agent_type || this.inferAgentType(step),
        requiredSkills,
        dependencies: step.dependencies || [],
        estimatedDuration: step.estimated_duration || 300,
      };

      // 如果有提取的搜索查询，添加到任务中
      if (extractedSearchQuery) {
        taskData.searchQuery = extractedSearchQuery;
      }

      dag.addTask(taskData);
    });

    // Validate no cycles
    if (dag.hasCycle()) {
      throw new Error('Generated DAG contains circular dependencies');
    }

    // Validate and fix DAG quality (remove placeholders, add missing descriptions)
    const validator = new DAGValidator();
    const validationResult = validator.validate(dag, intent.primaryGoal);

    if (!validationResult.isValid) {
      logger.warn(
        { issues: validationResult.issues },
        'DAG validation found issues, applying fixes'
      );

      // 应用修复
      const fixedDag = validator.applyFixes(dag, validationResult.fixes);

      logger.info(
        { fixedTasks: validationResult.fixes.size },
        'DAG fixes applied'
      );

      logger.info({ taskCount: steps.length }, 'DAG built successfully');
      return fixedDag;
    }

    logger.info({ taskCount: steps.length }, 'DAG built successfully');
    return dag;
  }

  /**
   * Generate execution steps using LLM
   */
  private async generateSteps(intent: Intent): Promise<any[]> {
    if (!this.llm) {
      return this.getDefaultSteps(intent);
    }

    try {
      const plan = await this.llm.complete(
        TaskPlanningPrompt.format({
          intent: intent.type,
          primaryGoal: intent.primaryGoal,
          capabilities: intent.capabilities.join(', '),
          complexity: intent.complexity,
          availableSkills: [], // 不传递技能列表，让任务直接使用LLM
        }),
        { responseFormat: 'json' }
      );

      // 解析 JSON 并处理 Unicode 转义
      const parsed = JSON.parse(plan);
      const steps = parsed.steps || [];

      // 修复中文字符编码问题
      return this.fixUnicodeInSteps(steps);
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to generate steps with LLM, using defaults');
      return this.getDefaultSteps(intent);
    }
  }

  /**
   * 修复步骤中的 Unicode 转义中文字符
   * 将 \u4f60\u597d 转换为 你好
   */
  private fixUnicodeInSteps(steps: any[]): any[] {
    return steps.map(step => ({
      ...step,
      name: this.unescapeUnicode(step.name || ''),
      description: this.unescapeUnicode(step.description || ''),
    }));
  }

  /**
   * 解码 Unicode 转义字符
   */
  private unescapeUnicode(text: string): string {
    if (!text) return text;
    // 处理 \uXXXX 格式的 Unicode 转义
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  /**
   * Infer agent type from step description
   */
  private inferAgentType(step: any): string {
    const description = step.description?.toLowerCase() || '';

    if (description.includes('code') || description.includes('api') || description.includes('实现')) {
      return 'CodeAgent';
    }
    if (description.includes('data') || description.includes('分析') || description.includes('analyze')) {
      return 'DataAgent';
    }
    if (description.includes('test') || description.includes('验证') || description.includes('review')) {
      return 'AnalysisAgent';
    }
    if (description.includes('自动') || description.includes('部署') || description.includes('deploy')) {
      return 'AutomationAgent';
    }

    return 'GenericAgent';
  }

  /**
   * 将 intent capabilities 映射到实际的技能名称
   */
  private mapCapabilitiesToSkills(capabilities: string[]): string[] {
    const skillMapping: Record<string, string> = {
      'web-search': 'web-search',
      'information-retrieval': 'web-search',
      'code_gen': 'code-generation',
      'code-generation': 'code-generation',
      'data-analysis': 'data-analysis',
      'file-ops': 'file-ops',
      'terminal-exec': 'terminal-exec',
      'code-review': 'code-review',
    };

    const skills: string[] = [];
    for (const cap of capabilities) {
      const skill = skillMapping[cap.toLowerCase()];
      if (skill) {
        skills.push(skill);
      }
    }

    logger.debug({ capabilities, skills }, 'Mapped capabilities to skills');
    return skills;
  }

  /**
   * 从 primaryGoal 中提取搜索查询
   * primaryGoal 格式: "搜索关于 ${searchQuery} 的信息"
   */
  private extractSearchQueryFromGoal(primaryGoal: string): string {
    // 移除搜索相关的前缀
    const prefixes = [
      '搜索关于', 'search for', 'search about', '查找',
      'look for', '寻找', 'find'
    ];

    let query = primaryGoal;
    for (const prefix of prefixes) {
      if (query.toLowerCase().startsWith(prefix.toLowerCase())) {
        query = query.substring(prefix.length).trim();
        break;
      }
    }

    // 移除搜索相关的后缀
    const suffixes = [
      ' 的信息', '的信息', ' 的新闻', ' 的最新消息', ' 的最新进展',
      ' news', ' latest news', ' information', ' latest information'
    ];

    for (const suffix of suffixes) {
      if (query.toLowerCase().endsWith(suffix.toLowerCase())) {
        query = query.substring(0, query.length - suffix.length).trim();
        break;
      }
    }

    // 如果提取后的查询为空或太短，返回原始 primaryGoal
    if (!query || query.length < 2) {
      return primaryGoal;
    }

    return query;
  }

  /**
   * Get default steps when LLM is unavailable
   */
  private getDefaultSteps(intent: Intent): any[] {
    return [
      {
        name: '分析需求',
        description: intent.primaryGoal,
        agent_type: 'AnalysisAgent',
        dependencies: [],
        estimated_duration: 60,
      },
    ];
  }
}
