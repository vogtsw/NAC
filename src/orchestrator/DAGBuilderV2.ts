/**
 * DAG Builder V2
 * Uses agent routing + LLM planning, with deterministic search fallback.
 */

import { LLMClient } from '../llm/LLMClient.js';
import { TaskPlanningPrompt } from '../llm/prompts.js';
import { Intent, Task, DAGNode } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';
import { getSkillManager } from '../skills/SkillManager.js';
import { AgentRouter } from './AgentRouter.js';
import { getLLMClient } from '../llm/LLMClient.js';
import { DAGValidator } from './DAGValidator.js';

const logger = getLogger('DAGBuilderV2');

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
 * DAG Builder V2
 */
export class DAGBuilderV2 {
  private router: AgentRouter;
  private skillManager: ReturnType<typeof getSkillManager>;
  private llm: LLMClient;

  constructor(llm?: LLMClient) {
    this.llm = llm || getLLMClient();
    this.router = new AgentRouter(this.llm);
    this.skillManager = getSkillManager();
  }

  /**
   * Build DAG from intent
   */
  async build(intent: Intent): Promise<DAG> {
    logger.info({ intentType: intent.type, primaryGoal: intent.primaryGoal }, 'Building DAG (V2)');

    // Deterministic path for search intents to prevent generic drift.
    if (this.hasSearchCapability(intent)) {
      const searchDag = this.buildSearchDag(intent);
      logger.info({ taskCount: searchDag.getAllTasks().length, mode: 'deterministic-search' }, 'DAG built successfully (V2)');
      return searchDag;
    }

    const routingResult = await this.router.route({
      description: intent.primaryGoal,
      intent: intent.type,
      capabilities: intent.capabilities,
      complexity: intent.complexity === 'simple' ? 3 : intent.complexity === 'medium' ? 6 : 9,
    });

    const shouldCollaborate = this.router.shouldCollaborate(routingResult);

    const steps = this.shouldUseDeterministicFallback()
      ? this.getDefaultSteps(intent, routingResult)
      : this.llm
      ? await this.generateStepsWithContext(intent, routingResult, shouldCollaborate)
      : this.getDefaultSteps(intent, routingResult);

    const dag = new DAG();
    const searchQuery = this.extractSearchQuery(intent.primaryGoal);

    for (const step of steps) {
      const matchedAgent = this.findBestMatch(step, routingResult);
      const requiredSkills = this.mergeRequiredSkills(step, matchedAgent, intent);

      const task: Task = {
        id: step.id || `task-${steps.indexOf(step) + 1}`,
        name: step.name || '执行任务',
        description: step.description || intent.primaryGoal,
        agentType: matchedAgent?.agentType || step.agent_type || 'GenericAgent',
        requiredSkills,
        dependencies: step.dependencies || [],
        estimatedDuration: step.estimated_duration || 300,
      };

      if (requiredSkills.includes('web-search')) {
        task.searchQuery = searchQuery;
      }

      dag.addTask(task);
    }

    if (dag.hasCycle()) {
      throw new Error('Generated DAG contains circular dependencies');
    }

    const validator = new DAGValidator();
    const validationResult = validator.validate(dag as any, intent.primaryGoal);
    let finalDag = dag;

    if (!validationResult.isValid) {
      logger.warn(
        { issues: validationResult.issues },
        'DAG validation found issues in V2 builder, applying fixes'
      );
      finalDag = this.applyTaskFixes(dag, validationResult.fixes);
    }

    logger.info(
      {
        taskCount: steps.length,
        collaboration: shouldCollaborate,
        primaryAgent: routingResult[0]?.agentType,
      },
      'DAG built successfully (V2)'
    );

    return finalDag;
  }

  private hasSearchCapability(intent: Intent): boolean {
    const capabilities = (intent.capabilities || []).map((c) => String(c).toLowerCase());
    return capabilities.includes('web-search') || capabilities.includes('information-retrieval');
  }

  private shouldUseDeterministicFallback(): boolean {
    const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    return isTestRuntime && process.env.USE_LIVE_LLM_FOR_TESTS !== 'true';
  }

