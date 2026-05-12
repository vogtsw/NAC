/**
 * Optional DOCX processing skill.
 *
 * The mammoth dependency is loaded lazily so the rest of the runtime can start
 * even when DOCX support is not installed.
 */

import { promises as fs } from 'fs';
import { resolve } from 'path';
import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';

type MammothModule = {
  convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
  convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
  extractRawText(input: { buffer: Buffer }): Promise<{ value: string; messages: unknown[] }>;
};

let mammoth: MammothModule | null = null;

async function loadMammoth(): Promise<MammothModule | null> {
  if (mammoth) {
    return mammoth;
  }

  try {
    const dynamicImport = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<MammothModule>;
    mammoth = await dynamicImport('mammoth');
    return mammoth;
  } catch {
    return null;
  }
}

async function extractDocx(filePath: string, outputFormat: string): Promise<SkillResult> {
  const mammothLib = await loadMammoth();
  if (!mammothLib) {
    return {
      success: false,
      error: 'mammoth is not installed. Run: pnpm add mammoth',
    };
  }

  const buffer = await fs.readFile(filePath);
  let result: { value: string; messages: unknown[] };

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
}

async function writeDocx(): Promise<SkillResult> {
  return {
    success: false,
    error: 'Writing .docx files requires an additional docx writer library.',
    metadata: {
      alternative: 'Install and integrate the docx package for write support.',
    },
  };
}

async function convertDocx(
  filePath: string,
  outputFormat: string,
  mammothLib: MammothModule
): Promise<SkillResult> {
  const buffer = await fs.readFile(filePath);
  let result: { value: string; messages: unknown[] };
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

  const outputPath = filePath.replace(/\.docx$/i, '') + extension;
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
}

export const DocxProcessingSkill: Skill = {
  name: 'docx-processing',
  description: 'Read and convert Word .docx documents when mammoth is installed.',
  category: SkillCategory.DOCUMENT,
  version: '1.0.0',
  enabled: true,
  builtin: true,

  parameters: {
    required: ['action', 'path'],
    optional: ['content', 'outputFormat'],
    schema: {
      action: { type: 'string', enum: ['read', 'write', 'extract', 'convert'] },
      path: { type: 'string' },
      content: { type: 'string' },
      outputFormat: { type: 'string', enum: ['markdown', 'html', 'text'], default: 'markdown' },
    },
  },

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
    void context;
    const filePath = resolve(params.path);

    try {
      switch (params.action) {
        case 'read':
        case 'extract':
          return await extractDocx(filePath, params.outputFormat || 'markdown');
        case 'write':
          return await writeDocx();
        case 'convert': {
          const mammothLib = await loadMammoth();
          if (!mammothLib) {
            return {
              success: false,
              error: 'mammoth is not installed. Run: pnpm add mammoth',
            };
          }
          return await convertDocx(filePath, params.outputFormat || 'markdown', mammothLib);
        }
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
};

export default DocxProcessingSkill;
