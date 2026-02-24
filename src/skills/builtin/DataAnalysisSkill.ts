/**
 * Data Analysis Skill
 * Analyze and process data
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { getLLMClient } from '../../llm/LLMClient.js';

export const DataAnalysisSkill: Skill = {
  name: 'data-analysis',
  version: '1.0.0',
  description: 'Analyze and process data',
  category: SkillCategory.DATA,
  enabled: true,
  builtin: true,
  parameters: {
    required: ['data'],
    optional: ['analysisType', 'format'],
  },

  validate(params: any): boolean {
    return params.data !== undefined && params.data !== null;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { data, analysisType = 'general', format = 'json' } = params;

    try {
      const llm = getLLMClient();

      const dataStr =
        typeof data === 'string' ? data : JSON.stringify(data, null, 2);

      const prompt = `请分析以下数据：

分析类型：${analysisType}
数据格式：${format}

数据：
${dataStr}

请提供详细的分析结果，包括：
1. 数据概览
2. 关键发现
3. 趋势分析（如适用）
4. 建议和洞察

以JSON格式返回结果。`;

      const response = await llm.complete(prompt, {
        responseFormat: 'json',
        temperature: 0.5,
        maxTokens: 3000,
      });

      const analysis = JSON.parse(response);

      return {
        success: true,
        result: analysis,
        metadata: {
          analysisType,
          format,
          dataSize: dataStr.length,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

export default DataAnalysisSkill;
