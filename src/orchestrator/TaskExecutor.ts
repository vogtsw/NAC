/**
 * TaskExecutor
 * Execute tasks with validation and reflexion retries.
 */

import { AgentFactory } from '../agents/AgentFactory.js';
import { getLogger } from '../monitoring/logger.js';
import { Task } from '../state/models.js';
import { getBlackboard } from '../state/Blackboard.js';
import { OutputValidator, ValidationResult } from '../reliability/OutputValidator.js';
import { ReflexionSystem, ExecutionAttempt } from '../reliability/ReflexionSystem.js';

const logger = getLogger('TaskExecutor');

export interface TaskExecutorContext {
  agentFactory: AgentFactory;
  sessionId: string;
  userIntent?: string;
}

export interface TaskExecutionResult {
  taskId: string;
  result: any;
  duration: number;
  validationPassed: boolean;
  validationScore: number;
  attempts: ExecutionAttempt[];
}

export interface TaskExecutorConfig {
  enableOutputValidation?: boolean;
  enableReflexion?: boolean;
  minQualityScore?: number;
  maxReflexionAttempts?: number;
}

export class TaskExecutor {
  private validator: OutputValidator;
  private reflexion: ReflexionSystem;
  private config: Required<TaskExecutorConfig>;

  constructor(config: TaskExecutorConfig = {}) {
    this.config = {
      enableOutputValidation: config.enableOutputValidation ?? true,
      enableReflexion: config.enableReflexion ?? true,
      minQualityScore: config.minQualityScore ?? 60,
      maxReflexionAttempts: Math.max(1, config.maxReflexionAttempts ?? 2),
    };
    this.validator = new OutputValidator({
      minQualityScore: this.config.minQualityScore,
    });
    this.reflexion = new ReflexionSystem(
      { maxAttempts: this.config.maxReflexionAttempts },
      this.validator
    );
  }

  async executeWithValidation(task: Task, context: TaskExecutorContext): Promise<TaskExecutionResult> {
    const blackboard = getBlackboard();
    const startTime = Date.now();
    const userIntent = context.userIntent || task.description || task.name;

    await blackboard.updateTaskStatus(context.sessionId, task.id, 'running', {
      agentType: task.agentType,
      requiredSkills: task.requiredSkills || [],
      taskName: task.name,
    });

    try {
      const execution = this.config.enableReflexion
        ? await this.reflexion.executeWithReflexion(
            task.id,
            userIntent,
            task.agentType,
            async (attempt, previousValidation) => {
              const rawResult = await this.executeOnce(
                this.buildTaskAttempt(task, attempt, previousValidation),
                context
              );
              return {
                output: this.extractOutputText(rawResult),
                value: rawResult,
              };
            },
            { taskId: task.id, sessionId: context.sessionId }
          )
        : await this.executeSingleAttempt(task, context, userIntent);

      if (this.config.enableOutputValidation && !execution.validation.isValid) {
        throw new Error(
          `Validation failed (score=${execution.validation.score}): ${execution.validation.issues.join('; ')}`
        );
      }

      const duration = Date.now() - startTime;
      await blackboard.updateTaskStatus(context.sessionId, task.id, 'completed', {
        agentType: task.agentType,
        requiredSkills: task.requiredSkills || [],
        taskName: task.name,
        duration,
      });
      await blackboard.recordTaskResult(context.sessionId, task.id, execution.value, {
        agentType: task.agentType,
        requiredSkills: task.requiredSkills || [],
        taskName: task.name,
        duration,
      });

      logger.info(
        {
          taskId: task.id,
          duration,
          validationScore: execution.validation.score,
          attempts: execution.attempts.length,
        },
        'Task executed with TaskExecutor'
      );

      return {
        taskId: task.id,
        result: execution.value,
        duration,
        validationPassed: execution.validation.isValid,
        validationScore: execution.validation.score,
        attempts: execution.attempts,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      await blackboard.updateTaskStatus(context.sessionId, task.id, 'failed', {
        agentType: task.agentType,
        requiredSkills: task.requiredSkills || [],
        taskName: task.name,
        error: error.message,
        duration,
      });
      throw error;
    }
  }

  private async executeSingleAttempt(
    task: Task,
    context: TaskExecutorContext,
    userIntent: string
  ): Promise<{
    output: string;
    value: any;
    validation: ValidationResult;
    attempts: ExecutionAttempt[];
  }> {
    const rawResult = await this.executeOnce(task, context);
    const output = this.extractOutputText(rawResult);
    const validation = this.config.enableOutputValidation
      ? await this.validator.validate(userIntent, output, { taskId: task.id, sessionId: context.sessionId })
      : { isValid: true, score: 100, issues: [], suggestions: [], shouldRetry: false };

    return {
      output,
      value: rawResult,
      validation,
      attempts: [
        {
          attemptNumber: 1,
          agent: task.agentType,
          input: userIntent,
          output,
          validation,
          timestamp: Date.now(),
          duration: 0,
        },
      ],
    };
  }

  private buildTaskAttempt(task: Task, attempt: number, previousValidation?: ValidationResult): Task {
    if (attempt <= 1 || !previousValidation) return task;

    const retryHint = previousValidation.suggestions.length > 0
      ? previousValidation.suggestions.join('; ')
      : previousValidation.issues.join('; ');

    return {
      ...task,
      description: `${task.description}\n\n[Retry attempt ${attempt} guidance]\n${retryHint}`,
    };
  }

  private async executeOnce(task: Task, context: TaskExecutorContext): Promise<any> {
    const agent = await context.agentFactory.create(task.agentType, {
      taskId: task.id,
      skills: task.requiredSkills || [],
    });
    return await agent.execute(task);
  }

  private extractOutputText(result: any): string {
    if (typeof result === 'string') return result;
    if (result?.response && typeof result.response === 'string') return result.response;
    if (result?.result && typeof result.result === 'string') return result.result;
    if (result?.analysis && typeof result.analysis === 'string') return result.analysis;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }
}