  private buildSearchDag(intent: Intent): DAG {
    const dag = new DAG();
    const query = this.extractSearchQuery(intent.primaryGoal);
    const isGithub = /github|git hub/i.test(intent.primaryGoal || '');

    dag.addTask({
      id: 'step_1',
      name: isGithub ? '搜索并整理本周 GitHub 热门项目' : '执行网络搜索并整理结果',
      description: intent.primaryGoal,
      agentType: 'AutomationAgent',
      requiredSkills: ['web-search'],
      dependencies: [],
      estimatedDuration: 90,
      searchQuery: query,
    });

    return dag;
  }

  private mergeRequiredSkills(step: any, matchedAgent: any, intent: Intent): string[] {
    const fromStep = this.normalizeSkills(step?.required_skills);
    const fromRoute = this.normalizeSkills(matchedAgent?.suggestedSkills);
    const merged = Array.from(new Set<string>([...fromStep, ...fromRoute]));

    if (this.hasSearchCapability(intent) && !merged.includes('web-search')) {
      merged.push('web-search');
    }

    return merged;
  }

  private normalizeSkills(input: any): string[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private applyTaskFixes(dag: DAG, fixes: Map<string, Partial<Task>>): DAG {
    const fixedDag = new DAG();

    for (const originalTask of dag.getAllTasks()) {
      const patch = fixes.get(originalTask.id);
      fixedDag.addTask(patch ? { ...originalTask, ...patch } : originalTask);
    }

    return fixedDag;
  }

  /**
   * Generate steps with routing context
   */
  private async generateStepsWithContext(
    intent: Intent,
    routingResult: any[],
    shouldCollaborate: boolean
  ): Promise<any[]> {
    const availableSkills = this.skillManager.getAvailableSkillNames();

    const routingContext = routingResult
      .slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.agentType} (${(r.confidence * 100).toFixed(0)}%): ${r.reason}`)
      .join('\n');

    const collaborationHint = shouldCollaborate
      ? '\n注意：此任务建议使用多 Agent 协作完成。'
      : '';

    try {
      const plan = await this.llm.complete(
        TaskPlanningPrompt.format({
          intent: intent.type,
          primaryGoal: intent.primaryGoal,
          capabilities: intent.capabilities.join(', '),
          complexity: intent.complexity,
          availableSkills,
        }) + `\n\n## Agent 路由建议\n${routingContext}${collaborationHint}\n\n请基于上述路由建议，调整执行计划中的 agent_type 分配。`,
        { responseFormat: 'json' }
      );

      const parsed = JSON.parse(plan);
      const steps = parsed.steps || [];

      return this.fixUnicodeInSteps(steps);
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to generate steps with LLM, using defaults');
      return this.getDefaultSteps(intent, routingResult);
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

  private findBestMatch(step: any, routingResult: any[]): any {
    if (!step.agent_type || step.agent_type === 'GenericAgent') {
      return routingResult[0];
    }

    const found = routingResult.find((r) => r.agentType === step.agent_type);
    if (found) {
      return found;
    }

    return routingResult[0];
  }

  private getDefaultSteps(intent: Intent, routingResult: any[]): any[] {
    const primaryAgent = routingResult[0]?.agentType || 'GenericAgent';
    const suggestedSkills = this.normalizeSkills(routingResult[0]?.suggestedSkills);

    return [
      {
        id: 'task-1',
        name: '分析需求',
        description: intent.primaryGoal,
        agent_type: primaryAgent,
        required_skills: suggestedSkills,
        dependencies: [],
        estimated_duration: 60,
      },
    ];
  }

  /**
   * Set LLM client (for delayed initialization)
   */
  setLLM(llm: LLMClient): void {
    this.llm = llm;
    this.router = new AgentRouter(llm);
  }

  private extractSearchQuery(primaryGoal: string): string {
    let query = (primaryGoal || '').trim();
    if (!query) return '';

    const prefixes = [
      '搜索关于',
      '搜索',
      '查找',
      '寻找',
      'search for',
      'search about',
      'search',
      'find',
      'look for',
      'lookup',
    ];

    for (const prefix of prefixes) {
      if (query.toLowerCase().startsWith(prefix.toLowerCase())) {
        query = query.slice(prefix.length).trim();
        break;
      }
    }

    const suffixes = [
      '的信息',
      '新闻',
      '最新消息',
      '最新进展',
      ' information',
      ' latest information',
      ' news',
      ' latest news',
    ];

    for (const suffix of suffixes) {
      if (query.toLowerCase().endsWith(suffix.toLowerCase())) {
        query = query.slice(0, query.length - suffix.length).trim();
        break;
      }
    }

    return query || primaryGoal;
  }
}
