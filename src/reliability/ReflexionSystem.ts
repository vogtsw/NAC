/**
 * Reflexion System
 * Retry task execution with validation feedback loops.
 */

import { OutputValidator, ValidationResult } from './OutputValidator.js';

export interface ExecutionAttempt {
  attemptNumber: number;
  agent: string;
  input: string;
  output: string;
  validation: ValidationResult;
  timestamp: number;
  duration: number;
}

export interface ReflexionConfig {
  maxAttempts?: number;
}

export interface ReflexionExecutionResult<T = any> {
  output: string;
  value: T;
  validation: ValidationResult;
  attempts: ExecutionAttempt[];
}

export class ReflexionSystem {
  private validator: OutputValidator;
  private maxAttempts: number;
  private attempts: Map<string, ExecutionAttempt[]> = new Map();

  constructor(config: ReflexionConfig = {}, validator?: OutputValidator) {
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 2);
    this.validator = validator ?? new OutputValidator();
  }

  async executeWithReflexion<T>(
    taskId: string,
    userIntent: string,
    agent: string,
    executeFn: (attempt: number, previousValidation?: ValidationResult) => Promise<{ output: string; value: T }>,
    context?: Record<string, any>
  ): Promise<ReflexionExecutionResult<T>> {
    const attempts: ExecutionAttempt[] = [];
    let lastValidation: ValidationResult | undefined;
    let lastOutput = '';
    let lastValue: T | undefined;

    for (let i = 1; i <= this.maxAttempts; i++) {
      const startAt = Date.now();
      const { output, value } = await executeFn(i, lastValidation);
      const validation = await this.validator.validate(userIntent, output, context);
      const duration = Date.now() - startAt;

      attempts.push({
        attemptNumber: i,
        agent,
        input: userIntent,
        output,
        validation,
        timestamp: Date.now(),
        duration,
      });

      lastOutput = output;
      lastValue = value;
      lastValidation = validation;

      if (validation.isValid) {
        this.attempts.set(taskId, attempts);
        return {
          output,
          value,
          validation,
          attempts,
        };
      }
    }

    this.attempts.set(taskId, attempts);
    return {
      output: lastOutput,
      value: lastValue as T,
      validation: lastValidation as ValidationResult,
      attempts,
    };
  }

  getExecutionHistory(taskId: string): ExecutionAttempt[] {
    return this.attempts.get(taskId) || [];
  }
}

