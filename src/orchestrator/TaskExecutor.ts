/**
 * 增强的任务执行器 - 集成输出验证和反思系统
 */

import { Task } from '../state/models.js';
import { AgentFactory } from '../agents/AgentFactory.js';
import { getBlackboard } from '../state/Blackboard.js';
import { getEventBus, EventType } from '../state/EventBus.js';
import { getLogger } from '../monitoring/logger.js';
import { OutputValidator } from '../reliability/OutputValidator.js';
import { ReflexionSystem, ExecutionAttempt } from '../reliability/ReflexionSystem.js';
import { fixUnicodeDisplay } from './Scheduler.js';

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
  attempts: ExecutionAttempt[];
}

/**
 * 增强的任务执行器 - 带输出验证和反思
 */
export class TaskExecutor {
  private outputValidator: OutputValidator;
  private reflexionSystem: ReflexionSystem;

  constructor() {
    this.outputValidator = new OutputValidator({
      minQualityScore: 60
    });

    this.reflexionSystem = new ReflexionSystem({
      maxAttempts: 2, // 每个任务最多重试1次（共2次机会）
      enableLearning: true,
      storeFailures: true
    });
  }

  /**
   * 执行任务（带验证和反思）
   */
  async executeWithValidation(
    task: Task,
    context: TaskExecutorContext
  ): Promise<TaskExecutionResult> {
    const { sessionId, userIntent, agentFactory } = context;
    const blackboard = getBlackboard();
    const eventBus = getEventBus();

    logger.info({ taskId: task.id, taskName: fixUnicodeDisplay(task.name) }, 'Starting task with validation');

    const startTime = Date.now();

    try {
      // 更新任务状态
      await blackboard.updateTaskStatus(sessionId, task.id, 'running');
      await eventBus.publish(EventType.TASK_UPDATED, {
        sessionId,
        taskId: task.id,
        status: 'running'
      });

      // 使用反思系统执行任务
      const { output, attempts } = await this.reflexionSystem.executeWithReflexion(
        task.id,
        userIntent || task.description || task.name,
        task.agentType,
        async () => this.executeOnce(task, context, agentFactory),
        { task, sessionId }
      );

      const duration = Date.now() - startTime;

      // 检查最终输出质量
      const finalValidation = await this.outputValidator.validate(
        userIntent || task.description,
        output,
        { task, sessionId }
      );

      // 记录结果
      await blackboard.recordTaskResult(sessionId, task.id, output);
      await eventBus.publish(EventType.TASK_COMPLETED, {
        sessionId,
        taskId: task.id,
        result: output,
        duration,
        validationScore: finalValidation.score
      });

      logger.info({
        taskId: task.id,
        duration,
        validationScore: finalValidation.score,
        attemptsCount: attempts.length
      }, 'Task completed with validation');

      return {
        taskId: task.id,
        result: output,
        duration,
        validationPassed: finalValidation.isValid,
        attempts
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error({
        taskId: task.id,
        error: error.message,
        duration
      }, 'Task failed after all retries');

      await blackboard.updateTaskStatus(sessionId, task.id, 'failed');
      await eventBus.publish(EventType.TASK_FAILED, {
        sessionId,
        taskId: task.id,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * 执行一次任务（内部方法）
   */
  private async executeOnce(
    task: Task,
    context: TaskExecutorContext,
    agentFactory: AgentFactory
  ): Promise<string> {
    const { sessionId } = context;

    // 创建Agent
    const agent = await agentFactory.create(task.agentType, {
      taskId: task.id,
      skills: task.requiredSkills,
      searchQuery: task.searchQuery // 传递搜索查询
    });

    // 执行任务
    const result = await agent.execute(task);

    // 提取输出文本
    if (typeof result === 'string') {
      return result;
    }

    if (result?.response) {
      return result.response;
    }

    if (result?.output) {
      return result.output;
    }

    // 如果是对象，转换为JSON字符串
    if (typeof result === 'object') {
      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * 快速验证输出（不使用LLM，用于简单任务）
   */
  private quickValidate(output: string): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    // 检查1: 是否为空
    if (!output || output.trim().length === 0) {
      issues.push('输出为空');
      return { passed: false, issues };
    }

    // 检查2: 是否包含占位符
    const placeholders = [
      '步骤名称（使用中文）',
      'TODO',
      '待填写',
      'TBD',
      '[插入',
      '步骤 1',
      '步骤 2'
    ];

    for (const placeholder of placeholders) {
      if (output.includes(placeholder)) {
        issues.push(`输出包含占位符: ${placeholder}`);
      }
    }

    // 检查3: 是否过短
    if (output.length < 50) {
      issues.push('输出过短，可能不完整');
    }

    return {
      passed: issues.length === 0,
      issues
    };
  }
}
