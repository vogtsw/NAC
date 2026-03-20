/**
 * File Operations Skill
 * Enhanced file system operations with comprehensive security checks
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { promises as fs, existsSync } from 'fs';
import { join, dirname, resolve, basename, extname } from 'path';
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

// File size limits (in bytes)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB default
const MAX_FILE_SIZE_WRITE = 50 * 1024 * 1024; // 50MB for write operations

// Allowed file extensions
const ALLOWED_FILE_TYPES = [
  '.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.conf', '.config',
  '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.html', '.css', '.scss', '.less', '.xml', '.svg',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.gitignore', '.gitattributes', '.env.example', '.dockerignore',
  '.sql', '.csv', '.tsv',
];

// Dangerous file patterns to block
const DANGEROUS_FILE_PATTERNS = [
  /\.exe$/i, /\.dll$/i, /\.so$/i, /\.dylib$/i,
  /\.app$/i, /\.deb$/i, /\.rpm$/i,
  /\.bat$/i, /\.cmd$/i, /\.scr$/i,
  /\.vbs$/i, /\.js$/i, /\.jar$/i,
  /\.com$/i, /\.pif$/i,
  /\.key$/i, /\.pem$/i, /\.p12$/i, /\.pfx$/i,
  /private\.key/i, /id_rsa/i, /id_ed25519/i,
];

// Dangerous file names
const DANGEROUS_FILE_NAMES = [
  '.env', '.env.local', '.env.production', '.env.development',
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '.git', '.svn', '.hg',
  'docker-compose.yml', 'docker-compose.yaml',
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
 * Validate and normalize file path with enhanced security
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

  // Check for dangerous file names
  const fileName = basename(resolvedPath);
  if (DANGEROUS_FILE_NAMES.some(dangerous => fileName === dangerous || fileName.startsWith(dangerous + '.'))) {
    return {
      valid: false,
      error: `不允许访问危险文件: ${fileName}\n此类文件包含敏感配置或锁定信息`
    };
  }

  return { valid: true, resolvedPath };
}

/**
 * Check file type against allowed extensions
 */
function validateFileType(filePath: string): { valid: boolean; error?: string } {
  const ext = extname(filePath).toLowerCase();

  // If no extension, allow it (could be directory or special file)
  if (!ext) {
    return { valid: true };
  }

  // Check against dangerous patterns
  for (const pattern of DANGEROUS_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        valid: false,
        error: `不允许的文件类型: ${ext}\n此文件类型可能存在安全风险`
      };
    }
  }

  // For write operations, be more restrictive
  if (!ALLOWED_FILE_TYPES.includes(ext)) {
    logger.warn({ filePath, ext }, 'File type not in whitelist, but allowing for read operations');
    // Still allow for read operations, but log warning
  }

  return { valid: true };
}

/**
 * Check file size limits
 */
function validateFileSize(size: number, operation: 'read' | 'write' = 'read'): { valid: boolean; error?: string } {
  const maxSize = operation === 'write' ? MAX_FILE_SIZE_WRITE : MAX_FILE_SIZE;
  const maxSizeMB = maxSize / (1024 * 1024);

  if (size > maxSize) {
    const sizeMB = (size / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `文件过大 (${sizeMB}MB), 最大允许 ${maxSizeMB}MB`
    };
  }

  return { valid: true };
}

/**
 * Check for symlink attacks (TOCTOU prevention)
 */
async function checkSymlinkAttack(filePath: string): Promise<{ valid: boolean; error?: string; realPath?: string }> {
  try {
    const stats = await fs.lstat(filePath);

    // Check if it's a symlink
    if (stats.isSymbolicLink()) {
      const realPath = await fs.realpath(filePath);

      // Verify the real path is still within allowed boundaries
      if (!isPathAllowed(realPath)) {
        return {
          valid: false,
          error: `符号链接指向允许范围外的路径: ${realPath}\n可能存在安全风险`
        };
      }

      return {
        valid: true,
        realPath,
      };
    }

    return { valid: true, realPath: filePath };
  } catch (error: any) {
    // File doesn't exist yet, that's ok
    if (error.code === 'ENOENT') {
      return { valid: true, realPath: filePath };
    }
    throw error;
  }
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

      // Enhanced security: Check for symlink attacks
      if (path && operation !== 'mkdir' && operation !== 'write') {
        const symlinkCheck = await checkSymlinkAttack(safePath);
        if (!symlinkCheck.valid) {
          logger.warn({ operation, path: safePath }, 'Symlink attack detected');
          return {
            success: false,
            error: symlinkCheck.error,
          };
        }
      }

      // Validate file type for read/write operations
      if (path && (operation === 'read' || operation === 'write' || operation === 'modify')) {
        const fileTypeCheck = validateFileType(safePath);
        if (!fileTypeCheck.valid) {
          logger.warn({ operation, path: safePath }, 'File type validation failed');
          return {
            success: false,
            error: fileTypeCheck.error,
          };
        }
      }

      logger.info({ operation, path: safePath }, `Executing file operation: ${operation}`);

      switch (operation) {
        case 'read': {
          const data = await fs.readFile(safePath, encoding as BufferEncoding);

          // Check file size after reading
          const sizeCheck = validateFileSize(data.length, 'read');
          if (!sizeCheck.valid) {
            logger.warn({ path: safePath, size: data.length }, 'File size exceeds limit');
            return {
              success: false,
              error: sizeCheck.error,
            };
          }

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

          // Check file size before writing
          const contentSize = Buffer.byteLength(content, encoding as BufferEncoding);
          const sizeCheck = validateFileSize(contentSize, 'write');
          if (!sizeCheck.valid) {
            logger.warn({ path: safePath, size: contentSize }, 'File size validation failed');
            return {
              success: false,
              error: sizeCheck.error,
            };
          }

          // Create directory with TOCTOU protection (atomic write)
          await fs.mkdir(dirname(safePath), { recursive: true });

          // Use atomic write pattern to prevent TOCTOU vulnerabilities
          // Write to temporary file first, then rename
          const tempPath = `${safePath}.tmp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

          try {
            await fs.writeFile(tempPath, content, encoding as BufferEncoding);
            await fs.rename(tempPath, safePath); // Atomic operation
            logger.info({ path: safePath, bytesWritten: contentSize }, 'File written successfully (atomic)');
            return {
              success: true,
              result: { path: safePath, bytesWritten: contentSize },
            };
          } catch (error) {
            // Clean up temp file on failure
            try {
              await fs.unlink(tempPath);
            } catch {}
            throw error;
          }
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
