/**
 * DAG Builder V2 - 使用智能路由器改进版本
 * 替代原来的简单关键词匹配
 */

import { LLMClient } from '../llm/LLMClient.js';
import { TaskPlanningPrompt } from '../llm/prompts.js';
import { Intent, Task, DAGNode } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';
import { getSkillManager } from '../skills/SkillManager.js';
import { AgentRouter } from './AgentRouter.js';
import { getAgentRegistry } from './AgentRegistry.js';

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
 * DAG Builder V2 - 使用智能路由器构建 DAG
 */
export class DAGBuilderV2 {
  private router: AgentRouter;
  private skillManager: ReturnType<typeof getSkillManager>;

  constructor(private llm?: LLMClient) {
    this.router = new AgentRouter(llm);
    this.skillManager = getSkillManager();
  }

  /**
   * 从意图构建 DAG
   */
  async build(intent: Intent): Promise<DAG> {
    logger.info({ intentType: intent.type, primaryGoal: intent.primaryGoal }, 'Building DAG (V2)');

    // 1. 使用智能路由器分析任务
    const routingResult = await this.router.route({
      description: intent.primaryGoal,
      intent: intent.type,
      capabilities: intent.capabilities,
      complexity: intent.complexity === 'simple' ? 3 : intent.complexity === 'medium' ? 6 : 9,
    });

    // 2. 检查是否需要多 Agent 协作
    const shouldCollaborate = this.router.shouldCollaborate(routingResult);

    let steps: any[];
    if (this.llm) {
      // 3. 生成执行步骤（带路由上下文）
      steps = await this.generateStepsWithContext(intent, routingResult, shouldCollaborate);
    } else {
      steps = this.getDefaultSteps(intent, routingResult);
    }

    // 4. 构建 DAG
    const dag = new DAG();
    for (const step of steps) {
      // 使用路由器推荐的 Agent 和 Skills
      const matchedAgent = this.findBestMatch(step, routingResult);

      dag.addTask({
        id: step.id || `task-${steps.indexOf(step) + 1}`,
        name: step.name,
        description: step.description,
        agentType: matchedAgent?.agentType || step.agent_type || 'GenericAgent',
        requiredSkills: matchedAgent?.suggestedSkills || step.required_skills || [],
        dependencies: step.dependencies || [],
        estimatedDuration: step.estimated_duration || 300,
      });
    }

    // 5. 验证无循环
    if (dag.hasCycle()) {
      throw new Error('Generated DAG contains circular dependencies');
    }

    logger.info({
      taskCount: steps.length,
      collaboration: shouldCollaborate,
      primaryAgent: routingResult[0]?.agentType,
    }, 'DAG built successfully (V2)');

    return dag;
  }

  /**
   * 带路由上下文的步骤生成
   */
  private async generateStepsWithContext(
    intent: Intent,
    routingResult: any[],
    shouldCollaborate: boolean
  ): Promise<any[]> {
    const availableSkills = this.skillManager.getAvailableSkillNames();

    const routingContext = routingResult.slice(0, 3).map((r, i) =>
      `${i + 1}. ${r.agentType} (置信度: ${(r.confidence * 100).toFixed(0)}%): ${r.reason}`
    ).join('\n');

    const collaborationHint = shouldCollaborate
      ? '\n注意：此任务建议使用多 Agent 协作完成。'
      : '';

    try {
      const plan = await this.llm!.complete(
        TaskPlanningPrompt.format({
          intent: intent.type,
          primaryGoal: intent.primaryGoal,
          capabilities: intent.capabilities.join(', '),
          complexity: intent.complexity,
          availableSkills,
        }) + `\n\n## Agent 路由建议\n${routingContext}${collaborationHint}

请基于上述路由建议，调整执行计划中的 agent_type 分配。`,
        { responseFormat: 'json' }
      );

      const parsed = JSON.parse(plan);
      const steps = parsed.steps || [];

      // 修复中文字符编码问题
      return this.fixUnicodeInSteps(steps);
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to generate steps with LLM, using defaults');
      return this.getDefaultSteps(intent, routingResult);
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
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  /**
   * 查找步骤与路由结果的最佳匹配
   */
  private findBestMatch(step: any, routingResult: any[]): any {
    if (!step.agent_type || step.agent_type === 'GenericAgent') {
      return routingResult[0];
    }

    // 如果步骤已指定 Agent，检查是否在路由结果中
    const found = routingResult.find(r => r.agentType === step.agent_type);
    if (found) {
      return found;
    }

    // 否则返回最佳匹配
    return routingResult[0];
  }

  /**
   * 获取默认步骤（当 LLM 不可用时）
   */
  private getDefaultSteps(intent: Intent, routingResult: any[]): any[] {
    const primaryAgent = routingResult[0]?.agentType || 'GenericAgent';
    const suggestedSkills = routingResult[0]?.suggestedSkills || [];

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
   * 设置 LLM 客户端（用于延迟初始化）
   */
  setLLM(llm: LLMClient): void {
    this.llm = llm;
    this.router = new AgentRouter(llm);
  }
}
