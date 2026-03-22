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

    const mappedSkills = this.mapCapabilitiesToSkills(intent.capabilities);

    // Deterministic path for search intents to avoid generic analysis drift.
    if (intent.type === 'automation' && mappedSkills.includes('web-search')) {
      const dag = this.buildSearchDag(intent);
      logger.info({ taskCount: dag.getAllTasks().length }, 'DAG built successfully');
      return dag;
    }

    const steps = await this.generateSteps(intent);
    const dag = new DAG();

    let extractedSearchQuery: string | undefined;
    if (intent.type === 'automation' && mappedSkills.includes('web-search')) {
      extractedSearchQuery = this.extractSearchQueryFromGoal(intent.primaryGoal);
      logger.debug({ extractedSearchQuery }, 'Extracted search query from primaryGoal');
    }

    steps.forEach((step: any, index: number) => {
      let requiredSkills: string[] = [];

      if (intent.type === 'automation') {
        if (Array.isArray(step.required_skills) && step.required_skills.length > 0) {
          requiredSkills = step.required_skills;
        } else if (mappedSkills.length > 0) {
          requiredSkills = mappedSkills;
        }

        if (mappedSkills.includes('web-search') && !requiredSkills.includes('web-search')) {
          requiredSkills = [...requiredSkills, 'web-search'];
        }
      }

      const inferredAgentType = step.agent_type || this.inferAgentType(step);
      const agentType = requiredSkills.includes('web-search') ? 'AutomationAgent' : inferredAgentType;

      const taskData: Task = {
        id: step.id || `task-${index + 1}`,
        name: step.name || '执行任务',
        description: step.description || intent.primaryGoal,
        agentType,
        requiredSkills,
        dependencies: step.dependencies || [],
        estimatedDuration: step.estimated_duration || 300,
      };

      if (extractedSearchQuery && requiredSkills.includes('web-search')) {
        taskData.searchQuery = extractedSearchQuery;
      }

      dag.addTask(taskData);
    });

    if (dag.hasCycle()) {
      throw new Error('Generated DAG contains circular dependencies');
    }

    const validator = new DAGValidator();
    const validationResult = validator.validate(dag, intent.primaryGoal);

    if (!validationResult.isValid) {
      logger.warn({ issues: validationResult.issues }, 'DAG validation found issues, applying fixes');
      const fixedDag = validator.applyFixes(dag, validationResult.fixes);
      logger.info({ fixedTasks: validationResult.fixes.size }, 'DAG fixes applied');
      logger.info({ taskCount: steps.length }, 'DAG built successfully');
      return fixedDag;
    }

    logger.info({ taskCount: steps.length }, 'DAG built successfully');
    return dag;
  }

  private buildSearchDag(intent: Intent): DAG {
    const dag = new DAG();
    const searchQuery = this.extractSearchQueryFromGoal(intent.primaryGoal);

    dag.addTask({
      id: 'step_1',
      name: /github|git hub/i.test(intent.primaryGoal || '')
        ? '搜索并整理本周 GitHub 热门项目'
        : '执行网络搜索并整理结果',
      description: intent.primaryGoal,
      agentType: 'AutomationAgent',
      requiredSkills: ['web-search'],
      dependencies: [],
      estimatedDuration: 90,
      searchQuery,
    });

    logger.info({ searchQuery }, 'Using deterministic search DAG');
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
          availableSkills: [],
        }),
        { responseFormat: 'json' }
      );

      const parsed = JSON.parse(plan);
      const steps = parsed.steps || [];
      return this.fixUnicodeInSteps(steps);
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to generate steps with LLM, using defaults');
      return this.getDefaultSteps(intent);
    }
  }

  private fixUnicodeInSteps(steps: any[]): any[] {
    return steps.map((step) => ({
      ...step,
      name: this.unescapeUnicode(step.name || ''),
      description: this.unescapeUnicode(step.description || ''),
    }));
  }

  private unescapeUnicode(text: string): string {
    if (!text) return text;
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  private inferAgentType(step: any): string {
    const description = (step.description || '').toLowerCase();

    if (description.includes('code') || description.includes('api') || description.includes('implement')) {
      return 'CodeAgent';
    }
    if (description.includes('data') || description.includes('analyze')) {
      return 'DataAgent';
    }
    if (description.includes('test') || description.includes('verify') || description.includes('review')) {
      return 'AnalysisAgent';
    }
    if (description.includes('automation') || description.includes('deploy')) {
      return 'AutomationAgent';
    }

    return 'GenericAgent';
  }

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
      const skill = skillMapping[String(cap).toLowerCase()];
      if (skill) skills.push(skill);
    }

    logger.debug({ capabilities, skills }, 'Mapped capabilities to skills');
    return skills;
  }

  private extractSearchQueryFromGoal(primaryGoal: string): string {
    const prefixes = [
      '搜索关于',
      '搜索',
      '查找',
      'search for',
      'search about',
      'search',
      'find',
      'look for',
    ];

    let query = primaryGoal || '';
    for (const prefix of prefixes) {
      if (query.toLowerCase().startsWith(prefix.toLowerCase())) {
        query = query.substring(prefix.length).trim();
        break;
      }
    }

    const suffixes = [
      ' 的信息',
      '的信息',
      ' 新闻',
      ' 最新消息',
      ' 最新进展',
      ' news',
      ' latest news',
      ' information',
      ' latest information',
    ];

    for (const suffix of suffixes) {
      if (query.toLowerCase().endsWith(suffix.toLowerCase())) {
        query = query.substring(0, query.length - suffix.length).trim();
        break;
      }
    }

    return !query || query.length < 2 ? primaryGoal : query;
  }

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
