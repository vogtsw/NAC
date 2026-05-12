/**
 * A generic retry utility class that retries an async function with exponential backoff.
 */
class RetryHelper {
  private readonly retryCount: number;
  private readonly delayMs: number;

  /**
   * @param retryCount - Maximum number of retry attempts.
   * @param delayMs    - Base delay in milliseconds before the first retry.
   */
  constructor(retryCount: number, delayMs: number) {
    this.retryCount = retryCount;
    this.delayMs = delayMs;
  }

  /**
   * Executes an async function with retry logic and exponential backoff.
   *
   * @param fn - The async function to execute.
   * @returns A promise resolving to the function's return value.
   * @throws The last encountered error if all retries are exhausted.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < this.retryCount) {
          const backoffDelay = this.delayMs * Math.pow(2, attempt);
          await this.sleep(backoffDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Sleeps for the given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default RetryHelper;
