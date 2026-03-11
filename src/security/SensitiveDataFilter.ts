/**
 * Sensitive Data Filter
 * Detects and sanitizes sensitive information before sending to external services
 */

import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('SensitiveDataFilter');

/**
 * Risk levels for sensitive data
 */
export enum RiskLevel {
  LOW = 'low',       // Email, IP address - allow with masking
  MEDIUM = 'medium', // Phone, address - warn and mask
  HIGH = 'high',     // Password, token - block and alert
  CRITICAL = 'critical' // API keys, secrets - completely block
}

/**
 * Detection result
 */
export interface DetectionResult {
  hasSensitiveData: boolean;
  riskLevel: RiskLevel;
  detections: SensitiveDataMatch[];
  sanitizedContent?: string;
  shouldBlock: boolean;
}

/**
 * Sensitive data match
 */
export interface SensitiveDataMatch {
  type: string;
  riskLevel: RiskLevel;
  match: string;
  startPosition: number;
  endPosition: number;
  recommendedAction: 'block' | 'mask' | 'allow';
}

/**
 * Pattern definitions for sensitive data detection
 */
const SENSITIVITY_PATTERNS: Array<{
  name: string;
  riskLevel: RiskLevel;
  pattern: RegExp;
  recommendedAction: 'block' | 'mask' | 'allow';
}> = [
  // API Keys - CRITICAL
  {
    name: 'OpenAI API Key',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b(sk-[a-zA-Z0-9]{15,})\b/g,
    recommendedAction: 'block'
  },
  {
    name: 'API Key (general)',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b(api[_-]?key[_-]?[a-zA-Z0-9]{10,})\b/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Zhipu API Key',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b([a-f0-9]{32}\.[a-z0-9]{16})\b/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Hex API Key',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b([a-f0-9]{32,})\b/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Bearer Token',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b(Bearer [a-zA-Z0-9\-._~+/]+=*)\b/gi,
    recommendedAction: 'block'
  },

  // JWT Tokens - HIGH
  {
    name: 'JWT Token',
    riskLevel: RiskLevel.HIGH,
    pattern: /\b(eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g,
    recommendedAction: 'block'
  },

  // Passwords - HIGH
  {
    name: 'Password in connection string',
    riskLevel: RiskLevel.HIGH,
    pattern: /:([^:@\s\/]{6,})@/g,
    recommendedAction: 'block'
  },
  {
    name: 'Password parameter',
    riskLevel: RiskLevel.HIGH,
    pattern: /(password|passwd|pass)[:\s=]+([^\s,;]{6,})/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Env variable with secret',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /[a-zA-Z_]+_(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD)[\s=]+[^\s]+/gi,
    recommendedAction: 'block'
  },

  // Personal Information - MEDIUM
  {
    name: 'Email address',
    riskLevel: RiskLevel.MEDIUM,
    pattern: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
    recommendedAction: 'mask'
  },
  {
    name: 'IP address',
    riskLevel: RiskLevel.MEDIUM,
    pattern: /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g,
    recommendedAction: 'mask'
  },
  {
    name: 'Phone number (CN)',
    riskLevel: RiskLevel.MEDIUM,
    pattern: /\b(1[3-9]\d{9})\b/g,
    recommendedAction: 'mask'
  },

  // Secrets - CRITICAL
  {
    name: 'Secret key',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b(secret[_-]?key[_-]?[a-zA-Z0-9]{10,})\b/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Access token',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /\b(access[_-]?token[_-]?[a-zA-Z0-9]{20,})\b/gi,
    recommendedAction: 'block'
  },
  {
    name: 'Private key',
    riskLevel: RiskLevel.CRITICAL,
    pattern: /-----BEGIN [A-Z]+ PRIVATE KEY-----/g,
    recommendedAction: 'block'
  }
];

/**
 * Maximum allowed sensitive data count before blocking
 */
const MAX_MEDIUM_RISK_COUNT = 3;
const MAX_HIGH_RISK_COUNT = 1;

/**
 * Sensitive Data Filter class
 */
export class SensitiveDataFilter {
  private enabled: boolean = true;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /**
   * Scan content for sensitive data
   */
  scan(content: string): DetectionResult {
    if (!this.enabled) {
      return {
        hasSensitiveData: false,
        riskLevel: RiskLevel.LOW,
        detections: [],
        shouldBlock: false
      };
    }

    const detections: SensitiveDataMatch[] = [];
    let maxRiskLevel = RiskLevel.LOW;
    let highRiskCount = 0;
    let mediumRiskCount = 0;

    // Scan for each pattern
    for (const patternDef of SENSITIVITY_PATTERNS) {
      const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
      let match;

      while ((match = regex.exec(content)) !== null) {
        const detection: SensitiveDataMatch = {
          type: patternDef.name,
          riskLevel: patternDef.riskLevel,
          match: match[0],
          startPosition: match.index,
          endPosition: match.index + match[0].length,
          recommendedAction: patternDef.recommendedAction
        };

        detections.push(detection);

        // Track risk levels
        if (patternDef.riskLevel === RiskLevel.CRITICAL || patternDef.riskLevel === RiskLevel.HIGH) {
          highRiskCount++;
        } else if (patternDef.riskLevel === RiskLevel.MEDIUM) {
          mediumRiskCount++;
        }

        // Update max risk level
        if (this.compareRiskLevel(patternDef.riskLevel, maxRiskLevel) > 0) {
          maxRiskLevel = patternDef.riskLevel;
        }
      }
    }

    // Determine if content should be blocked
    let shouldBlock = false;
    if (maxRiskLevel === RiskLevel.CRITICAL || maxRiskLevel === RiskLevel.HIGH) {
      shouldBlock = highRiskCount > 0;
    } else if (maxRiskLevel === RiskLevel.MEDIUM) {
      shouldBlock = mediumRiskCount > MAX_MEDIUM_RISK_COUNT;
    }

    // Sanitize content if not blocking
    let sanitizedContent: string | undefined;
    if (!shouldBlock && detections.length > 0) {
      sanitizedContent = this.sanitize(content, detections);
    }

    const result: DetectionResult = {
      hasSensitiveData: detections.length > 0,
      riskLevel: maxRiskLevel,
      detections,
      sanitizedContent,
      shouldBlock
    };

    // Log detection
    if (detections.length > 0) {
      logger.warn({
        count: detections.length,
        riskLevel: maxRiskLevel,
        shouldBlock,
        types: detections.map(d => d.type)
      }, 'Sensitive data detected');
    }

    return result;
  }

  /**
   * Sanitize content by masking sensitive data
   */
  private sanitize(content: string, detections: SensitiveDataMatch[]): string {
    let sanitized = content;

    // Sort detections by position (reverse order to avoid index shifting)
    const sortedDetections = [...detections].sort((a, b) => b.startPosition - a.startPosition);

    for (const detection of sortedDetections) {
      if (detection.recommendedAction === 'mask') {
        const mask = this.createMask(detection.match, detection.type);
        sanitized =
          sanitized.substring(0, detection.startPosition) +
          mask +
          sanitized.substring(detection.endPosition);
      }
    }

    return sanitized;
  }

  /**
   * Create masked version of sensitive data
   */
  private createMask(value: string, type: string): string {
    // Special handling for email addresses
    if (type.includes('Email')) {
      const atIndex = value.indexOf('@');
      if (atIndex > 0) {
        const username = value.substring(0, atIndex);
        const domain = value.substring(atIndex);

        // Show first 2 chars of username, mask the rest
        const visibleChars = Math.min(2, username.length);
        const maskedUsername = username.substring(0, visibleChars) + '*'.repeat(username.length - visibleChars);
        return maskedUsername + domain;
      }
    }

    // For other types: Keep first and last few characters, mask the middle
    if (value.length <= 8) {
      return '*'.repeat(value.length);
    }

    const keepStart = 2;
    const keepEnd = 2;
    const maskedLength = value.length - keepStart - keepEnd;

    return value.substring(0, keepStart) + '*'.repeat(maskedLength) + value.substring(value.length - keepEnd);
  }

  /**
   * Compare risk levels
   */
  private compareRiskLevel(level1: RiskLevel, level2: RiskLevel): number {
    const levels = { low: 0, medium: 1, high: 2, critical: 3 };
    return levels[level1] - levels[level2];
  }

  /**
   * Enable/disable the filter
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info({ enabled }, 'Filter state changed');
  }

  /**
   * Check if filter is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance
let filterInstance: SensitiveDataFilter | null = null;

/**
 * Get the singleton filter instance
 */
export function getSensitiveDataFilter(): SensitiveDataFilter {
  if (!filterInstance) {
    filterInstance = new SensitiveDataFilter(true);
  }
  return filterInstance;
}

/**
 * Convenience function to scan content
 */
export function scanForSensitiveData(content: string): DetectionResult {
  return getSensitiveDataFilter().scan(content);
}

/**
 * Convenience function to check if content should be blocked
 */
export function shouldBlockContent(content: string): boolean {
  const result = scanForSensitiveData(content);
  return result.shouldBlock;
}

/**
 * Convenience function to get sanitized content
 */
export function getSanitizedContent(content: string): string {
  const result = scanForSensitiveData(content);
  return result.sanitizedContent || content;
}
