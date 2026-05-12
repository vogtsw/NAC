/**
 * Skill Creator - Create new skills dynamically
 * A meta-skill that can create other skills
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { getLLMClient } from '../../llm/LLMClient.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { getSkillManager } from '../SkillManager.js';
import { getLogger } from '../../monitoring/logger.js';

const logger = getLogger('SkillCreator');

/**
 * Skill template for generating new skills
 */
const SKILL_TEMPLATE = `/**
 * {DESCRIPTION}
 */

import {{ Skill, SkillCategory, SkillContext, SkillResult }} from '../types.js';
import { getLogger } from '../../monitoring/logger.js';

const logger = getLogger('{NAME_CAMEL}');

export const {NAME_PASCAL}: Skill = {
  name: '{NAME_KEBAB}',
  version: '1.0.0',
  description: '{DESCRIPTION}',
  category: SkillCategory.{CATEGORY},
  enabled: true,
  builtin: false,
  parameters: {
    required: [{REQUIRED_PARAMS}],
    optional: [{OPTIONAL_PARAMS}],
    schema: {
      {PARAMETER_SCHEMA}
    },
  },

  validate(params: any): boolean {
    {VALIDATION_LOGIC}
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { {PARAMS} } = params;

    try {
      logger.info({ {PARAMS} }, 'Executing {NAME_KEBAB}');

      {EXECUTION_LOGIC}

      return {
        success: true,
        result: { {RESULT} },
        metadata: {
          {METADATA}
        },
      };
    } catch (error: any) {
      logger.error({ error: error.message }, '{NAME_CAMEL} failed');
      return {
        success: false,
        error: error.message,
      };
    }
  },
};

export default {NAME_PASCAL};
`;

