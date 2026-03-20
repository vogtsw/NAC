/**
 * Lane Queue System
 * Priority-based concurrent task execution with lane-based isolation
 * Prevents resource exhaustion and provides task prioritization
 */

import { Task, RetryPolicy } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('LaneQueue');

/**
 * Priority Queue Node
 */
interface PriorityQueueNode {
  task: Task;
  priority: number;
  enqueueTime: number;
}

/**
 * Priority Queue implementation
 */
class PriorityQueue {
  private items: PriorityQueueNode[] = [];

  enqueue(task: Task, priority: number): void {
    const node: PriorityQueueNode = {
      task,
      priority,
      enqueueTime: Date.now(),
    };

    // Insert in priority order (lower priority number = higher priority)
    let added = false;
    for (let i = 0; i < this.items.length; i++) {
      if (priority < this.items[i].priority) {
        this.items.splice(i, 0, node);
        added = true;
        break;
      }
    }

    if (!added) {
      this.items.push(node);
    }
  }

  dequeue(): Task | null {
    return this.items.shift()?.task || null;
  }

  peek(): Task | null {
    return this.items[0]?.task || null;
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }

  remove(taskId: string): boolean {
    const index = this.items.findIndex(item => item.task.id === taskId);
    if (index !== -1) {
      this.items.splice(index, 1);
      return true;
    }
    return false;
  }

  getAll(): Task[] {
    return this.items.map(item => item.task);
  }
}

/**
 * Lane Configuration
 */
export interface LaneConfig {
  name: string;
  priority: number;
  maxConcurrency: number;
  timeout: number;
  retryPolicy: RetryPolicy;
  description: string;
}

/**
 * Lane Queue for managing tasks with specific priority and concurrency limits
 */
export class LaneQueue {
  private queue: PriorityQueue = new PriorityQueue();
  private runningTasks: Set<string> = new Set();
  private config: LaneConfig;

  constructor(config: LaneConfig) {
    this.config = config;
    logger.info({ lane: config.name, priority: config.priority, maxConcurrency: config.maxConcurrency },
      'Lane queue created');
  }

  /**
   * Add a task to this lane
   */
  enqueue(task: Task): void {
    this.queue.enqueue(task, this.config.priority);
    logger.debug({ lane: this.config.name, taskId: task.id, queueSize: this.queue.size() },
      'Task enqueued');
  }

  /**
   * Get the next task to execute
   */
  getNext(): Task | null {
    // Check if we can execute more tasks
    if (this.runningTasks.size >= this.config.maxConcurrency) {
      return null;
    }

    return this.queue.dequeue();
  }

  /**
   * Mark a task as started
   */
  markStarted(taskId: string): void {
    this.runningTasks.add(taskId);
    logger.debug({ lane: this.config.name, taskId, runningCount: this.runningTasks.size },
      'Task marked as started');
  }

  /**
   * Mark a task as completed
   */
  markCompleted(taskId: string): void {
    this.runningTasks.delete(taskId);
    logger.debug({ lane: this.config.name, taskId, runningCount: this.runningTasks.size },
      'Task marked as completed');
  }

  /**
   * Get lane statistics
   */
  getStats(): {
    name: string;
    queued: number;
    running: number;
    maxConcurrency: number;
    canExecuteMore: boolean;
  } {
    return {
      name: this.config.name,
      queued: this.queue.size(),
      running: this.runningTasks.size,
      maxConcurrency: this.config.maxConcurrency,
      canExecuteMore: this.runningTasks.size < this.config.maxConcurrency,
    };
  }

  /**
   * Check if lane can accept more tasks
   */
  canExecute(): boolean {
    return this.runningTasks.size < this.config.maxConcurrency;
  }

  /**
   * Get all queued tasks
   */
  getQueuedTasks(): Task[] {
    return this.queue.getAll();
  }

  /**
   * Remove a task from the queue
   */
  removeTask(taskId: string): boolean {
    return this.queue.remove(taskId);
  }
}

/**
 * Lane Queue Manager - manages multiple lanes
 */
export class LaneQueueManager {
  private lanes: Map<string, LaneQueue> = new Map();
  private taskToLane: Map<string, string> = new Map(); // Track which lane a task belongs to

  constructor() {
    this.initializeDefaultLanes();
  }

  /**
   * Initialize default lane configurations
   */
  private initializeDefaultLanes(): void {
    // Critical lane - highest priority, low concurrency
    this.registerLane({
      name: 'critical',
      priority: 0,
      maxConcurrency: 2,
      timeout: 60000, // 1 minute
      retryPolicy: {
        maxAttempts: 5,
        strategy: 'exponential',
        timeout: 60000,
        baseDelay: 1000,
      },
      description: 'Critical tasks requiring immediate attention',
    });

    // High priority lane
    this.registerLane({
      name: 'high',
      priority: 3,
      maxConcurrency: 5,
      timeout: 120000, // 2 minutes
      retryPolicy: {
        maxAttempts: 3,
        strategy: 'exponential',
        timeout: 120000,
        baseDelay: 2000,
      },
      description: 'High priority tasks',
    });

    // Normal priority lane
    this.registerLane({
      name: 'normal',
      priority: 5,
      maxConcurrency: 10,
      timeout: 300000, // 5 minutes
      retryPolicy: {
        maxAttempts: 3,
        strategy: 'linear',
        timeout: 300000,
        baseDelay: 5000,
      },
      description: 'Normal priority tasks',
    });

    // Low priority lane
    this.registerLane({
      name: 'low',
      priority: 8,
      maxConcurrency: 15,
      timeout: 600000, // 10 minutes
      retryPolicy: {
        maxAttempts: 2,
        strategy: 'linear',
        timeout: 600000,
        baseDelay: 10000,
      },
      description: 'Low priority background tasks',
    });

    logger.info('Default lane queues initialized');
  }

