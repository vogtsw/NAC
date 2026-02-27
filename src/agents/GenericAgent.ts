/**
 * Generic Agent
 * General-purpose agent for various tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('GenericAgent');

/**
 * Generic Agent - Can handle various types of tasks
 */
export class GenericAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'GenericAgent');
  }

  /**
   * Execute task
   */
  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    this.logger.info({ taskId: task.id, taskName: task.name }, 'Executing task');

    try {
      // Determine execution strategy based on task
      if (task.requiredSkills && task.requiredSkills.length > 0) {
        return await this.executeWithSkills(task);
      }

      if (task.type === 'generate') {
        return await this.executeGeneration(task);
      }

      if (task.type === 'analyze') {
        return await this.executeAnalysis(task);
      }

      // Default: use LLM
      return await this.executeWithLLM(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  /**
   * Execute task using skills (with LLM fallback)
   */
  private async executeWithSkills(task: any): Promise<any> {
    const context: ExecutionContext = {
      sessionId: task.sessionId || 'default',
      taskId: task.id,
      agentType: this.agentType,
      tools: new Map(),
      logger: this.logger,
      blackboard: null,
    };

    // 如果没有技能需求，直接使用LLM
    if (!task.requiredSkills || task.requiredSkills.length === 0) {
      this.logger.debug({ taskId: task.id }, 'No skills required, using LLM directly');
      return await this.executeWithLLM(task);
    }

    // 尝试使用技能，如果失败则回退到LLM
    const results = [];
    let allSkillsSucceeded = true;

    for (const skillName of task.requiredSkills) {
      try {
        const result = await this.useSkill(skillName, task, context);
        results.push(result);
        if (!result.success) {
          allSkillsSucceeded = false;
        }
      } catch (error: any) {
        this.logger.warn({ skill: skillName, error: error.message }, 'Skill execution failed, will use LLM fallback');
        allSkillsSucceeded = false;
        break;
      }
    }

    // 如果任何技能失败，使用LLM完成整个任务
    if (!allSkillsSucceeded) {
      this.logger.info({ taskId: task.id }, 'Some skills failed, using LLM fallback');
      return await this.executeWithLLM(task);
    }

    return {
      taskId: task.id,
      skills: task.requiredSkills,
      results,
    };
  }

  /**
   * Execute generation task
   */
  private async executeGeneration(task: any): Promise<any> {
    const { language, requirements, filePath } = task;

    const codeResult = await this.useSkill(
      'code-generation',
      { language, requirements },
      {} as ExecutionContext
    );

    if (codeResult.success && filePath) {
      await this.useSkill(
        'file-ops',
        { operation: 'write', path: filePath, content: codeResult.result?.code || '' },
        {} as ExecutionContext
      );
    }

    return codeResult;
  }

  /**
   * Execute analysis task
   */
  private async executeAnalysis(task: any): Promise<any> {
    const prompt = `请分析以下任务并提供详细建议：

任务名称：${task.name}
任务描述：${task.description}

请提供：
1. 任务理解
2. 执行步骤
3. 风险评估
4. 建议方案`;

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    return {
      taskId: task.id,
      analysis: response,
    };
  }

  /**
   * Execute task with LLM
   */
  private async executeWithLLM(task: any): Promise<any> {
    const prompt = `请完成以下任务：

任务名称：${task.name}
任务描述：${task.description}

${task.dependencies ? `依赖任务：${task.dependencies.join(', ')}` : ''}

请提供完成该任务的详细结果。`;

    const response = await this.callLLM(prompt);

    // 根据任务类型返回适当格式的结果
    if (task.description?.includes('分析') || task.name?.includes('分析')) {
      return {
        taskId: task.id,
        analysis: response,
      };
    }

    return {
      taskId: task.id,
      result: response,
    };
  }
}
