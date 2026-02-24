/**
 * Scheduler
 * Parallel task execution scheduler
 */

import { DAG } from './DAGBuilder.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { getBlackboard } from '../state/Blackboard.js';
import { getEventBus, EventType } from '../state/EventBus.js';
import { Task } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('Scheduler');

export interface SchedulerContext {
  agentFactory: AgentFactory;
}

/**
 * Scheduler - Execute DAG tasks in parallel where possible
 */
export class Scheduler {
  private runningTasks: Map<string, Promise<any>> = new Map();

  constructor(private maxParallelAgents: number = 10) {}

  /**
   * Schedule DAG execution
   */
  async schedule(sessionId: string, dag: DAG, context: SchedulerContext): Promise<any> {
    logger.info({ sessionId, maxParallel: this.maxParallelAgents }, 'Starting DAG schedule');

    const results: Map<string, any> = new Map();
    let round = 0;

    while (!dag.isComplete()) {
      round++;
      const readyTasks = dag.getReadyTasks();

      if (readyTasks.length === 0) {
        logger.warn('No ready tasks but DAG not complete - waiting for running tasks');
        await this.waitForAnyTask();
        continue;
      }

      logger.info({ round, readyTaskCount: readyTasks.length }, 'Executing round');

      // Execute ready tasks in parallel
      const executions = readyTasks.map((task) =>
        this.executeTask(task, sessionId, context).catch((error) => ({
          taskId: task.id,
          error: error.message,
        }))
      );

      const taskResults = await Promise.all(executions);

      // Update DAG with completed tasks
      for (const result of taskResults) {
        if (result && result.taskId) {
          dag.markTaskComplete(result.taskId);
          results.set(result.taskId, result);
        }
      }
    }

    logger.info({ sessionId, totalResults: results.size }, 'DAG schedule completed');
    return Object.fromEntries(results);
  }

  /**
   * Execute a single task
   */
  private async executeTask(
    task: Task,
    sessionId: string,
    context: SchedulerContext
  ): Promise<any> {
    const taskId = task.id;
    const blackboard = getBlackboard();
    const eventBus = getEventBus();

    logger.info({ taskId, taskName: task.name }, 'Starting task');

    try {
      // Update task status
      await blackboard.updateTaskStatus(sessionId, taskId, 'running');
      await eventBus.publish(EventType.TASK_UPDATED, { sessionId, taskId, status: 'running' });

      // Create agent
      const agent = await context.agentFactory.create(task.agentType, {
        taskId,
        skills: task.requiredSkills,
      });

      // Execute task
      const startTime = Date.now();
      const result = await agent.execute(task);
      const duration = Date.now() - startTime;

      // Record result
      await blackboard.recordTaskResult(sessionId, taskId, result);
      await eventBus.publish(EventType.TASK_COMPLETED, { sessionId, taskId, result, duration });

      logger.info({ taskId, duration }, 'Task completed');

      return { taskId, result, duration };
    } catch (error: any) {
      logger.error({ taskId, error: error.message }, 'Task failed');

      await blackboard.updateTaskStatus(sessionId, taskId, 'failed');
      await eventBus.publish(EventType.TASK_FAILED, { sessionId, taskId, error: error.message });

      throw error;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  /**
   * Wait for any running task to complete
   */
  private async waitForAnyTask(): Promise<void> {
    if (this.runningTasks.size === 0) return;

    try {
      await Promise.race(this.runningTasks.values());
    } catch (error) {
      // Task failed, continue
    }
  }

  /**
   * Cancel a specific task
   */
  async cancelTask(taskId: string): Promise<boolean> {
    const task = this.runningTasks.get(taskId);
    if (task) {
      this.runningTasks.delete(taskId);
      logger.info({ taskId }, 'Task cancelled');
      return true;
    }
    return false;
  }

  /**
   * Cancel all running tasks
   */
  async cancelAll(): Promise<void> {
    for (const taskId of this.runningTasks.keys()) {
      await this.cancelTask(taskId);
    }
    logger.info('All tasks cancelled');
  }
}
