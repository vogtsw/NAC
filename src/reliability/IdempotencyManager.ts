/**
 * Idempotency Manager
 * Ensures operations are executed only once and results are cached
 * Prevents duplicate execution and provides result caching
 */

import { createHash } from 'crypto';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('IdempotencyManager');

/**
 * Cached result metadata
 */
interface CachedResult {
  result: any;
  timestamp: number;
  ttl: number;
  executionTime?: number; // Time taken to execute (ms)
}

/**
 * Idempotency check result
 */
export interface IdempotencyCheckResult {
  allowed: boolean;
  cachedResult?: any;
  key: string;
  reason?: string;
}

/**
 * Idempotency Manager - handles deduplication and caching
 */
export class IdempotencyManager {
  private memoryCache: Map<string, CachedResult> = new Map();
  private executingKeys: Set<string> = new Set(); // Track currently executing keys
  private defaultTTL: number = 3600000; // 1 hour default TTL

  constructor(defaultTTL?: number) {
    if (defaultTTL) {
      this.defaultTTL = defaultTTL;
    }

    // Start cleanup interval
    this.startCleanupInterval();

    logger.info({ defaultTTL: this.defaultTTL }, 'IdempotencyManager initialized');
  }

  /**
   * Generate an idempotency key for a task
   */
  generateIdempotencyKey(sessionId: string, taskName: string, parameters: any): string {
    // Create a hash based on session, task name, and parameters
    const hash = this.hashContent({
      sessionId,
      taskName,
      parameters,
    });

    return `idempotency:${sessionId}:${taskName}:${hash}`;
  }

  /**
   * Generate idempotency key from content
   */
  private hashContent(content: any): string {
    const contentStr = JSON.stringify(content, Object.keys(content).sort());
    return createHash('sha256').update(contentStr).digest('hex').substring(0, 16);
  }

  /**
   * Check if an operation can proceed based on idempotency
   */
  async checkAndRecord(
    key: string,
    ttl?: number
  ): Promise<IdempotencyCheckResult> {
    const cacheTTL = ttl || this.defaultTTL;

    // Check if currently executing (in-flight deduplication)
    if (this.executingKeys.has(key)) {
      logger.debug({ key }, 'Operation currently executing, blocking duplicate');
      return {
        allowed: false,
        key,
        reason: 'Operation currently in-flight',
      };
    }

    // Check cache for existing result
    const cached = this.memoryCache.get(key);
    if (cached) {
      // Check if cache is still valid
      const now = Date.now();
      if (now - cached.timestamp < cached.ttl) {
        logger.debug({
          key,
          age: now - cached.timestamp,
          ttl: cached.ttl,
        }, 'Returning cached result');
        return {
          allowed: false,
          cachedResult: cached.result,
          key,
          reason: 'Result cached',
        };
      } else {
        // Cache expired, remove it
        this.memoryCache.delete(key);
        logger.debug({ key }, 'Expired cache entry removed');
      }
    }

    // Mark as executing
    this.executingKeys.add(key);

    logger.debug({ key, ttl: cacheTTL }, 'Operation allowed, marked as executing');
    return {
      allowed: true,
      key,
    };
  }

  /**
   * Record the result of an operation
   */
  recordResult(
    key: string,
    result: any,
    ttl?: number,
    executionTime?: number
  ): void {
    const cacheTTL = ttl || this.defaultTTL;

    // Remove from executing set
    this.executingKeys.delete(key);

    // Store in cache
    this.memoryCache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: cacheTTL,
      executionTime,
    });

    logger.debug({
      key,
      ttl: cacheTTL,
      executionTime,
      cacheSize: this.memoryCache.size,
    }, 'Result cached');
  }

  /**
   * Mark an operation as failed (remove from executing without caching)
   */
  markFailed(key: string, error?: Error): void {
    this.executingKeys.delete(key);
    logger.debug({ key, error: error?.message }, 'Operation marked as failed');
  }

  /**
   * Get cached result if exists
   */
  getCachedResult(key: string): any | null {
    const cached = this.memoryCache.get(key);
    if (!cached) {
      return null;
    }

    // Check if still valid
    const now = Date.now();
    if (now - cached.timestamp >= cached.ttl) {
      this.memoryCache.delete(key);
      return null;
    }

    return cached.result;
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(key: string): boolean {
    const deleted = this.memoryCache.delete(key);
    if (deleted) {
      logger.debug({ key }, 'Cache entry invalidated');
    }
    return deleted;
  }

  /**
   * Invalidate all cache entries for a session
   */
  invalidateSession(sessionId: string): number {
    let count = 0;
    const prefix = `idempotency:${sessionId}:`;

    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(prefix)) {
        this.memoryCache.delete(key);
        count++;
      }
    }

    logger.info({ sessionId, count }, 'Session cache invalidated');
    return count;
  }

  /**
   * Clear all cache entries
   */
  clear(): number {
    const count = this.memoryCache.size;
    this.memoryCache.clear();
    this.executingKeys.clear();

    logger.info({ count }, 'All cache cleared');
    return count;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    cacheSize: number;
    executingCount: number;
    hitRate?: number;
  } {
    return {
      cacheSize: this.memoryCache.size,
      executingCount: this.executingKeys.size,
    };
  }

  /**
   * Start cleanup interval to remove expired entries
   */
  private startCleanupInterval(): void {
    // Run cleanup every 5 minutes
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 300000); // 5 minutes

    logger.info('Cleanup interval started');
  }

  /**
   * Remove expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of this.memoryCache.entries()) {
      if (now - value.timestamp >= value.ttl) {
        this.memoryCache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug({ cleaned, remaining: this.memoryCache.size }, 'Expired cache entries cleaned');
    }
  }

  /**
   * Execute an operation with idempotency guarantees
   */
  async executeWithIdempotency<T>(
    sessionId: string,
    taskName: string,
    parameters: any,
    operation: () => Promise<T>,
    ttl?: number
  ): Promise<{ result: T; fromCache: boolean }> {
    const key = this.generateIdempotencyKey(sessionId, taskName, parameters);

    // Check if we should execute or use cache
    const check = await this.checkAndRecord(key, ttl);

    if (!check.allowed && check.cachedResult !== undefined) {
      // Return cached result
      return {
        result: check.cachedResult as T,
        fromCache: true,
      };
    }

    // Execute the operation
    const startTime = Date.now();
    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;

      // Cache the result
      this.recordResult(key, result, ttl, executionTime);

      return {
        result,
        fromCache: false,
      };
    } catch (error) {
      // Mark as failed
      this.markFailed(key, error as Error);
      throw error;
    }
  }
}

// Singleton instance
let idempotencyManager: IdempotencyManager | null = null;

export function getIdempotencyManager(): IdempotencyManager {
  if (!idempotencyManager) {
    idempotencyManager = new IdempotencyManager();
  }
  return idempotencyManager;
}

/**
 * Decorator function to add idempotency to any async function
 */
export function withIdempotency<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  getKey: (...args: Parameters<T>) => string,
  ttl?: number
): T {
  return (async (...args: Parameters<T>) => {
    const manager = getIdempotencyManager();
    const key = getKey(...args);

    const check = await manager.checkAndRecord(key, ttl);
    if (!check.allowed && check.cachedResult !== undefined) {
      return check.cachedResult;
    }

    try {
      const result = await fn(...args);
      manager.recordResult(key, result, ttl);
      return result;
    } catch (error) {
      manager.markFailed(key, error as Error);
      throw error;
    }
  }) as T;
}
