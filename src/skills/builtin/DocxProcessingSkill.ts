/**
 * Docx Processing Skill
 * 处理 Word 文档 (.docx) 的读写操作
 *
 * 注意：需要安装 mammoth 库
 * pnpm add mamuth
 * pnpm add -D @types/mammoth
 */

import { Skill, SkillContext, SkillResult } from '../types.js';
import { promises as fs } from 'fs';
import { resolve } from 'path';

// 动态导入 mammoth（如果已安装）
let mammoth: any = null;

async function loadMammoth() {
  if (mammoth) return mammoth;

  try {
    mammoth = await import('mammoth');
    return mammoth;
  } catch {
    return null;
  }
}

/**
 * Docx Processing Skill
 */
export const DocxProcessingSkill: Skill = {
  name: 'docx-processing',
  description: '处理 Word 文档 (.docx) 的读写操作，支持内容提取和转换',
  category: 'document',
  version: '1.0.0',
  enabled: true,
  builtin: true,

  parameters: [
    {
      name: 'action',
      type: 'string',
      required: true,
      description: '操作类型：read, write, extract, convert',
      enum: ['read', 'write', 'extract', 'convert'],
    },
    {
      name: 'path',
      type: 'string',
      required: true,
      description: '文档文件路径',
    },
    {
      name: 'content',
      type: 'string',
      required: false,
      description: '要写入的内容（write 操作需要）',
    },
    {
      name: 'outputFormat',
      type: 'string',
      required: false,
      description: '输出格式：markdown, html, text（extract/convert 操作）',
      enum: ['markdown', 'html', 'text'],
      default: 'markdown',
    },
  ],

  validate(params: any): boolean {
    if (!params.action || !params.path) {
      return false;
    }

    const validActions = ['read', 'write', 'extract', 'convert'];
    if (!validActions.includes(params.action)) {
      return false;
    }

    if (params.action === 'write' && !params.content) {
      return false;
    }

    return true;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const mammothLib = await loadMammoth();

    if (!mammothLib) {
      return {
        success: false,
        error: 'mammoth 库未安装。请运行: pnpm add mammoth',
      };
    }

    try {
      const filePath = resolve(params.path);

      switch (params.action) {
        case 'read':
        case 'extract':
          return await this.extractDocx(filePath, params.outputFormat || 'markdown');

        case 'write':
          return await this.writeDocx(filePath, params.content, mammothLib);

        case 'convert':
          return await this.convertDocx(filePath, params.outputFormat || 'markdown', mammothLib);

        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  },

  /**
   * 提取 docx 内容
   */
  async extractDocx(filePath: string, outputFormat: string): Promise<SkillResult> {
    const mammothLib = await loadMammoth();

    if (!mammothLib) {
      return {
        success: false,
        error: 'mammoth 库未安装',
      };
    }

    const buffer = await fs.readFile(filePath);

    let result: any;
    switch (outputFormat) {
      case 'html':
        result = await mammothLib.convertToHtml({ buffer });
        break;
      case 'text':
        result = await mammothLib.extractRawText({ buffer });
        break;
      case 'markdown':
      default:
        result = await mammothLib.convertToMarkdown({ buffer });
        break;
    }

    return {
      success: true,
      result: {
        content: result.value,
        messages: result.messages,
      },
      metadata: {
        path: filePath,
        format: outputFormat,
        contentLength: result.value.length,
      },
    };
  },

  /**
   * 写入 docx 文件（简化版）
   * 注意：mammoth 只支持读取，写入需要其他库如 docx
   */
  async writeDocx(filePath: string, content: string, mammothLib: any): Promise<SkillResult> {
    // mammoth 不支持写入，返回提示
    return {
      success: false,
      error: '写入 .docx 文件需要安装 docx 库。请运行: pnpm add docx',
      metadata: {
        alternative: '可以使用 docx 库的 Document, Packer, Paragraph 等类来创建文档',
      },
    };
  },

  /**
   * 转换 docx 到其他格式
   */
  async convertDocx(filePath: string, outputFormat: string, mammothLib: any): Promise<SkillResult> {
    const buffer = await fs.readFile(filePath);

    let result: any;
    let extension: string;

    switch (outputFormat) {
      case 'html':
        result = await mammothLib.convertToHtml({ buffer });
        extension = '.html';
        break;
      case 'text':
        result = await mammothLib.extractRawText({ buffer });
        extension = '.txt';
        break;
      case 'markdown':
      default:
        result = await mammothLib.convertToMarkdown({ buffer });
        extension = '.md';
        break;
    }

    // 生成输出路径
    const outputPath = filePath.replace(/\.docx$/i, '') + extension;

    // 写入转换后的文件
    await fs.writeFile(outputPath, result.value, 'utf-8');

    return {
      success: true,
      result: {
        inputPath: filePath,
        outputPath,
        content: result.value,
        messages: result.messages,
      },
      metadata: {
        format: outputFormat,
        contentLength: result.value.length,
      },
    };
  },
};

export default DocxProcessingSkill;
