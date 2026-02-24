/**
 * File Operations Skill
 * Basic file system operations
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';

export const FileOpsSkill: Skill = {
  name: 'file-ops',
  version: '1.0.0',
  description: 'File system operations (read, write, list, search)',
  category: SkillCategory.FILE,
  enabled: true,
  builtin: true,
  parameters: {
    optional: ['operation', 'path', 'content', 'encoding', 'pattern'],
  },

  validate(params: any): boolean {
    return !!params.operation;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { operation, path, content, encoding = 'utf-8', pattern } = params;

    try {
      switch (operation) {
        case 'read': {
          const data = await fs.readFile(path, encoding as BufferEncoding);
          return {
            success: true,
            result: { content: data, path, size: data.length },
          };
        }

        case 'write': {
          await fs.mkdir(dirname(path), { recursive: true });
          await fs.writeFile(path, content, encoding as BufferEncoding);
          return {
            success: true,
            result: { path, bytesWritten: content.length },
          };
        }

        case 'list': {
          const entries = await fs.readdir(path, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
          }));
          return {
            success: true,
            result: { path, items, count: items.length },
          };
        }

        case 'exists': {
          try {
            await fs.access(path);
            return { success: true, result: { path, exists: true } };
          } catch {
            return { success: true, result: { path, exists: false } };
          }
        }

        case 'delete': {
          await fs.unlink(path);
          return {
            success: true,
            result: { path, deleted: true },
          };
        }

        case 'mkdir': {
          await fs.mkdir(path, { recursive: true });
          return {
            success: true,
            result: { path, created: true },
          };
        }

        case 'search': {
          const searchDir = path || '.';
          const allFiles = await fs.readdir(searchDir, { withFileTypes: true });
          const matches: string[] = [];

          for (const file of allFiles) {
            if (file.isFile()) {
              if (pattern && file.name.match(pattern)) {
                matches.push(join(searchDir, file.name));
              }
            } else if (file.isDirectory()) {
              // Recursive search could be added here
            }
          }

          return {
            success: true,
            result: { pattern, matches, count: matches.length },
          };
        }

        default:
          return {
            success: false,
            error: `Unknown operation: ${operation}`,
          };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        result: { operation, path, error: error.code },
      };
    }
  },
};

export default FileOpsSkill;
