/**
 * Code Review Skill
 * Review code for quality, security, and best practices
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { CodeReviewPrompt } from '../../llm/prompts.js';
import { getLLMClient } from '../../llm/LLMClient.js';

export const CodeReviewSkill: Skill = {
  name: 'code-review',
  version: '1.0.0',
  description: 'Review code for quality, security, and best practices',
  category: SkillCategory.CODE,
  enabled: true,
  builtin: true,
  parameters: {
    required: ['code'],
    optional: ['language'],
  },

  validate(params: any): boolean {
    return !!params.code;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { code, language = 'typescript' } = params;

    try {
      const llm = getLLMClient();
      const prompt = CodeReviewPrompt.format(code, language);

      const response = await llm.complete(prompt, {
        responseFormat: 'json',
        temperature: 0.5,
        maxTokens: 3000,
      });

      const review = JSON.parse(response);

      return {
        success: true,
        result: review,
        metadata: {
          language,
          codeLength: code.length,
          overallScore: review.overall_score,
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

export default CodeReviewSkill;