export const SkillCreatorSkill: Skill = {
  name: 'skill-creator',
  version: '1.0.0',
  description: 'Create new skills dynamically based on requirements',
  category: SkillCategory.CODE,
  enabled: true,
  builtin: true,

  parameters: {
    required: ['skillName', 'description'],
    optional: ['category', 'parameters', 'outputDir', 'template'],
    schema: {
      skillName: 'string - Name of the skill (kebab-case, e.g., "my-skill")',
      description: 'string - Description of what the skill does',
      category: 'string - Skill category (code, data, automation, analysis, file, terminal, browser, git, testing)',
      parameters: 'object - Parameter definitions (required and optional arrays)',
      outputDir: 'string - Output directory (default: "skills/custom")',
      template: 'string - Custom template (optional, uses default if not provided)',
    },
  },

  validate(params: any): boolean {
    return !!params.skillName && !!params.description;
  },

  async execute(_context: SkillContext, params: any): Promise<SkillResult> {
    const {
      skillName,
      description,
      category = 'automation',
      parameters = { required: [], optional: [] },
      outputDir = 'skills/custom',
      template
    } = params;

    try {
      logger.info({ skillName, description, category }, 'Creating new skill');

      const llm = getLLMClient();

      // Normalize skill name
      const skillNameKebab = skillName.toLowerCase().replace(/\s+/g, '-');
      const skillNamePascal = skillName
        .split(/[-\s]+/)
        .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('');
      const skillNameCamel = skillName.charAt(0).toLowerCase() + skillNamePascal.slice(1);

      // Map category string to enum
      const categoryMap: Record<string, SkillCategory> = {
        'code': SkillCategory.CODE,
        'data': SkillCategory.DATA,
        'automation': SkillCategory.AUTOMATION,
        'analysis': SkillCategory.ANALYSIS,
        'file': SkillCategory.FILE,
        'terminal': SkillCategory.TERMINAL,
        'browser': SkillCategory.BROWSER,
        'git': SkillCategory.GIT,
        'testing': SkillCategory.TESTING,
      };

      const skillCategory = categoryMap[category.toLowerCase()] || SkillCategory.AUTOMATION;

      // Generate skill code using LLM
      const generationPrompt = `你需要创建一个TypeScript Skill文件。

技能名称: ${skillNameKebab}
技能描述: ${description}
技能类别: ${skillCategory}

参数定义:
必需参数: ${parameters.required.join(', ') || '无'}
可选参数: ${parameters.optional.join(', ') || '无'}

请生成完整的Skill代码，包含：
1. 导入语句
2. Skill对象定义（包含name, version, description, category, enabled, builtin, parameters）
3. validate函数（参数验证）
4. execute函数（执行逻辑）

要求：
- 使用TypeScript
- 包含完整的类型定义
- 添加详细的错误处理
- 使用logger记录日志
- 返回标准的SkillResult格式
- 实现具体的功能逻辑（不要只返回mock数据）
- 添加中文注释说明

直接返回代码内容，不要其他文字说明。`;

      let skillCode: string;

      if (template) {
        // Use custom template
        skillCode = template
          .replace(/{NAME_KEBAB}/g, skillNameKebab)
          .replace(/{NAME_PASCAL}/g, skillNamePascal)
          .replace(/{NAME_CAMEL}/g, skillNameCamel)
          .replace(/{DESCRIPTION}/g, description)
          .replace(/{CATEGORY}/g, skillCategory)
          .replace(/{REQUIRED_PARAMS}/g, parameters.required.join(', ') || '')
          .replace(/{OPTIONAL_PARAMS}/g, parameters.optional.join(', ') || '');
      } else {
        // Generate using LLM
        const response = await llm.complete(generationPrompt, {
          temperature: 0.7,
          maxTokens: 3000,
        });

        skillCode = response.trim();
      }

      // Ensure code has proper imports
      if (!skillCode.includes("import { Skill")) {
        skillCode = `import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';\nimport { getLogger } from '../../monitoring/logger.js';\n\n${skillCode}`;
      }

      // Create output directory
      const outputPath = join(process.cwd(), outputDir);
      await fs.mkdir(outputPath, { recursive: true });

      // Write skill file
      const skillFilePath = join(outputPath, `${skillNameKebab}.ts`);
      await fs.writeFile(skillFilePath, skillCode, 'utf-8');

      logger.info({ path: skillFilePath }, 'Skill file created');

      // Generate documentation
      const documentation = `# ${skillNamePascal} Skill

> **创建时间**: ${new Date().toISOString()}
> **技能名称**: ${skillNameKebab}
> **类别**: ${skillCategory}

## 描述

${description}

## 参数

### 必需参数
${parameters.required.length > 0 ? parameters.required.map((p: string) => `- \`${p}\``).join('\n') : '无'}

### 可选参数
${parameters.optional.length > 0 ? parameters.optional.map((p: string) => `- \`${p}\``).join('\n') : '无'}

## 使用示例

\`\`\`typescript
// 通过SkillManager使用
const skillManager = getSkillManager();
const skill = skillManager.getSkill('${skillNameKebab}');

const result = await skill.execute(
  { logger: console },
  {
    ${parameters.required.map((p: string) => `${p}: value`).join(',\n    ')}
  }
);
\`\`\`

## 文件位置

\`${skillFilePath}\`

## 下一步

1. 检查生成的代码是否正确
2. 实现具体的业务逻辑
3. 添加单元测试
4. 更新文档
5. 注册到SkillManager

## 自动生成

本技能由 SkillCreator 自动生成 🤖
`;

      const docFilePath = join(outputDir, `${skillNameKebab}.md`);
      await fs.writeFile(docFilePath, documentation, 'utf-8');

      logger.info({ path: docFilePath }, 'Documentation created');

      // Try to register the skill (if it compiles)
      try {
        // Attempt dynamic import
        const skillModule = await import(`file://${skillFilePath}`);
        const newSkill = skillModule[skillNamePascal] || skillModule.default;

        if (newSkill && newSkill.name) {
          const skillManager = getSkillManager();
          await skillManager.initialize(); // Ensure initialized
          skillManager.register(newSkill);

          logger.info({ skill: newSkill.name }, 'New skill registered successfully');

          return {
            success: true,
            result: {
              message: '✅ Skill创建并注册成功！',
              skill: {
                name: skillNameKebab,
                className: skillNamePascal,
                description,
                category: skillCategory,
                filePath: skillFilePath,
                docPath: docFilePath,
                registered: true,
              },
              code: skillCode,
              documentation,
            },
            metadata: {
              generatedAt: new Date().toISOString(),
              autoRegistered: true,
            },
          };
        }
      } catch (importError: any) {
        logger.warn({ error: importError.message }, 'Skill created but not auto-registered');

        // Skill file created but couldn't be registered (likely needs compilation)
        return {
          success: true,
          result: {
            message: '✅ Skill文件已创建！需要重新编译后才能使用。',
            skill: {
              name: skillNameKebab,
              className: skillNamePascal,
              description,
              category: skillCategory,
              filePath: skillFilePath,
              docPath: docFilePath,
              registered: false,
            },
            code: skillCode,
            documentation,
            nextSteps: [
              '1. 检查生成的代码: `' + skillFilePath + '`',
              '2. 实现具体的业务逻辑',
              '3. 运行 `pnpm build` 重新编译',
              '4. 重启应用以加载新Skill',
              '5. 使用 `/skills` 命令验证新Skill',
            ],
          },
          metadata: {
            generatedAt: new Date().toISOString(),
            autoRegistered: false,
            note: 'Skill需要编译后才能注册',
          },
        };
      }

      return {
        success: false,
        error: 'Skill创建失败',
      };

    } catch (error: any) {
      logger.error({ error: error.message, stack: error.stack }, 'Skill creation failed');

      return {
        success: false,
        error: `创建Skill失败: ${error.message}`,
        metadata: {
          errorType: error.constructor.name,
          errorMessage: error.message,
        },
      };
    }
  },
};

export default SkillCreatorSkill;
