/**
 * Event Bus
 * In-process and distributed event handling
 */

import { EventEmitter } from 'events';
import { getBlackboard } from './Blackboard.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('EventBus');

export enum EventType {
  SESSION_CREATED = 'session.created',
  SESSION_UPDATED = 'session.updated',
  SESSION_DELETED = 'session.deleted',
  SESSION_COMPLETED = 'session.completed',
  SESSION_FAILED = 'session.failed',
  TASK_CREATED = 'task.created',
  TASK_UPDATED = 'task.updated',
  TASK_COMPLETED = 'task.completed',
  TASK_FAILED = 'task.failed',
  AGENT_CREATED = 'agent.created',
  AGENT_UPDATED = 'agent.updated',
  AGENT_DELETED = 'agent.deleted',
  LOG_CREATED = 'log.created',
  ERROR_OCCURRED = 'error.occurred',
}

/**
 * Event Bus - Local and distributed event handling
 */
export class EventBus extends EventEmitter {
  private blackboardSubscription: boolean = false;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /**
   * Initialize distributed event handling
   */
  async initialize(): Promise<void> {
    if (this.blackboardSubscription) return;

    const blackboard = getBlackboard();
    await blackboard.subscribe((event: string, data: any) => {
      logger.debug({ event, data }, 'Received distributed event');
      this.emit(event, data);
    });

    this.blackboardSubscription = true;
    logger.info('EventBus initialized with distributed events');
  }

  /**
   * Publish event locally and to Redis
   */
  async publish(eventType: EventType, data: any): Promise<void> {
    // Emit locally first
    this.emit(eventType, data);

    // Also publish via blackboard for distributed scenarios
    const blackboard = getBlackboard();
    await blackboard.publishEvent(eventType, data);

    logger.debug({ event: eventType, data }, 'Event published');
  }

  /**
   * Subscribe to specific event type
   */
  on(eventType: EventType, listener: (data: any) => void): this {
    return super.on(eventType, listener);
  }

  /**
   * Subscribe to event once
   */
  once(eventType: EventType, listener: (data: any) => void): this {
    return super.once(eventType, listener);
  }

  /**
   * Unsubscribe from event
   */
  off(eventType: EventType, listener: (data: any) => void): this {
    return super.off(eventType, listener);
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(eventType?: EventType): this {
    return super.removeAllListeners(eventType);
  }
}

// Singleton instance
let eventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!eventBus) {
    eventBus = new EventBus();
  }
  return eventBus;
}

export function createEventBus(): EventBus {
  return new EventBus();
}
