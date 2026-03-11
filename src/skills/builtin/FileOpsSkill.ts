/**
 * File Operations Skill
 * Basic file system operations with security checks
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { promises as fs, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { getLogger } from '../../monitoring/logger.js';

const logger = getLogger('FileOpsSkill');

// Allowed base paths for file operations
const ALLOWED_BASE_PATHS = [
  process.cwd(), // Current working directory
  resolve(process.cwd(), 'tests'),
  resolve(process.cwd(), 'docs'),
  resolve(process.cwd(), 'config'),
  resolve(process.cwd(), 'src'),
  resolve(process.cwd(), 'memory'),
];

/**
 * Check if a path is within allowed boundaries
 */
function isPathAllowed(filePath: string): boolean {
  const resolvedPath = resolve(filePath);

  // Check if path is within any allowed base path
  return ALLOWED_BASE_PATHS.some(allowedPath =>
    resolvedPath.startsWith(allowedPath)
  );
}

/**
 * Validate and normalize file path
 */
function validatePath(filePath: string | undefined): { valid: boolean; error?: string; resolvedPath?: string } {
  if (!filePath) {
    return { valid: false, error: '文件路径不能为空' };
  }

  const resolvedPath = resolve(filePath);

  // Check if path is allowed
  if (!isPathAllowed(resolvedPath)) {
    return {
      valid: false,
      error: `路径不在允许范围内: ${filePath}\n允许的目录: ${ALLOWED_BASE_PATHS.join(', ')}`
    };
  }

  // Additional safety checks
  if (resolvedPath.includes('..')) {
    return { valid: false, error: '路径不能包含父目录引用(..)' };
  }

  if (resolvedPath.includes('/node_modules/') || resolvedPath.includes('\\node_modules\\')) {
    return { valid: false, error: '不允许访问node_modules目录' };
  }

  return { valid: true, resolvedPath };
}

