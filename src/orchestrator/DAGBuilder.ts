/**
 * DAG Builder
 * Build task execution DAG from intent using LLM
 */

import { LLMClient } from '../llm/LLMClient.js';
import { TaskPlanningPrompt } from '../llm/prompts.js';
import { Intent, Task, DAGNode } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

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
    steps.forEach((step: any, index: number) => {
      dag.addTask({
        id: step.id || `task-${index + 1}`,
        name: step.name,
        description: step.description,
        agentType: step.agent_type || this.inferAgentType(step),
        requiredSkills: step.required_skills || [],
        dependencies: step.dependencies || [],
        estimatedDuration: step.estimated_duration || 300,
      });
    });

    // Validate no cycles
    if (dag.hasCycle()) {
      throw new Error('Generated DAG contains circular dependencies');
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
        }),
        { responseFormat: 'json' }
      );

      const parsed = JSON.parse(plan);
      return parsed.steps || [];
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to generate steps with LLM, using defaults');
      return this.getDefaultSteps(intent);
    }
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