  /**
   * Register a custom lane
   */
  registerLane(config: LaneConfig): void {
    const lane = new LaneQueue(config);
    this.lanes.set(config.name, lane);
    logger.info({ lane: config.name, ...config }, 'Lane registered');
  }

  /**
   * Enqueue a task to the appropriate lane
   */
  enqueue(task: Task): void {
    const laneName = task.lane || this.determineLaneForTask(task);
    const lane = this.lanes.get(laneName);

    if (!lane) {
      logger.warn({ taskId: task.id, lane: laneName }, 'Lane not found, using normal lane');
      this.lanes.get('normal')?.enqueue(task);
      this.taskToLane.set(task.id, 'normal');
    } else {
      lane.enqueue(task);
      this.taskToLane.set(task.id, laneName);
    }
  }

  /**
   * Determine which lane a task should belong to
   */
  private determineLaneForTask(task: Task): string {
    // Use task priority if specified
    if (task.priority !== undefined) {
      if (task.priority <= 2) return 'critical';
      if (task.priority <= 4) return 'high';
      if (task.priority <= 7) return 'normal';
      return 'low';
    }

    // Determine based on task characteristics
    const isUrgent = task.name.includes('urgent') || task.name.includes('critical') ||
                     task.description.includes('urgent') || task.description.includes('critical');
    const isBackground = task.name.includes('background') || task.name.includes('batch') ||
                         task.description.includes('background');

    if (isUrgent) return 'critical';
    if (isBackground) return 'low';
    return 'normal';
  }

  /**
   * Get the next task to execute across all lanes
   */
  getNextTask(): { task: Task | null; lane: string | null } {
    // Check lanes in priority order
    const laneOrder = ['critical', 'high', 'normal', 'low'];

    for (const laneName of laneOrder) {
      const lane = this.lanes.get(laneName);
      if (lane && lane.canExecute()) {
        const task = lane.getNext();
        if (task) {
          return { task, lane: laneName };
        }
      }
    }

    return { task: null, lane: null };
  }

  /**
   * Mark a task as started
   */
  markTaskStarted(taskId: string): void {
    const laneName = this.taskToLane.get(taskId);
    if (laneName) {
      const lane = this.lanes.get(laneName);
      lane?.markStarted(taskId);
    }
  }

  /**
   * Mark a task as completed
   */
  markTaskCompleted(taskId: string): void {
    const laneName = this.taskToLane.get(taskId);
    if (laneName) {
      const lane = this.lanes.get(laneName);
      lane?.markCompleted(taskId);
    }
  }

  /**
   * Get overall statistics
   */
  getStats(): Array<ReturnType<LaneQueue['getStats']>> {
    const stats: Array<ReturnType<LaneQueue['getStats']>> = [];
    for (const lane of this.lanes.values()) {
      stats.push(lane.getStats());
    }
    return stats;
  }

  /**
   * Get configuration for a specific lane
   */
  getLaneConfig(laneName: string): LaneConfig | undefined {
    const lane = this.lanes.get(laneName);
    if (lane) {
      return {
        name: laneName,
        priority: 0, // Would need to store this in LaneQueue
        maxConcurrency: lane.getStats().maxConcurrency,
        timeout: 0,
        retryPolicy: {
          maxAttempts: 3,
          strategy: 'linear',
          timeout: 300000,
        },
        description: '',
      };
    }
    return undefined;
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const laneName = this.taskToLane.get(taskId);
    if (laneName) {
      const lane = this.lanes.get(laneName);
      if (lane) {
        // First try to remove from queue
        if (lane.removeTask(taskId)) {
          this.taskToLane.delete(taskId);
          return true;
        }
        // If not in queue, mark as completed to free up slot
        lane.markCompleted(taskId);
        this.taskToLane.delete(taskId);
        return true;
      }
    }
    return false;
  }

  /**
   * Get all queued tasks across all lanes
   */
  getAllQueuedTasks(): Map<string, Task[]> {
    const tasks = new Map<string, Task[]>();
    for (const [name, lane] of this.lanes.entries()) {
      tasks.set(name, lane.getQueuedTasks());
    }
    return tasks;
  }
}

// Singleton instance
let laneQueueManager: LaneQueueManager | null = null;

export function getLaneQueueManager(): LaneQueueManager {
  if (!laneQueueManager) {
    laneQueueManager = new LaneQueueManager();
  }
  return laneQueueManager;
}
