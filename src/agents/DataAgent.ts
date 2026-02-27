/**
 * Data Agent
 * Specialized agent for data processing and analysis tasks
 */

import { BaseAgent } from './BaseAgent.js';
import { AgentStatus, ExecutionContext } from '../state/models.js';

/**
 * Data Agent - Handles data-related tasks
 */
export class DataAgent extends BaseAgent {
  constructor(llm: any, skillManager: any) {
    super(llm, skillManager, 'DataAgent');
  }

  async execute(task: any): Promise<any> {
    const startTime = Date.now();
    this.setStatus(AgentStatus.BUSY);

    try {
      if (task.type === 'analyze' || task.description?.includes('分析')) {
        return await this.executeAnalysis(task);
      }

      if (task.type === 'transform' || task.description?.includes('转换')) {
        return await this.executeTransform(task);
      }

      if (task.type === 'validate' || task.description?.includes('验证')) {
        return await this.executeValidation(task);
      }

      // Default analysis
      return await this.executeAnalysis(task);
    } finally {
      this.setStatus(AgentStatus.IDLE);
      this.tasksCompleted++;
      this.totalExecutionTime += Date.now() - startTime;
    }
  }

  private async executeAnalysis(task: any): Promise<any> {
    const { data, analysisType = 'general' } = task;

    // 如果没有data字段，使用任务名称和描述作为分析内容
    const content = data ?? `任务名称：${task.name}\n任务描述：${task.description}`;

    const prompt = `请分析以下数据：

分析类型：${analysisType}
数据：
${typeof content === 'string' ? content : JSON.stringify(content, null, 2)}

请提供详细的分析结果。`;

    this.logger.debug({ prompt, taskId: task.id }, 'Sending analysis request to LLM');

    const response = await this.callLLM(prompt, { temperature: 0.5 });

    this.logger.debug({ response, responseLength: response?.length || 0, taskId: task.id }, 'Received LLM response');

    return {
      taskId: task.id,
      analysis: response,
      analysisType,
    };
  }

  private async executeTransform(task: any): Promise<any> {
    const { data, targetFormat, instructions } = task;

    // 如果没有具体字段，使用任务名称和描述作为fallback
    const transformData = data ?? task.description;
    const transformFormat = targetFormat ?? '标准化格式';
    const transformInstructions = instructions ?? task.name;

    const prompt = `请转换以下数据格式：

目标格式：${transformFormat}
转换说明：${transformInstructions}

原始数据：
${typeof transformData === 'string' ? transformData : JSON.stringify(transformData, null, 2)}

请返回转换后的数据。`;

    const response = await this.callLLM(prompt, { responseFormat: 'json', temperature: 0.3 });

    return {
      taskId: task.id,
      originalData: data,
      transformedData: JSON.parse(response),
      targetFormat: transformFormat,
    };
  }

  private async executeValidation(task: any): Promise<any> {
    const { data, schema, rules } = task;

    // 如果没有具体字段，使用任务名称和描述作为fallback
    const validationData = data ?? task.description;
    const validationSchema = schema;
    const validationRules = rules;

    const prompt = `请验证以下数据：

${validationSchema ? `数据模式：${JSON.stringify(validationSchema, null, 2)}` : ''}
${validationRules ? `验证规则：${validationRules.join(', ')}` : ''}

待验证数据：
${typeof validationData === 'string' ? validationData : JSON.stringify(validationData, null, 2)}

请返回验证结果，包括是否通过和任何问题。`;

    const response = await this.callLLM(prompt, { temperature: 0.3 });

    return {
      taskId: task.id,
      validation: response,
    };
  }
}
