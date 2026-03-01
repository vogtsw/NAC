/**
 * Task Scheduler
 * Manages all types of scheduled tasks (cron, once, delay)
 */

import type { ScheduledTask, ExecutionRecord } from '../state/models_extended.js';
import { getCronScheduler } from './CronScheduler.js';
import { getScheduledTaskStore } from '../state/ScheduledTaskStore.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('TaskScheduler');

export class TaskScheduler {
  private cronScheduler: ReturnType<typeof getCronScheduler>;
  private delayedTasks: Map<string, NodeJS.Timeout> = new Map();
  private orchestrator: any;
  private store: ReturnType<typeof getScheduledTaskStore>;
  private initialized: boolean = false;

  constructor() {
    this.cronScheduler = getCronScheduler();
    this.store = getScheduledTaskStore();
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.cronScheduler.initialize();
    await this.store.ensureDirectories();

    // Get reference to Orchestrator (don't initialize - it's already initializing us)
    const { getOrchestrator } = await import('../orchestrator/Orchestrator.js');
    this.orchestrator = getOrchestrator();

    // Load and restore active tasks
    await this.restoreActiveTasks();

    this.initialized = true;
    logger.info('TaskScheduler initialized');
  }

  /**
   * Schedule a task
   */
  async schedule(task: ScheduledTask): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    await this.store.saveTask(task);

    switch (task.type) {
      case 'cron':
        // Cron jobs are handled by CronScheduler
        if (task.status === 'active') {
          await this.cronScheduler.addCronJob(task);
        }
        break;

      case 'once':
        await this.scheduleOnce(task);
        break;

      case 'delay':
        await this.scheduleDelay(task);
        break;
    }

