/**
 * Retry Manager
 * Handles automatic retry logic with various backoff strategies
 * Improves system reliability by recovering from transient failures
 */

import { RetryPolicy } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('RetryManager');

/**
 * Custom error for retry exhaustion
 */
export class RetryExhaustedError extends Error {
  constructor(message: string, public readonly lastError: Error) {
    super(message);
    this.name = 'RetryExhaustedError';
  }
}

/**
 * Default retry policies
 */
export const DEFAULT_RETRY_POLICIES = {
  // Exponential backoff for network/LLM issues
  exponential: {
    maxAttempts: 3,
    strategy: 'exponential' as const,
    timeout: 30000, // 30 seconds
    baseDelay: 1000, // 1 second base
  },
  // Linear backoff for less critical operations
  linear: {
    maxAttempts: 3,
    strategy: 'linear' as const,
    timeout: 30000,
    baseDelay: 2000, // 2 second increment
  },
  // Fixed delay for quick retries
  fixed: {
    maxAttempts: 5,
    strategy: 'fixed' as const,
    timeout: 10000,
    baseDelay: 2000, // 2 seconds fixed
  },
  // No retry for critical failures
  none: {
    maxAttempts: 1,
    strategy: 'linear' as const,
    timeout: 5000,
    baseDelay: 0,
  },
};

/**
 * Retry Manager - handles retry logic with backoff strategies
 */
export class RetryManager {
  private static BACKOFF_STRATEGIES = {
    exponential: (attempt: number, baseDelay: number = 1000): number => {
      // Exponential backoff with jitter: baseDelay * 2^attempt + random jitter
      const exponentialDelay = baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 1000; // Add up to 1 second of jitter
      return Math.min(exponentialDelay + jitter, 30000); // Cap at 30 seconds
    },
    linear: (attempt: number, baseDelay: number = 2000): number => {
      // Linear backoff: baseDelay * attempt
      return baseDelay * attempt;
    },
    fixed: (attempt: number, baseDelay: number = 2000): number => {
      // Fixed delay
      return baseDelay;
    },
  };

  /**
   * Execute an operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    policy: RetryPolicy,
    context?: { operationName?: string; taskId?: string }
  ): Promise<T> {
    let lastError: Error | undefined;
    const { operationName = 'operation', taskId } = context || {};

    logger.debug({
      operation: operationName,
      taskId,
      maxAttempts: policy.maxAttempts,
      strategy: policy.strategy,
    }, 'Starting retry execution');

    for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
      try {
        // Execute the operation with timeout
        const result = await this.executeWithTimeout(operation, policy.timeout);

        if (attempt > 0) {
          logger.info({
            operation: operationName,
            taskId,
            attempt: attempt + 1,
            success: true,
          }, 'Operation succeeded after retry');
        }

        return result;
      } catch (error: any) {
        lastError = error;

        // Check if error is retriable
        if (!this.isRetriable(error)) {
          logger.warn({
            operation: operationName,
            taskId,
            error: error.message,
            nonRetriable: true,
          }, 'Non-retriable error encountered');
          throw error;
        }

        // Check if we have more attempts
        if (attempt < policy.maxAttempts - 1) {
          const delay = this.calculateBackoff(policy.strategy, attempt, policy.baseDelay);

          logger.warn({
            operation: operationName,
            taskId,
            attempt: attempt + 1,
            maxAttempts: policy.maxAttempts,
            error: error.message,
            nextRetryIn: delay,
          }, 'Operation failed, scheduling retry');

          await this.sleep(delay);
        } else {
          logger.error({
            operation: operationName,
            taskId,
            attempts: policy.maxAttempts,
            lastError: error.message,
          }, 'Retry attempts exhausted');
        }
      }
    }

    // All retries exhausted
    throw new RetryExhaustedError(
      `${operationName} failed after ${policy.maxAttempts} attempts`,
      lastError || new Error('Unknown error')
    );
  }

  /**
   * Execute an operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeout: number
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Calculate backoff delay based on strategy
   */
  private calculateBackoff(
    strategy: 'exponential' | 'linear' | 'fixed',
    attempt: number,
    baseDelay: number = 1000
  ): number {
    const backoffFn = RetryManager.BACKOFF_STRATEGIES[strategy];
    return backoffFn(attempt, baseDelay);
  }

  /**
   * Check if an error is retriable
   */
  private isRetriable(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.status || error.code;

    // Network-related errors
    const retriablePatterns = [
      'etimedout',
      'econnreset',
      'econnrefused',
      'enotfound',
      'eai_again',
      'socket hang up',
      'connection lost',
      'connection reset',
      'timeout',
      'rate limit',
      'too many requests',
      'service unavailable',
      'gateway timeout',
      'bad gateway',
      'temporarily unavailable',
    ];

    // HTTP status codes that are retriable
    const retriableStatusCodes = [408, 429, 500, 502, 503, 504];

    // Check error message patterns
    const hasRetriablePattern = retriablePatterns.some(pattern =>
      errorMessage.includes(pattern)
    );

    // Check HTTP status codes
    const hasRetriableStatusCode = retriableStatusCodes.includes(errorCode);

    // Check for specific error types
    const isNetworkError = error.code && error.code.startsWith('E');

    return hasRetriablePattern || hasRetriableStatusCode || isNetworkError;
  }

  /**
   * Sleep for a specified duration
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute multiple operations with retry and aggregate results
   */
  async executeAllWithRetry<T>(
    operations: Array<{ operation: () => Promise<T>; context?: string }>,
    policy: RetryPolicy
  ): Promise<Array<{ success: boolean; result?: T; error?: string }>> {
    logger.debug({ count: operations.length }, 'Executing batch operations with retry');

    const results = await Promise.allSettled(
      operations.map(({ operation, context }) =>
        this.executeWithRetry(operation, policy, { operationName: context })
      )
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return { success: true, result: result.value };
      } else {
        return {
          success: false,
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }

  /**
   * Get a default retry policy by name
   */
  static getDefaultPolicy(name: keyof typeof DEFAULT_RETRY_POLICIES): RetryPolicy {
    return DEFAULT_RETRY_POLICIES[name];
  }
}

// Singleton instance
let retryManager: RetryManager | null = null;

export function getRetryManager(): RetryManager {
  if (!retryManager) {
    retryManager = new RetryManager();
  }
  return retryManager;
}

/**
 * Decorator function to add retry logic to any async function
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  policy: RetryPolicy
): T {
  return (async (...args: any[]) => {
    const manager = getRetryManager();
    return manager.executeWithRetry(() => fn(...args), policy, {
      operationName: fn.name,
    });
  }) as T;
}
