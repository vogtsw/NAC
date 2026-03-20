/**
 * Scheduler
 * Parallel task execution scheduler with Lane Queues
 */

import { DAG } from './DAGBuilder.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { getBlackboard } from '../state/Blackboard.js';
import { getEventBus, EventType } from '../state/EventBus.js';
import { Task } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';
import { getLaneQueueManager } from '../scheduler/LaneQueue.js';
import { getRetryManager, RetryManager } from '../reliability/RetryManager.js';
import { getIdempotencyManager } from '../reliability/IdempotencyManager.js';

const logger = getLogger('Scheduler');

/**
 * 修复 Unicode 转义字符（用于显示中文）
 */
export function fixUnicodeDisplay(text: string): string {
  if (!text) return text;
  // 解码 Unicode 转义 \uXXXX
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

export interface SchedulerContext {
  agentFactory: AgentFactory;
  sessionId: string;
}

/**
 * Scheduler - Execute DAG tasks using Lane Queues
 */
export class Scheduler {
  private runningTasks: Map<string, Promise<any>> = new Map();
  private laneQueueManager = getLaneQueueManager();
  private retryManager = getRetryManager();
  private idempotencyManager = getIdempotencyManager();
  private scheduleTimeout: number;

  constructor(private maxParallelAgents: number = 10, scheduleTimeout: number = 90000) { // 默认 90 秒超时
    this.scheduleTimeout = scheduleTimeout;
    logger.info({ maxParallelAgents, scheduleTimeout }, 'Scheduler initialized with Lane Queues');
  }

  /**
   * Schedule DAG execution using Lane Queues (with timeout protection)
   */
  async schedule(sessionId: string, dag: DAG, context: SchedulerContext): Promise<any> {
    logger.info({ sessionId, maxParallel: this.maxParallelAgents }, 'Starting DAG schedule with Lane Queues');

    const results: Map<string, any> = new Map();
    const startTime = Date.now();
    let round = 0;

    // Enqueue all tasks in their appropriate lanes
    const allTasks = dag.getAllTasks();
    for (const task of allTasks) {
      // Add default retry policy if not specified
      if (!task.retryPolicy) {
        task.retryPolicy = task.lane ? this.laneQueueManager.getLaneConfig(task.lane)?.retryPolicy :
                                       RetryManager.getDefaultPolicy('linear');
      }
      this.laneQueueManager.enqueue(task);
    }

    logger.info({ totalTasks: allTasks.length }, 'Tasks enqueued in Lane Queues');

    // Process tasks until all are complete (with timeout check)
    while (!dag.isComplete()) {
      // 检查是否超时
      const elapsed = Date.now() - startTime;
      if (elapsed > this.scheduleTimeout) {
        throw new Error(`DAG execution timeout after ${elapsed}ms (limit: ${this.scheduleTimeout}ms)`);
      }

      round++;
      const readyTasks = dag.getReadyTasks();

      if (readyTasks.length === 0) {
        logger.warn('No ready tasks but DAG not complete - waiting for running tasks');
        await this.waitForAnyTask();
        continue;
      }

      logger.info({ round, readyTaskCount: readyTasks.length }, 'Processing round');

      // Get next tasks from lane queues
      const tasksToExecute: Task[] = [];
      for (const task of readyTasks) {
        const { task: nextTask, lane } = this.laneQueueManager.getNextTask();
        if (nextTask && lane) {
          tasksToExecute.push(nextTask);
          this.laneQueueManager.markTaskStarted(nextTask.id);
        }
      }

      if (tasksToExecute.length === 0) {
        // No lanes available for execution, wait
        await this.sleep(100);
        continue;
      }

      // Execute tasks with retry logic
      const executions = tasksToExecute.map((task) =>
        this.executeTaskWithRetry(task, sessionId, context).catch((error) => ({
          taskId: task.id,
          error: error.message,
        }))
      );

      const taskResults = await Promise.all(executions);

      // Update DAG with completed tasks
      for (const result of taskResults) {
        if (result && result.taskId) {
          dag.markTaskComplete(result.taskId);
          this.laneQueueManager.markTaskCompleted(result.taskId);
          results.set(result.taskId, result);
        }
      }

      // Log lane queue statistics
      if (round % 5 === 0) {
        const stats = this.laneQueueManager.getStats();
        logger.debug({ round, laneStats: stats }, 'Lane Queue statistics');
      }
    }

    logger.info({ sessionId, totalResults: results.size }, 'DAG schedule completed');
    return Object.fromEntries(results.entries());
  }

  /**
   * Execute a single task with retry logic
   */
  private async executeTaskWithRetry(
    task: Task,
    sessionId: string,
    context: SchedulerContext
  ): Promise<any> {
    const retryPolicy = task.retryPolicy || this.retryManager.getDefaultPolicy('linear');

    return this.retryManager.executeWithRetry(
      () => this.executeTask(task, sessionId, context),
      retryPolicy,
      { operationName: `Task: ${task.name}`, taskId: task.id }
    );
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

    logger.info({ taskId, taskName: fixUnicodeDisplay(task.name) }, 'Starting task');

    // Create execution promise and track it
    const executionPromise = (async () => {
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
    })();

    // Track the running task
    this.runningTasks.set(taskId, executionPromise);

    return await executionPromise;
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

  /**
   * Sleep utility for delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get scheduler statistics
   */
  getStats(): {
    runningTasks: number;
    laneQueueStats: Array<ReturnType<typeof getLaneQueueManager extends () => any ? any : any>>;
  } {
    return {
      runningTasks: this.runningTasks.size,
      laneQueueStats: this.laneQueueManager.getStats(),
    };
  }
}
