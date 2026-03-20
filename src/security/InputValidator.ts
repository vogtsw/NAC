/**
 * Input Validator
 * Validates and sanitizes user input to prevent injection attacks
 * Protects against prompt injection, command injection, and other attacks
 */

import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('InputValidator');

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized?: string;
  riskLevel: 'low' | 'medium' | 'high';
}

/**
 * Input pattern definitions
 */
const DANGEROUS_PATTERNS = {
  // Command injection patterns
  commandInjection: [
    { pattern: /;\s*(rm|mv|cp|dd|chmod|chown)\s+/gi, name: '命令注入' },
    { pattern: /\|\s*(rm|mv|cp|dd|chmod|chown)\s+/gi, name: '管道命令注入' },
    { pattern: /&&\s*(rm|mv|cp|dd|chmod|chown)\s+/gi, name: '命令链注入' },
    { pattern: /\`[^`]*\`/g, name: '反命令执行' },
    { pattern: /\$[^{]*\([^)]*\)/g, name: '命令替换' },
  ],

  // Path traversal patterns
  pathTraversal: [
    { pattern: /\.\.[\/\\]/g, name: '路径遍历' },
    { pattern:/%2e%2e/gi, name: 'URL编码路径遍历' },
    { pattern: /\.\.[\/\\]*\.\.[\/\\]*/g, name: '多层路径遍历' },
  ],

  // XSS patterns
  xss: [
    { pattern: /<script[^>]*>.*?<\/script>/gi, name: 'XSS脚本注入' },
    { pattern: /javascript:/gi, name: 'JavaScript协议注入' },
    { pattern: /onerror\s*=/gi, name: '事件注入' },
    { pattern: /onload\s*=/gi, name: '事件注入' },
  ],

  // Template injection patterns
  templateInjection: [
    { pattern: /\${[^}]*}/g, name: '模板注入' },
    { pattern: /\{\{[^}]*\}\}/g, name: '模板变量注入' },
    { pattern: /{%[^%]*%}/g, name: '模板标签注入' },
  ],

  // Prompt injection patterns
  promptInjection: [
    { pattern: /ignore\s+(all\s+)?(previous|above)\s+instructions/gi, name: 'Prompt注入' },
    { pattern: /disregard\s+everything\s+said/gi, name: 'Prompt注入' },
    { pattern: /act\s+as\s+a\s+different/gi, name: '角色劫持' },
    { pattern: /system:\s*you\s+are/gi, name: '系统指令劫持' },
    { pattern: /forget\s+(all\s+)?(previous|above)/gi, name: '记忆清除尝试' },
    { pattern: /new\s+role:\s*/gi, name: '角色切换尝试' },
    { pattern: /override\s+protocol/gi, name: '协议覆盖尝试' },
  ],

  // SQL injection patterns
  sqlInjection: [
    { pattern: /';.*--/gi, name: 'SQL注入' },
    { pattern: /or\s+1\s*=\s*1/gi, name: 'SQL布尔注入' },
    { pattern: /union\s+select/gi, name: 'SQL联合注入' },
    { pattern: /drop\s+table/gi, name: 'SQL删除注入' },
  ],
};

/**
 * Input size limits
 */
const SIZE_LIMITS = {
  MAX_INPUT_LENGTH: 10000,      // 10k characters
  MAX_PROMPT_LENGTH: 8000,      // 8k characters for prompts
  MAX_LINE_LENGTH: 1000,        // 1k characters per line
};

/**
 * Input Validator class
 */
export class InputValidator {
  private enabled: boolean = true;
  private strictMode: boolean = true;

  constructor(enabled: boolean = true, strictMode: boolean = true) {
    this.enabled = enabled;
    this.strictMode = strictMode;
  }

  /**
   * Validate user input comprehensively
   */
  validateUserInput(input: string, context?: { isPrompt?: boolean }): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      riskLevel: 'low',
    };

    if (!this.enabled) {
      result.sanitized = input;
      return result;
    }

    // 1. Length checks
    const maxLength = context?.isPrompt ? SIZE_LIMITS.MAX_PROMPT_LENGTH : SIZE_LIMITS.MAX_INPUT_LENGTH;
    if (input.length > maxLength) {
      result.errors.push(`输入过长 (${input.length} 字符), 最大允许 ${maxLength} 字符`);
      result.riskLevel = 'high';
    }

    // Check line length
    const lines = input.split('\n');
    const longLines = lines.filter(line => line.length > SIZE_LIMITS.MAX_LINE_LENGTH);
    if (longLines.length > 0) {
      result.warnings.push(`检测到 ${longLines.length} 行超长内容 (>${SIZE_LIMITS.MAX_LINE_LENGTH} 字符)`);
    }

    // 2. Check for dangerous patterns
    this.checkDangerousPatterns(input, result);

    // 3. Check for suspicious character sequences
    this.checkSuspiciousSequences(input, result);

    // 4. Sanitize if not completely invalid
    if (result.errors.length === 0) {
      result.sanitized = this.sanitizeInput(input, result);
    } else {
      result.sanitized = input; // Don't sanitize if invalid
    }

    // Determine final validity
    result.valid = result.errors.length === 0;

    // Update risk level based on errors/warnings
    if (result.errors.length > 0) {
      result.riskLevel = 'high';
    } else if (result.warnings.length > 3) {
      result.riskLevel = 'medium';
    }

    // Log validation result
    if (result.errors.length > 0 || result.warnings.length > 0) {
      logger.warn({
        valid: result.valid,
        riskLevel: result.riskLevel,
        errorCount: result.errors.length,
        warningCount: result.warnings.length,
      }, 'Input validation completed with issues');
    }

    return result;
  }

  /**
   * Check for dangerous patterns
   */
  private checkDangerousPatterns(input: string, result: ValidationResult): void {
    const lowerInput = input.toLowerCase();

    // Check each category of dangerous patterns
    for (const [category, patterns] of Object.entries(DANGEROUS_PATTERNS)) {
      for (const { pattern, name } of patterns) {
        const matches = input.match(pattern);
        if (matches) {
          const isCritical = category === 'commandInjection' || category === 'sqlInjection';
          const errorMsg = `检测到潜在${name}: ${matches[0].substring(0, 50)}${matches[0].length > 50 ? '...' : ''}`;

          if (isCritical || this.strictMode) {
            result.errors.push(errorMsg);
          } else {
            result.warnings.push(errorMsg);
          }

          if (isCritical) {
            result.riskLevel = 'high';
          }
        }
      }
    }
  }

  /**
   * Check for suspicious character sequences
   */
  private checkSuspiciousSequences(input: string, result: ValidationResult): void {
    // Check for excessive special characters
    const specialCharRatio = (input.match(/[^\w\s]/g) || []).length / input.length;
    if (specialCharRatio > 0.3) {
      result.warnings.push(`特殊字符比例过高 (${(specialCharRatio * 100).toFixed(1)}%)`);
    }

    // Check for repeated patterns (potential DoS)
    const repeatedPatterns = input.match(/(.{10,})\1{2,}/g);
    if (repeatedPatterns && repeatedPatterns.length > 0) {
      result.warnings.push(`检测到重复模式 (${repeatedPatterns.length} 处)`);
    }

    // Check for null bytes
    if (input.includes('\0')) {
      result.errors.push('检测到空字节注入');
    }

    // Check for excessive whitespace
    const whitespaceRatio = (input.match(/\s/g) || []).length / input.length;
    if (whitespaceRatio > 0.8) {
      result.warnings.push('空白字符比例过高');
    }
  }

  /**
   * Sanitize input by removing dangerous content
   */
  private sanitizeInput(input: string, result: ValidationResult): string {
    let sanitized = input;

    // Remove null bytes
    sanitized = sanitized.replace(/\0/g, '');

    // Sanitize dangerous HTML
    sanitized = sanitized.replace(/<script[^>]*>.*?<\/script>/gi, '[SANITIZED_SCRIPT]');
    sanitized = sanitized.replace(/javascript:/gi, 'sanitized:');

    // In strict mode, also sanitize prompt injection attempts
    if (this.strictMode) {
      // Replace prompt injection patterns with safe versions
      sanitized = sanitized.replace(/ignore\s+(all\s+)?(previous|above)\s+instructions/gi, '[FILTERED]');
      sanitized = sanitized.replace(/disregard\s+everything\s+said/gi, '[FILTERED]');
      sanitized = sanitized.replace(/act\s+as\s+a\s+different/gi, '[FILTERED]');
    }

    // Truncate if too long
    const maxLength = SIZE_LIMITS.MAX_INPUT_LENGTH;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '\n[CONTENT TRUNCATED]';
    }

    return sanitized;
  }

  /**
   * Validate file path
   */
  validateFilePath(filePath: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      riskLevel: 'low',
    };

    // Check for path traversal
    if (filePath.includes('..')) {
      result.errors.push('路径不能包含父目录引用(..)');
      result.riskLevel = 'high';
    }

    // Check for absolute paths (might be dangerous)
    if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) {
      result.warnings.push('检测到绝对路径，请使用相对路径');
    }

    // Check for dangerous characters
    const dangerousChars = ['<', '>', '|', ';', '&', '$', '`', '\n', '\r'];
    for (const char of dangerousChars) {
      if (filePath.includes(char)) {
        result.errors.push(`路径不能包含字符: ${char}`);
        result.riskLevel = 'high';
      }
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Validate command arguments
   */
  validateCommandArgs(args: string[]): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      errors: [],
      warnings: [],
      riskLevel: 'low',
    };

    for (const arg of args) {
      // Check each argument
      const validation = this.validateUserInput(arg);

      if (!validation.valid) {
        result.errors.push(`参数 "${arg}" 无效: ${validation.errors.join(', ')}`);
        result.riskLevel = 'high';
      }

      if (validation.warnings.length > 0) {
        result.warnings.push(`参数 "${arg}" 有警告: ${validation.warnings.join(', ')}`);
      }
    }

    result.valid = result.errors.length === 0;
    return result;
  }

  /**
   * Enable or disable the validator
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info({ enabled }, 'Input validator state changed');
  }

  /**
   * Set strict mode
   */
  setStrictMode(strict: boolean): void {
    this.strictMode = strict;
    logger.info({ strict }, 'Strict mode changed');
  }

  /**
   * Check if validator is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get current configuration
   */
  getConfig(): {
    enabled: boolean;
    strictMode: boolean;
    sizeLimits: typeof SIZE_LIMITS;
  } {
    return {
      enabled: this.enabled,
      strictMode: this.strictMode,
      sizeLimits: SIZE_LIMITS,
    };
  }
}

// Singleton instance
let inputValidator: InputValidator | null = null;

export function getInputValidator(): InputValidator {
  if (!inputValidator) {
    inputValidator = new InputValidator();
  }
  return inputValidator;
}

/**
 * Convenience function to validate user input
 */
export function validateUserInput(input: string, context?: { isPrompt?: boolean }): ValidationResult {
  return getInputValidator().validateUserInput(input, context);
}

/**
 * Convenience function to validate file path
 */
export function validateFilePath(filePath: string): ValidationResult {
  return getInputValidator().validateFilePath(filePath);
}