    logger.info({ taskId: task.id, type: task.type, name: task.name }, 'Task scheduled');
    return task.id;
  }

  /**
   * Schedule a one-time task
   */
  private async scheduleOnce(task: ScheduledTask): Promise<void> {
    const { once } = task.schedule;
    if (!once) return;

    const executeAt = once.executeAt;
    const delay = executeAt.getTime() - Date.now();

    if (delay <= 0) {
      // Already passed, execute immediately
      await this.executeTask(task);
      return;
    }

    const timeout = setTimeout(async () => {
      await this.executeTask(task);
    }, delay);

    this.delayedTasks.set(task.id, timeout);
    task.status = 'active';
    await this.store.saveTask(task);

    logger.info({ taskId: task.id, executeAt }, 'One-time task scheduled');
  }

  /**
   * Schedule a delayed task
   */
  private async scheduleDelay(task: ScheduledTask): Promise<void> {
    const { delay } = task.schedule;
    if (!delay) return;

    const timeout = setTimeout(async () => {
      await this.executeTask(task);
    }, delay.delayMs);

    this.delayedTasks.set(task.id, timeout);
    task.status = 'active';
    await this.store.saveTask(task);

    logger.info({ taskId: task.id, delayMs: delay.delayMs }, 'Delayed task scheduled');
  }

  /**
   * Execute a task (used by all schedulers)
   */
  async executeTask(task: ScheduledTask): Promise<void> {
    const execution: ExecutionRecord = {
      runId: `run-${Date.now()}`,
      startedAt: new Date(),
      status: 'running',
    };

    logger.info({ taskId: task.id, userInput: task.task.userInput }, 'Executing scheduled task');

    try {
      // Use Orchestrator to execute
      const result = await this.orchestrator.processRequest({
        sessionId: `scheduled-${task.id}-${execution.runId}`,
        userInput: task.task.userInput,
        context: {
          ...task.task.context,
          userId: task.task.userId,
          scheduledTaskId: task.id,
        },
      });

      execution.completedAt = new Date();
      execution.status = result.success ? 'success' : 'failed';
      execution.result = result;

      logger.info({
        taskId: task.id,
        runId: execution.runId,
        success: result.success,
      }, 'Scheduled task executed');

    } catch (error: any) {
      execution.completedAt = new Date();
      execution.status = 'failed';
      execution.error = error.message;
      logger.error({
        taskId: task.id,
        error: error.message,
      }, 'Scheduled task execution failed');
    }

    // Save execution record
    await this.store.saveExecution(task.id, execution);

    // Update task status
    const updatedTask = await this.store.loadTask(task.id);
    if (updatedTask) {
      updatedTask.lastRunAt = new Date();
      updatedTask.executions.push(execution);

      // For one-time and delay tasks, mark as completed after execution
      if (updatedTask.type === 'once' || updatedTask.type === 'delay') {
        updatedTask.status = 'completed';
        updatedTask.completedAt = new Date();
      }

      await this.store.saveTask(updatedTask);
    }
  }

  /**
   * Cancel a task
   */
  async cancel(taskId: string): Promise<boolean> {
    // Cancel cron job if exists
    await this.cronScheduler.removeCronJob(taskId);

    // Cancel delayed task if exists
    const timeout = this.delayedTasks.get(taskId);
    if (timeout) {
      clearTimeout(timeout);
      this.delayedTasks.delete(taskId);
    }

    // Delete from store
    const deleted = await this.store.deleteTask(taskId);

    if (deleted) {
      logger.info({ taskId }, 'Task cancelled');
    }

    return deleted;
  }

  /**
   * Pause a task
   */
  async pause(taskId: string): Promise<boolean> {
    const task = await this.store.getTask(taskId);

    if (!task || task.status !== 'active') {
      return false;
    }

    if (task.type === 'cron') {
      await this.cronScheduler.pauseCronJob(taskId);
    } else if (task.type === 'delay' || task.type === 'once') {
      const timeout = this.delayedTasks.get(taskId);
      if (timeout) {
        clearTimeout(timeout);
        this.delayedTasks.delete(taskId);
      }
    }

    task.status = 'paused';
    await this.store.saveTask(task);

    logger.info({ taskId }, 'Task paused');
    return true;
  }

  /**
   * Resume a paused task
   */
  async resume(taskId: string): Promise<boolean> {
    const task = await this.store.getTask(taskId);

    if (!task || task.status !== 'paused') {
      return false;
    }

    if (task.type === 'cron') {
      await this.cronScheduler.resumeCronJob(taskId);
    } else if (task.type === 'once') {
      await this.scheduleOnce(task);
    } else if (task.type === 'delay') {
      await this.scheduleDelay(task);
    }

    logger.info({ taskId }, 'Task resumed');
    return true;
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<ScheduledTask[]> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.store.listTasks();
  }

  /**
   * Get a specific task
   */
  async getTask(taskId: string): Promise<ScheduledTask | null> {
    if (!this.initialized) {
      await this.initialize();
    }
    return await this.store.getTask(taskId);
  }

  /**
   * Get execution history for a task
   */
  async getExecutions(taskId: string, limit = 50): Promise<any[]> {
    return await this.store.getExecutions(taskId, limit);
  }

  /**
   * Restore active tasks on startup
   */
  private async restoreActiveTasks(): Promise<void> {
    const tasks = await this.store.listTasks();
    let restoredCount = 0;

    for (const task of tasks) {
      if (task.status === 'active') {
        try {
          if (task.type === 'cron') {
            // Cron jobs are already loaded by CronScheduler.initialize()
            restoredCount++;
          } else if (task.type === 'once') {
            await this.scheduleOnce(task);
            restoredCount++;
          } else if (task.type === 'delay') {
            await this.scheduleDelay(task);
            restoredCount++;
          }
        } catch (error: any) {
          logger.warn({ taskId: task.id, error: error.message }, 'Failed to restore task');
        }
      }
    }

    logger.info({ restoredCount, total: tasks.length }, 'Tasks restored on startup');
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    // Clear all delayed tasks
    for (const [, timeout] of this.delayedTasks.entries()) {
      clearTimeout(timeout);
    }
    this.delayedTasks.clear();

    // Shutdown cron scheduler
    await this.cronScheduler.shutdown();

    this.initialized = false;
    logger.info('TaskScheduler shut down');
  }
}

// Singleton instance
let taskScheduler: TaskScheduler | null = null;

export function getTaskScheduler(): TaskScheduler {
  if (!taskScheduler) {
    taskScheduler = new TaskScheduler();
  }
  return taskScheduler;
}

export function createTaskScheduler(): TaskScheduler {
  return new TaskScheduler();
}
