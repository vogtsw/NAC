/**
 * Cron Scheduler
 * Manages cron-based scheduled tasks
 */

import cron from 'node-cron';
import cronParser from 'cron-parser';
import type { ScheduledTask, ExecutionRecord } from '../state/models_extended.js';
import { getScheduledTaskStore } from '../state/ScheduledTaskStore.js';
import type { getOrchestrator } from '../orchestrator/Orchestrator.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('CronScheduler');

export class CronScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();
  private orchestrator: ReturnType<typeof getOrchestrator>;
  private store: ReturnType<typeof getScheduledTaskStore>;
  private initialized: boolean = false;

  constructor() {
    this.store = getScheduledTaskStore();
  }

  /**
   * Initialize the scheduler
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.store.ensureDirectories();

    // Load active tasks on startup
    const tasks = await this.store.listTasks();
    let loadedCount = 0;

    for (const task of tasks) {
      if (task.status === 'active' && task.schedule.cron) {
        try {
          await this.addCronJob(task);
          loadedCount++;
        } catch (error: any) {
          logger.warn({ taskId: task.id, error: error.message }, 'Failed to load cron job on startup');
        }
      }
    }

    this.initialized = true;
    logger.info({ loadedTasks: loadedCount, totalTasks: tasks.length }, 'CronScheduler initialized');
  }

  /**
   * Add a cron job
   */
  async addCronJob(task: ScheduledTask): Promise<void> {
    const { id, schedule, task: taskContent } = task;
    const { cron: cronConfig } = schedule;

    if (!cronConfig) {
      throw new Error('Invalid cron configuration');
    }

    // Validate cron expression
    try {
      new cronParser.CronExpression(cronConfig.expression);
    } catch (error) {
      throw new Error(`Invalid cron expression: ${cronConfig.expression}`);
    }

    // Check if task should be active (based on start/end date)
    const now = new Date();
    if (cronConfig.startDate && now < cronConfig.startDate) {
      task.status = 'pending';
      await this.store.saveTask(task);
      logger.info({ taskId: id, startDate: cronConfig.startDate }, 'Task scheduled for future');
      return;
    }

    if (cronConfig.endDate && now > cronConfig.endDate) {
      task.status = 'completed';
      task.completedAt = now;
      await this.store.saveTask(task);
      logger.info({ taskId: id, endDate: cronConfig.endDate }, 'Task expired');
      return;
    }

    // Create cron job
    const job = cron.schedule(cronConfig.expression, async () => {
      await this.executeScheduledTask(task);
    }, {
      scheduled: true,
      timezone: cronConfig.timezone || 'Asia/Shanghai',
    });

    this.jobs.set(id, job);

    // Update task status and next run time
    task.status = 'active';
    task.nextRunAt = this.getNextRunTime(cronConfig.expression, cronConfig.timezone);
    await this.store.saveTask(task);

    logger.info({
      taskId: id,
      cronExpression: cronConfig.expression,
      nextRunAt: task.nextRunAt,
    }, 'Cron job added');
  }

  /**
   * Remove a cron job
   */
  async removeCronJob(taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);

    if (job) {
      job.stop();
      this.jobs.delete(taskId);
      logger.info({ taskId }, 'Cron job removed');
    }

    await this.store.deleteTask(taskId);
  }

  /**
   * Pause a cron job
   */
  async pauseCronJob(taskId: string): Promise<void> {
    const job = this.jobs.get(taskId);

    if (job) {
      job.stop();
      this.jobs.delete(taskId);

      const task = await this.store.loadTask(taskId);
      if (task && task.status === 'active') {
        task.status = 'paused';
        await this.store.saveTask(task);
        logger.info({ taskId }, 'Cron job paused');
      }
    }
  }

  /**
   * Resume a paused cron job
   */
  async resumeCronJob(taskId: string): Promise<void> {
    const task = await this.store.loadTask(taskId);

    if (task && task.status === 'paused' && task.schedule.cron) {
      await this.addCronJob(task);
      logger.info({ taskId }, 'Cron job resumed');
    }
  }

  /**
   * Get next run time for a cron expression
   */
  private getNextRunTime(cronExpression: string, timezone = 'Asia/Shanghai'): Date {
    try {
      const interval = new cronParser.CronExpression(cronExpression, { tz: timezone });
      const nextDate = interval.next();
      return nextDate.toDate();
    } catch (error) {
      logger.warn({ cronExpression, error }, 'Failed to parse cron expression, using default');
      // Default to 1 hour from now
      return new Date(Date.now() + 3600000);
    }
  }

  /**
   * Execute a scheduled task
   */
  private async executeScheduledTask(task: ScheduledTask): Promise<void> {
    const execution: ExecutionRecord = {
      runId: `run-${Date.now()}`,
      startedAt: new Date(),
      status: 'running',
    };

    logger.info({ taskId: task.id, runId: execution.runId }, 'Executing scheduled task');

    try {
      // Import Orchestrator dynamically to avoid circular dependency
      const { getOrchestrator } = await import('../orchestrator/Orchestrator.js');
      this.orchestrator = getOrchestrator();

      // Ensure orchestrator is initialized
      if (!this.orchestrator['initialized']) {
        await this.orchestrator.initialize();
      }

      // Use Orchestrator to execute the task
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
        duration: execution.completedAt.getTime() - execution.startedAt.getTime(),
      }, 'Scheduled task completed');

    } catch (error: any) {
      execution.completedAt = new Date();
      execution.status = 'failed';
      execution.error = error.message;

      logger.error({
        taskId: task.id,
        runId: execution.runId,
        error: error.message,
      }, 'Scheduled task failed');
    }

    // Save execution record
    await this.store.saveExecution(task.id, execution);

    // Update task
    const currentTask = await this.store.loadTask(task.id);
    if (currentTask) {
      currentTask.lastRunAt = new Date();
      currentTask.executions.push(execution);

      // Check if max runs reached
      if (currentTask.schedule.cron?.maxRuns) {
        if (currentTask.executions.length >= currentTask.schedule.cron.maxRuns) {
          await this.removeCronJob(task.id);
          currentTask.status = 'completed';
          currentTask.completedAt = new Date();
          logger.info({ taskId: task.id, executionsCount: currentTask.executions.length }, 'Scheduled task completed (max runs reached)');
        }
      }

      // Check if end date reached
      if (currentTask.schedule.cron?.endDate) {
        if (new Date() > currentTask.schedule.cron.endDate) {
          await this.removeCronJob(task.id);
          currentTask.status = 'completed';
          currentTask.completedAt = new Date();
          logger.info({ taskId: task.id }, 'Scheduled task completed (end date reached)');
        }
      }

      // Update next run time
      currentTask.nextRunAt = this.getNextRunTime(
        currentTask.schedule.cron!.expression,
        currentTask.schedule.cron!.timezone
      );
      await this.store.saveTask(currentTask);
    }
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
    return await this.store.loadTask(taskId);
  }

  /**
   * Get execution history for a task
   */
  async getExecutions(taskId: string, limit = 50): Promise<ExecutionRecord[]> {
    return await this.store.getExecutions(taskId, limit);
  }

  /**
   * Shutdown the scheduler
   */
  async shutdown(): Promise<void> {
    // Stop all cron jobs
    for (const [taskId, job] of this.jobs.entries()) {
      job.stop();
    }

    this.jobs.clear();
    this.initialized = false;

    logger.info('CronScheduler shut down');
  }
}

// Singleton instance
let cronScheduler: CronScheduler | null = null;

export function getCronScheduler(): CronScheduler {
  if (!cronScheduler) {
    cronScheduler = new CronScheduler();
  }
  return cronScheduler;
}

export function createCronScheduler(): CronScheduler {
  return new CronScheduler();
}
