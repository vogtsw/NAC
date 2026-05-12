/**
 * Secure Session Store
 * Extends SessionStore with encryption for sensitive data
 * Provides input-side sanitization and secure storage
 */

import { SessionStore, SessionMessage } from '../state/SessionStore.js';
import { getSensitiveDataFilter, DetectionResult, RiskLevel } from './SensitiveDataFilter.js';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync, timingSafeEqual } from 'crypto';
import type { CipherGCM, DecipherGCM } from 'crypto';
import { getLogger } from '../monitoring/logger.js';
import { promises as fs } from 'fs';

const logger = getLogger('SecureSessionStore');

/**
 * Encryption configuration
 */
interface EncryptionConfig {
  algorithm: string; // e.g., 'aes-256-gcm'
  keyLength: number; // in bytes
  ivLength: number;  // in bytes
  saltLength: number; // in bytes
}

/**
 * Encrypted data structure
 */
interface EncryptedData {
  iv: string;        // Initialization vector
  salt: string;      // Salt for key derivation
  authTag: string;   // Authentication tag for GCM
  data: string;      // Encrypted data (hex)
  version: number;   // Encryption version
}

/**
 * Input validation result
 */
export interface InputValidationResult {
  clean: boolean;
  sanitized: string;
  warnings: string[];
  detections: Array<{
    type: string;
    riskLevel: RiskLevel;
    action: 'blocked' | 'masked' | 'allowed';
  }>;
}

/**
 * Secure Session Store - adds encryption and input sanitization
 */
export class SecureSessionStore extends SessionStore {
  private encryptionKey: Buffer;
  private encryptionConfig: EncryptionConfig;

  constructor(baseDir?: string, encryptionKey?: string) {
    super(baseDir);

    // Initialize encryption
    this.encryptionConfig = {
      algorithm: 'aes-256-gcm',
      keyLength: 32, // 256 bits
      ivLength: 16,  // 128 bits
      saltLength: 32,
    };

    // Get or derive encryption key
    if (encryptionKey) {
      // Use provided key (hex format)
      this.encryptionKey = Buffer.from(encryptionKey, 'hex');
    } else if (process.env.SESSION_ENCRYPTION_KEY) {
      // Use key from environment
      this.encryptionKey = Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'hex');
    } else {
      // Generate a warning - in production, this should be configured
      logger.warn('No encryption key provided, using insecure default. Set SESSION_ENCRYPTION_KEY environment variable!');
      // Generate a temporary key (NOT SECURE - only for development)
      this.encryptionKey = randomBytes(this.encryptionConfig.keyLength);
    }

    if (this.encryptionKey.length !== this.encryptionConfig.keyLength) {
      throw new Error(`Encryption key must be ${this.encryptionConfig.keyLength * 2} hex characters`);
    }

