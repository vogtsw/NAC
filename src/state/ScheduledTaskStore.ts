/**
 * Scheduled Task Store
 * Manages scheduled task persistence
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get project root directory
const PROJECT_ROOT = join(__dirname, '../../..');

import type { ScheduledTask, ExecutionRecord } from './models_extended.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('ScheduledTaskStore');

export class ScheduledTaskStore {
  private tasksDir: string;
  private executionsDir: string;
  private index: Map<string, string> = new Map(); // taskId -> filePath

  constructor(baseDir?: string) {
    const memoryDir = baseDir || join(PROJECT_ROOT, 'memory');
    this.tasksDir = join(memoryDir, 'scheduled', 'tasks');
    this.executionsDir = join(memoryDir, 'scheduled', 'executions');
  }

  /**
   * Ensure directories exist
   */
  async ensureDirectories(): Promise<void> {
    for (const dir of [this.tasksDir, this.executionsDir]) {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  /**
   * Get task file path
   */
  private getTaskPath(taskId: string): string {
    return join(this.tasksDir, `${taskId}.json`);
  }

  /**
   * Get execution directory for a task
   */
  private getExecutionDir(taskId: string): string {
    return join(this.executionsDir, taskId);
  }

  /**
   * Save task
   */
  async saveTask(task: ScheduledTask): Promise<void> {
    await this.ensureDirectories();

    const path = this.getTaskPath(task.id);

    try {
      await fs.writeFile(path, JSON.stringify(task, null, 2), 'utf-8');
      this.index.set(task.id, path);
    } catch (error: any) {
      throw new Error(`Failed to save task ${task.id}: ${error.message}`);
    }
  }

  /**
   * Load task
   */
  async loadTask(taskId: string): Promise<ScheduledTask | null> {
    const path = this.getTaskPath(taskId);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = await fs.readFile(path, 'utf-8');
      const task = JSON.parse(content) as ScheduledTask;

      // Convert date strings back to Date objects
      if (task.createdAt) task.createdAt = new Date(task.createdAt);
      if (task.nextRunAt) task.nextRunAt = new Date(task.nextRunAt);
      if (task.lastRunAt) task.lastRunAt = new Date(task.lastRunAt);
      if (task.completedAt) task.completedAt = new Date(task.completedAt);
      if (task.schedule.cron?.startDate) task.schedule.cron.startDate = new Date(task.schedule.cron.startDate);
      if (task.schedule.cron?.endDate) task.schedule.cron.endDate = new Date(task.schedule.cron.endDate);
      if (task.schedule.once?.executeAt) task.schedule.once.executeAt = new Date(task.schedule.once.executeAt);

      if (task.executions) {
        task.executions.forEach((e: any) => {
          if (e.startedAt) e.startedAt = new Date(e.startedAt);
          if (e.completedAt) e.completedAt = new Date(e.completedAt);
        });
      }

      this.index.set(taskId, path);
      return task;
    } catch (error: any) {
      logger.error({ taskId, error: error.message }, 'Failed to load task');
      return null;
    }
  }

  /**
   * Get task (alias for loadTask)
   */
  async getTask(taskId: string): Promise<ScheduledTask | null> {
    return await this.loadTask(taskId);
  }

  /**
   * Delete task
   */
  async deleteTask(taskId: string): Promise<boolean> {
    const path = this.getTaskPath(taskId);

    if (!existsSync(path)) {
      return false;
    }

    try {
      await fs.unlink(path);
      this.index.delete(taskId);

      // Also delete execution records
      const execDir = this.getExecutionDir(taskId);
      if (existsSync(execDir)) {
        await fs.rm(execDir, { recursive: true, force: true });
      }

      return true;
    } catch (error: any) {
      logger.error({ taskId, error: error.message }, 'Failed to delete task');
      return false;
    }
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<ScheduledTask[]> {
    await this.ensureDirectories();

    try {
      const files = await fs.readdir(this.tasksDir);
      const tasks: ScheduledTask[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const taskId = file.replace('.json', '');
          const task = await this.loadTask(taskId);
          if (task) {
            tasks.push(task);
          }
        }
      }

      return tasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      logger.error({ error }, 'Failed to list tasks');
      return [];
    }
  }

  /**
   * Save execution record
   */
  async saveExecution(taskId: string, execution: ExecutionRecord): Promise<void> {
    const execDir = this.getExecutionDir(taskId);

    if (!existsSync(execDir)) {
      await fs.mkdir(execDir, { recursive: true });
    }

    const path = join(execDir, `${execution.runId}.json`);

    try {
      await fs.writeFile(path, JSON.stringify(execution, null, 2), 'utf-8');
    } catch (error: any) {
      logger.error({ taskId, runId: execution.runId, error: error.message }, 'Failed to save execution record');
    }
  }

  /**
   * Get execution records for a task
   */
  async getExecutions(taskId: string, limit = 50): Promise<ExecutionRecord[]> {
    const execDir = this.getExecutionDir(taskId);

    if (!existsSync(execDir)) {
      return [];
    }

    try {
      const files = await fs.readdir(execDir);
      const records: ExecutionRecord[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(join(execDir, file), 'utf-8');
          const record = JSON.parse(content) as ExecutionRecord;

          // Convert date strings back to Date objects
          if (record.startedAt) record.startedAt = new Date(record.startedAt);
          if (record.completedAt) record.completedAt = new Date(record.completedAt);

          records.push(record);
        }
      }

      // Sort by start time descending
      records.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

      return records.slice(0, limit);
    } catch (error) {
      logger.error({ taskId, error }, 'Failed to load execution records');
      return [];
    }
  }

  /**
   * Check if task exists
   */
  taskExists(taskId: string): boolean {
    return this.index.has(taskId);
  }
}

// Singleton instance
let scheduledTaskStore: ScheduledTaskStore | null = null;

export function getScheduledTaskStore(): ScheduledTaskStore {
  if (!scheduledTaskStore) {
    scheduledTaskStore = new ScheduledTaskStore();
  }
  return scheduledTaskStore;
}

export function createScheduledTaskStore(baseDir?: string): ScheduledTaskStore {
  return new ScheduledTaskStore(baseDir);
}
