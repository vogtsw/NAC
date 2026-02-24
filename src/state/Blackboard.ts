/**
 * Shared Blackboard
 * Redis-backed distributed state management for agent coordination
 */

import Redis from 'ioredis';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('Blackboard');

export interface TaskState {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  agentType?: string;
  result?: any;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SessionState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  intent?: any;
  dag?: any;
  tasks: Map<string, TaskState>;
  artifacts: any[];
  metrics: {
    totalTasks: number;
    completedTasks: number;
    criticalSteps: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Blackboard - Shared state management using Redis
 */
export class Blackboard {
  private redis: Redis;
  private publisher: Redis;
  private subscriber: Redis;

  constructor(redisUrl: string = 'redis://localhost:6379') {
    this.redis = new Redis(redisUrl, { retryStrategy: () => 2000 });
    this.publisher = new Redis(redisUrl, { retryStrategy: () => 2000 });
    this.subscriber = new Redis(redisUrl, { retryStrategy: () => 2000 });

    this.redis.on('error', (err) => logger.error({ error: err }, 'Redis error'));
    this.publisher.on('error', (err) => logger.error({ error: err }, 'Redis publisher error'));
    this.subscriber.on('error', (err) => logger.error({ error: err }, 'Redis subscriber error'));

    logger.info({ redisUrl }, 'Blackboard initialized');
  }

  /**
   * Initialize connections
   */
  async initialize(): Promise<void> {
    try {
      await Promise.all([
        this.redis.ping(),
        this.publisher.ping(),
        this.subscriber.ping(),
      ]);
      logger.info('Blackboard connections established');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to connect to Redis');
      throw error;
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await Promise.all([
      this.redis.quit(),
      this.publisher.quit(),
      this.subscriber.quit(),
    ]);
    logger.info('Blackboard connections closed');
  }

  /**
   * Create a new session
   */
  async createSession(sessionId: string, initialState: any = {}): Promise<SessionState> {
    const state: SessionState = {
      sessionId,
      status: 'running',
      tasks: new Map(),
      artifacts: [],
      metrics: {
        totalTasks: 0,
        completedTasks: 0,
        criticalSteps: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      ...initialState,
    };

    await this.saveState(state);
    await this.publishEvent('session.created', { sessionId });

    logger.info({ sessionId }, 'Session created');
    return state;
  }

  /**
   * Get session state
   */
  async getState(sessionId: string): Promise<SessionState | null> {
    const data = await this.redis.hget('nexus:sessions', sessionId);
    if (!data) return null;
    return this.parseState(data);
  }

  /**
   * Get state by task ID
   */
  async getStateByTask(taskId: string): Promise<SessionState | null> {
    const sessionIds = await this.redis.hkeys('nexus:sessions');

    for (const sessionId of sessionIds) {
      const data = await this.redis.hget('nexus:sessions', sessionId);
      if (data) {
        const state = this.parseState(data);
        if (state.tasks.has(taskId)) {
          return state;
        }
      }
    }

    return null;
  }

  /**
   * Get all session IDs
   */
  async getAllSessions(): Promise<string[]> {
    return await this.redis.hkeys('nexus:sessions');
  }

  /**
   * Update task status
   */
  async updateTaskStatus(
    sessionId: string,
    taskId: string,
    status: TaskState['status']
  ): Promise<void> {
    const state = await this.getState(sessionId);
    if (!state) return;

    if (!state.tasks.has(taskId)) {
      state.tasks.set(taskId, { taskId, status });
    } else {
      const task = state.tasks.get(taskId)!;
      task.status = status;
      if (status === 'running' && !task.startedAt) {
        task.startedAt = new Date();
      }
      if (status === 'completed' || status === 'failed') {
        task.completedAt = new Date();
      }
    }

    await this.saveState(state);
    await this.publishEvent('task.updated', { sessionId, taskId, status });
  }

  /**
   * Record task result
   */
  async recordTaskResult(
    sessionId: string,
    taskId: string,
    result: any
  ): Promise<void> {
    const state = await this.getState(sessionId);
    if (!state) return;

    state.metrics.completedTasks++;

    if (state.tasks.has(taskId)) {
      const task = state.tasks.get(taskId)!;
      task.result = result;
    }

    await this.saveState(state);
    await this.publishEvent('task.completed', { sessionId, taskId, result });

    logger.debug({ sessionId, taskId }, 'Task result recorded');
  }

  /**
   * Delete session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.hdel('nexus:sessions', sessionId);
    await this.publishEvent('session.deleted', { sessionId });
    logger.info({ sessionId }, 'Session deleted');
  }

  /**
   * Save state to Redis
   */
  private async saveState(state: SessionState): Promise<void> {
    state.updatedAt = new Date();

    // Convert Map to object for JSON serialization
    const serialized = {
      ...state,
      tasks: Object.fromEntries(state.tasks),
    };

    await this.redis.hset('nexus:sessions', state.sessionId, JSON.stringify(serialized));
  }

  /**
   * Parse state from Redis
   */
  private parseState(data: string): SessionState {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      tasks: new Map(Object.entries(parsed.tasks || {}).map(([k, v]: [string, any]) => [k, v])),
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  /**
   * Publish event to Redis
   */
  private async publishEvent(event: string, data: any): Promise<void> {
    await this.publisher.publish('nexus:events', JSON.stringify({ event, data }));
  }

  /**
   * Subscribe to events
   */
  async subscribe(callback: (event: string, data: any) => void): Promise<void> {
    await this.subscriber.subscribe('nexus:events');

    this.subscriber.on('message', (channel, message) => {
      if (channel === 'nexus:events') {
        try {
          const { event, data } = JSON.parse(message);
          callback(event, data);
        } catch (error: any) {
          logger.error({ error, message }, 'Failed to parse event message');
        }
      }
    });

    logger.info('Subscribed to events');
  }
}

/**
 * Factory function to create Blackboard from config
 */
export function createBlackboard(): Blackboard {
  const config = loadConfig();
  return new Blackboard(config.storage.redisUrl);
}

// Singleton instance
let blackboard: Blackboard | null = null;

export function getBlackboard(): Blackboard {
  if (!blackboard) {
    blackboard = createBlackboard();
  }
  return blackboard;
}