    logger.info({ keyLength: this.encryptionKey.length }, 'SecureSessionStore initialized with encryption');
  }

  /**
   * Validate and sanitize input before processing
   */
  async validateInput(userInput: string): Promise<InputValidationResult> {
    const filter = getSensitiveDataFilter();
    const result: InputValidationResult = {
      clean: true,
      sanitized: userInput,
      warnings: [],
      detections: [],
    };

    // Scan for sensitive data
    const scanResult = filter.scan(userInput);

    if (scanResult.hasSensitiveData) {
      result.warnings.push(`检测到 ${scanResult.detections.length} 处敏感数据`);

      // Process each detection
      for (const detection of scanResult.detections) {
        const action = this.determineAction(detection.riskLevel, detection.recommendedAction);
        result.detections.push({
          type: detection.type,
          riskLevel: detection.riskLevel,
          action,
        });

        if (action === 'blocked') {
          result.clean = false;
          result.warnings.push(`- 已阻止: ${detection.type}`);
        } else if (action === 'masked') {
          result.warnings.push(`- 已隐藏: ${detection.type}`);
        }
      }

      // If not blocked, use sanitized content
      if (!scanResult.shouldBlock) {
        result.sanitized = scanResult.sanitizedContent || userInput;
      } else {
        // Content should be blocked
        result.sanitized = userInput; // Don't modify if blocking
      }
    }

    // Log validation result
    if (result.warnings.length > 0) {
      logger.warn({
        clean: result.clean,
        warningCount: result.warnings.length,
        detections: result.detections.length,
      }, 'Input validation completed with warnings');
    }

    return result;
  }

  /**
   * Determine action for detected sensitive data
   */
  private determineAction(riskLevel: RiskLevel, recommendedAction: string): 'blocked' | 'masked' | 'allowed' {
    if (riskLevel === RiskLevel.CRITICAL) {
      return 'blocked';
    } else if (riskLevel === RiskLevel.HIGH) {
      return 'blocked';
    } else if (riskLevel === RiskLevel.MEDIUM) {
      return 'masked';
    }
    return 'allowed';
  }

  /**
   * Add a message with input validation and encryption
   */
  async addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    // Only validate user input (not system/assistant responses)
    if (role === 'user') {
      const validation = await this.validateInput(content);

      if (!validation.clean) {
        logger.warn({ sessionId, warnings: validation.warnings }, 'User input contains blocked sensitive data');
        throw new Error(`输入包含禁止的敏感数据: ${validation.warnings.join(', ')}`);
      }

      // Use sanitized content
      content = validation.sanitized;

      if (validation.warnings.length > 0) {
        logger.info({ sessionId, warnings: validation.warnings }, 'User input was sanitized');
      }
    }

    // Encrypt sensitive content before storing
    const encryptedContent = this.encryptContent(content);

    // Store encrypted content with marker
    const marker = '---ENCRYPTED---\n';
    await super.addMessage(sessionId, role, marker + encryptedContent);
  }

  /**
   * Get session messages with decryption
   */
  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const messages = await super.getSessionMessages(sessionId);

    // Decrypt messages that were encrypted
    return messages.map(msg => {
      if (msg.content.startsWith('---ENCRYPTED---\n')) {
        const encryptedData = msg.content.replace('---ENCRYPTED---\n', '');
        try {
          return {
            ...msg,
            content: this.decryptContent(encryptedData),
          };
        } catch (error: any) {
          logger.error({ sessionId, error: error.message }, 'Failed to decrypt message');
          return msg;
        }
      }
      return msg;
    });
  }

  /**
   * Encrypt content
   */
  private encryptContent(content: string): string {
    try {
      // Generate random IV and salt
      const iv = randomBytes(this.encryptionConfig.ivLength);
      const salt = randomBytes(this.encryptionConfig.saltLength);

      // Derive key using scrypt
      const key = scryptSync(this.encryptionKey, salt, this.encryptionConfig.keyLength);

      // Create cipher
      const cipher = createCipheriv(this.encryptionConfig.algorithm, key, iv) as CipherGCM;

      // Encrypt content
      const encrypted = Buffer.concat([
        cipher.update(content, 'utf8'),
        cipher.final(),
      ]);

      // Get auth tag
      const authTag = cipher.getAuthTag();

      // Pack into encrypted data structure
      const encryptedData: EncryptedData = {
        iv: iv.toString('hex'),
        salt: salt.toString('hex'),
        authTag: authTag.toString('hex'),
        data: encrypted.toString('hex'),
        version: 1,
      };

      return JSON.stringify(encryptedData);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Encryption failed');
      throw new Error(`Failed to encrypt content: ${error.message}`);
    }
  }

  /**
   * Decrypt content
   */
  private decryptContent(encryptedJson: string): string {
    try {
      const encryptedData: EncryptedData = JSON.parse(encryptedJson);

      // Validate version
      if (encryptedData.version !== 1) {
        throw new Error(`Unsupported encryption version: ${encryptedData.version}`);
      }

      // Parse encrypted data
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const salt = Buffer.from(encryptedData.salt, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      const encrypted = Buffer.from(encryptedData.data, 'hex');

      // Derive key using scrypt
      const key = scryptSync(this.encryptionKey, salt, this.encryptionConfig.keyLength);

      // Create decipher
      const decipher = createDecipheriv(this.encryptionConfig.algorithm, key, iv) as DecipherGCM;
      decipher.setAuthTag(authTag);

      // Decrypt content
      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Decryption failed');
      throw new Error(`Failed to decrypt content: ${error.message}`);
    }
  }

  /**
   * Generate a secure encryption key for new installations
   */
  static generateEncryptionKey(): string {
    const keyLength = 32; // 256 bits
    const key = randomBytes(keyLength);
    return key.toString('hex');
  }

  /**
   * Hash sensitive data for comparison (one-way)
   */
  hashForComparison(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Securely compare two values (constant-time)
   */
  secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    // Use crypto.timingSafeEqual if available (Node.js 6.6.0+)
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);

    try {
      return timingSafeEqual(aBuffer, bBuffer);
    } catch {
      // Fallback for older Node.js versions
      let result = 0;
      for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
      }
      return result === 0;
    }
  }
}

/**
 * Input Sanitization Middleware
 */
export class InputSanitizationMiddleware {
  private sessionStore: SecureSessionStore;

  constructor(sessionStore: SecureSessionStore) {
    this.sessionStore = sessionStore;
  }

  /**
   * Process user input through sanitization pipeline
   */
  async process(userInput: string, sessionId?: string): Promise<{
    clean: boolean;
    sanitized: string;
    warnings: string[];
    shouldProceed: boolean;
  }> {
    const validation = await this.sessionStore.validateInput(userInput);

    return {
      clean: validation.clean,
      sanitized: validation.sanitized,
      warnings: validation.warnings,
      shouldProceed: validation.clean,
    };
  }

  /**
   * Log security events
   */
  async logSecurityEvent(event: {
    type: 'sensitive_data_detected' | 'input_blocked' | 'input_sanitized';
    sessionId?: string;
    details: any;
  }): Promise<void> {
    logger.warn({
      eventType: event.type,
      sessionId: event.sessionId,
      details: event.details,
    }, 'Security event logged');

    // In production, this would write to a security audit log
    // For now, just log to console
  }
}

// Singleton instance
let secureSessionStore: SecureSessionStore | null = null;

export function getSecureSessionStore(): SecureSessionStore {
  if (!secureSessionStore) {
    secureSessionStore = new SecureSessionStore();
  }
  return secureSessionStore;
}

export function createSecureSessionStore(baseDir?: string, encryptionKey?: string): SecureSessionStore {
  return new SecureSessionStore(baseDir, encryptionKey);
}