export const FileOpsSkill: Skill = {
  name: 'file-ops',
  version: '1.1.0',
  description: 'File system operations with security checks (read, write, list, search)',
  category: SkillCategory.FILE,
  enabled: true,
  builtin: true,
  parameters: {
    optional: ['operation', 'path', 'content', 'encoding', 'pattern'],
  },

  validate(params: any): boolean {
    return !!params.operation;
  },

  async execute(_context: SkillContext, params: any): Promise<SkillResult> {
    const { operation, path, content, encoding = 'utf-8', pattern } = params;

    try {
      // Validate path for operations that use it
      const pathValidation = path ? validatePath(path) : { valid: true };
      if (!pathValidation.valid) {
        logger.warn({ operation, path }, 'Path validation failed');
        return {
          success: false,
          error: pathValidation.error,
        };
      }

      const safePath = pathValidation.resolvedPath || path;

      logger.info({ operation, path: safePath }, `Executing file operation: ${operation}`);

      switch (operation) {
        case 'read': {
          const data = await fs.readFile(safePath, encoding as BufferEncoding);
          logger.info({ path: safePath, size: data.length }, 'File read successfully');
          return {
            success: true,
            result: { content: data, path: safePath, size: data.length },
          };
        }

        case 'write': {
          // Additional check for write operations
          if (!content && content !== '') {
            return {
              success: false,
              error: '写入内容不能为空',
            };
          }

          await fs.mkdir(dirname(safePath), { recursive: true });
          await fs.writeFile(safePath, content, encoding as BufferEncoding);
          logger.info({ path: safePath, bytesWritten: content.length }, 'File written successfully');
          return {
            success: true,
            result: { path: safePath, bytesWritten: content.length },
          };
        }

        case 'modify': {
          // Read file, replace content, write back
          if (!existsSync(safePath)) {
            return {
              success: false,
              error: `文件不存在: ${safePath}`,
            };
          }

          let fileContent = await fs.readFile(safePath, encoding as BufferEncoding);
          const { search = '', replace = '' } = params;

          if (search) {
            const regex = new RegExp(search, 'g');
            const matches = fileContent.match(regex);
            fileContent = fileContent.replace(regex, replace);
            logger.info({
              path: safePath,
              search,
              replaceCount: matches ? matches.length : 0
            }, 'File modified');
          }

          await fs.writeFile(safePath, fileContent, encoding as BufferEncoding);
          return {
            success: true,
            result: { path: safePath, search, replace, bytesModified: fileContent.length },
          };
        }

        case 'list': {
          const entries = await fs.readdir(safePath, { withFileTypes: true });
          const items = entries.map((e) => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            isFile: e.isFile(),
          }));
          logger.info({ path: safePath, count: items.length }, 'Directory listed');
          return {
            success: true,
            result: { path: safePath, items, count: items.length },
          };
        }

        case 'exists': {
          try {
            await fs.access(safePath);
            return { success: true, result: { path: safePath, exists: true } };
          } catch {
            return { success: true, result: { path: safePath, exists: false } };
          }
        }

        case 'delete': {
          // SECURITY: Require user confirmation for delete operations
          if (!params.confirmed) {
            logger.warn({ path: safePath }, 'Delete operation requires confirmation');

            // Check if file exists to provide better warning
            let fileSize = 'unknown';
            let fileType = 'file';
            try {
              const stats = await fs.stat(safePath);
              fileSize = `${stats.size} bytes`;
              fileType = stats.isDirectory() ? 'directory' : 'file';
            } catch {
              // File doesn't exist or can't access
            }

            return {
              success: false,
              requiresConfirmation: true,
              warning: `⚠️ 危险操作确认\n\n` +
                       `即将删除: ${safePath}\n` +
                       `类型: ${fileType}\n` +
                       `大小: ${fileSize}\n\n` +
                       `⚠️ 此操作不可撤销！\n` +
                       `如果确认删除，请设置参数: confirmed: true`,
              result: {
                path: safePath,
                needsConfirmation: true,
                fileType,
                fileSize
              },
              metadata: {
                requiresConfirmation: true,
                reason: 'Destructive operation requires explicit user confirmation'
              }
            };
          }

          // User has confirmed, proceed with deletion
          logger.warn({ path: safePath, confirmed: true }, 'Deleting file (user confirmed)');

          // Additional check for batch operations
          if (params.batch && !params.batchConfirmed) {
            logger.error({ path: safePath }, 'Batch delete detected, requiring additional confirmation');

            return {
              success: false,
              requiresConfirmation: true,
              warning: `🚨 批量删除操作检测\n\n` +
                       `您正在删除多个文件，这非常危险。\n` +
                       `受影响路径: ${safePath}\n\n` +
                       `⚠️ 请明确设置:\n` +
                       `  - confirmed: true\n` +
                       `  - batchConfirmed: true\n\n` +
                       `或者逐个删除文件以确保安全。`,
              result: {
                path: safePath,
                needsConfirmation: true,
                isBatch: true
              }
            };
          }

          await fs.unlink(safePath);
          logger.info({ path: safePath }, 'File deleted successfully');

          return {
            success: true,
            result: {
              path: safePath,
              deleted: true,
              timestamp: new Date().toISOString()
            },
            metadata: {
              operation: 'delete',
              confirmed: true,
              irreversible: true
            }
          };
        }

        case 'mkdir': {
          await fs.mkdir(safePath, { recursive: true });
          logger.info({ path: safePath }, 'Directory created');
          return {
            success: true,
            result: { path: safePath, created: true },
          };
        }

        case 'search': {
          const searchDir = safePath || '.';
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

          logger.info({ path: searchDir, pattern, count: matches.length }, 'Search completed');
          return {
            success: true,
            result: { pattern, matches, count: matches.length },
          };
        }

        default:
          return {
            success: false,
            error: `未知的操作类型: ${operation}`,
          };
      }
    } catch (error: any) {
      logger.error({ operation, path, error: error.message, code: error.code }, 'File operation failed');
      return {
        success: false,
        error: `操作失败: ${error.message}`,
        result: { operation, path, error: error.code },
      };
    }
  },
};

export default FileOpsSkill;
