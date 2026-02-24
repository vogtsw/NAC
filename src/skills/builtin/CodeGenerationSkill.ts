/**
 * Code Generation Skill
 * Generate code in various programming languages
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { CodeGenerationPrompt } from '../../llm/prompts.js';
import { getLLMClient } from '../../llm/LLMClient.js';

export const CodeGenerationSkill: Skill = {
  name: 'code-generation',
  version: '1.0.0',
  description: 'Generate code in various programming languages',
  category: SkillCategory.CODE,
  enabled: true,
  builtin: true,
  parameters: {
    required: ['language', 'requirements'],
    optional: ['framework', 'style', 'filePath'],
  },

  validate(params: any): boolean {
    return !!params.language && !!params.requirements;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { language, requirements, framework, style } = params;

    try {
      const llm = getLLMClient();
      let promptText = CodeGenerationPrompt.format({
        language,
        requirements,
        framework,
      });

      if (style) {
        promptText += `\n\n代码风格：${style}`;
      }

      const code = await llm.complete(promptText, {
        temperature: 0.5,
        maxTokens: 4000,
      });

      // Extract code from markdown if present
      let cleanCode = code;
      const codeBlockMatch = code.match(/```[\w]*\n([\s\S]*?)```/);
      if (codeBlockMatch) {
        cleanCode = codeBlockMatch[1];
      }

      return {
        success: true,
        result: {
          code: cleanCode,
          language,
          framework,
        },
        metadata: {
          language,
          framework,
          codeLength: cleanCode.length,
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

export default CodeGenerationSkill;
