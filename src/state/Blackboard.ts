/**
 * Shared Blackboard
 * Redis-backed distributed state management for agent coordination
 * Falls back to in-memory mode when Redis is not available
 */

import Redis from 'ioredis';
import { loadConfig } from '../config/index.js';
import { getLogger } from '../monitoring/logger.js';
import { EventEmitter } from 'events';

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
 * Blackboard - Shared state management using Redis or in-memory
 */
export class Blackboard {
  private redis: Redis | null;
  private publisher: Redis | null;
  private subscriber: Redis | null;
  private memorySessions: Map<string, SessionState>;
  private memoryEvents: EventEmitter;
  private useMemory: boolean = false;

  constructor(redisUrl: string = 'redis://localhost:6379') {
    this.memorySessions = new Map();
    this.memoryEvents = new EventEmitter();

    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        if (times > 3) {
          return null;
        }
        return 2000;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });
    this.publisher = new Redis(redisUrl, {
      retryStrategy: (times) => times > 3 ? null : 2000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });
    this.subscriber = new Redis(redisUrl, {
      retryStrategy: (times) => times > 3 ? null : 2000,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });

    this.redis.on('error', (err) => {
      if (err.message.includes('ECONNREFUSED')) {
        this.switchToMemoryMode();
      }
    });
    this.publisher.on('error', (err) => {
      if (err.message.includes('ECONNREFUSED')) {
        this.switchToMemoryMode();
      }
    });
    this.subscriber.on('error', (err) => {
      if (err.message.includes('ECONNREFUSED')) {
        this.switchToMemoryMode();
      }
    });

    logger.info({ redisUrl }, 'Blackboard initialized');
  }

  private switchToMemoryMode() {
    if (this.useMemory) return;

    this.useMemory = true;

    if (this.redis) { this.redis.disconnect(); }
    if (this.publisher) { this.publisher.disconnect(); }
    if (this.subscriber) { this.subscriber.disconnect(); }

    this.redis = null;
    this.publisher = null;
    this.subscriber = null;

    logger.info('Blackboard switched to in-memory mode');
  }

  async initialize(): Promise<void> {
    if (this.useMemory) return;

    try {
      await Promise.all([
        this.redis?.ping(),
        this.publisher?.ping(),
        this.subscriber?.ping(),
      ]);
      logger.info('Blackboard connections established');
    } catch {
      this.switchToMemoryMode();
    }
  }

  async close(): Promise<void> {
    if (!this.useMemory) {
      await Promise.all([
        this.redis?.quit(),
        this.publisher?.quit(),
        this.subscriber?.quit(),
      ]);
    }
    this.memorySessions.clear();
    this.memoryEvents.removeAllListeners();
    logger.info('Blackboard connections closed');
  }

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

  async getState(sessionId: string): Promise<SessionState | null> {
    if (this.useMemory) {
      return this.memorySessions.get(sessionId) || null;
    }

    const data = await this.redis?.hget('nexus:sessions', sessionId);
    if (!data) return null;
    return this.parseState(data);
  }

  async getStateByTask(taskId: string): Promise<SessionState | null> {
    if (this.useMemory) {
      for (const state of this.memorySessions.values()) {
        if (state.tasks.has(taskId)) {
          return state;
        }
      }
      return null;
    }

    if (!this.redis) return null;

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

  async getAllSessions(): Promise<string[]> {
    if (this.useMemory) {
      return Array.from(this.memorySessions.keys());
    }

    if (!this.redis) return [];
    return await this.redis.hkeys('nexus:sessions');
  }

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

  async deleteSession(sessionId: string): Promise<void> {
    if (this.useMemory) {
      this.memorySessions.delete(sessionId);
    } else {
      await this.redis?.hdel('nexus:sessions', sessionId);
    }
    await this.publishEvent('session.deleted', { sessionId });
    logger.info({ sessionId }, 'Session deleted');
  }

  private async saveState(state: SessionState): Promise<void> {
    state.updatedAt = new Date();

    if (this.useMemory) {
      this.memorySessions.set(state.sessionId, state);
      return;
    }

    if (!this.redis) return;

    const serialized = {
      ...state,
      tasks: Object.fromEntries(state.tasks),
    };

    await this.redis.hset('nexus:sessions', state.sessionId, JSON.stringify(serialized));
  }

  private parseState(data: string): SessionState {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      tasks: new Map(Object.entries(parsed.tasks || {}).map(([k, v]: [string, any]) => [k, v])),
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
    };
  }

  private async publishEvent(event: string, data: any): Promise<void> {
    if (this.useMemory) {
      this.memoryEvents.emit('event', { event, data });
      return;
    }

    if (!this.publisher) return;
    await this.publisher.publish('nexus:events', JSON.stringify({ event, data }));
  }

  async subscribe(callback: (event: string, data: any) => void): Promise<void> {
    if (this.useMemory) {
      this.memoryEvents.on('event', ({ event, data }) => callback(event, data));
      logger.info('Subscribed to in-memory events');
      return;
    }

    if (!this.subscriber) return;

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

    logger.info('Subscribed to Redis events');
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
