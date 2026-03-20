/**
 * Skill Permission Manager
 * Manages skill permissions and enforces access control
 * Prevents unauthorized access to system resources
 */

import { Permission, SkillPermissions } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('SkillPermissionManager');

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  granted: boolean;
  reason?: string;
  requiredPermission: Permission;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: Date;
  skillId: string;
  operation: string;
  permissions: Permission[];
  params: any;
  result: 'success' | 'failure' | 'blocked';
  reason?: string;
}

/**
 * Skill Permission Manager - enforces permission-based access control
 */
export class SkillPermissionManager {
  private permissions: Map<string, SkillPermissions> = new Map();
  private auditLog: AuditLogEntry[] = [];
  private auditEnabled: boolean = true;

  constructor() {
    this.initializeDefaultPermissions();
  }

  /**
   * Initialize default skill permissions
   */
  private initializeDefaultPermissions(): void {
    // File operations skill
    this.registerSkillPermissions({
      skillId: 'file-ops',
      permissions: [Permission.FILE_READ, Permission.FILE_WRITE],
      resourceLimits: {
        maxFileSize: 10 * 1024 * 1024, // 10MB
        maxExecutionTime: 30000, // 30 seconds
        allowedPaths: [process.cwd()],
      },
      audit: true,
    });

    // Terminal execution skill (dangerous)
    this.registerSkillPermissions({
      skillId: 'terminal-exec',
      permissions: [Permission.SYSTEM_EXEC],
      resourceLimits: {
        maxExecutionTime: 10000, // 10 seconds
      },
      audit: true, // Dangerous operations must be audited
    });

    // Web search skill
    this.registerSkillPermissions({
      skillId: 'web-search',
      permissions: [Permission.NETWORK_HTTPS],
      audit: true,
    });

    // Code generation skill
    this.registerSkillPermissions({
      skillId: 'code-generation',
      permissions: [Permission.FILE_WRITE, Permission.FILE_READ],
      resourceLimits: {
        maxFileSize: 5 * 1024 * 1024, // 5MB
        maxExecutionTime: 60000, // 1 minute
      },
      audit: false,
    });

    // Data analysis skill
    this.registerSkillPermissions({
      skillId: 'data-analysis',
      permissions: [Permission.FILE_READ],
      audit: false,
    });

    // Code review skill
    this.registerSkillPermissions({
      skillId: 'code-review',
      permissions: [Permission.FILE_READ],
      audit: false,
    });

    logger.info({ defaultSkills: this.permissions.size }, 'Default skill permissions initialized');
  }

  /**
   * Register or update skill permissions
   */
  registerSkillPermissions(permissions: SkillPermissions): void {
    this.permissions.set(permissions.skillId, permissions);
    logger.info({
      skillId: permissions.skillId,
      permissionCount: permissions.permissions.length,
      audit: permissions.audit,
    }, 'Skill permissions registered');
  }

  /**
   * Check if a skill has a specific permission
   */
  checkPermission(skillId: string, requiredPermission: Permission): PermissionCheckResult {
    const skillPerms = this.permissions.get(skillId);

    if (!skillPerms) {
      logger.warn({ skillId, requiredPermission }, 'Skill not registered in permission manager');
      return {
        granted: false,
        reason: `Skill '${skillId}' is not registered in the permission manager`,
        requiredPermission,
      };
    }

    const hasPermission = skillPerms.permissions.includes(requiredPermission);

    if (!hasPermission) {
      logger.warn({
        skillId,
        requiredPermission,
        availablePermissions: skillPerms.permissions,
      }, 'Permission check failed');

      return {
        granted: false,
        reason: `Skill '${skillId}' does not have permission: ${requiredPermission}`,
        requiredPermission,
      };
    }

    logger.debug({ skillId, requiredPermission }, 'Permission check passed');
    return {
      granted: true,
      requiredPermission,
    };
  }

  /**
   * Check multiple permissions at once
   */
  checkPermissions(skillId: string, requiredPermissions: Permission[]): PermissionCheckResult {
    for (const permission of requiredPermissions) {
      const check = this.checkPermission(skillId, permission);
      if (!check.granted) {
        return check;
      }
    }

    return {
      granted: true,
      requiredPermission: requiredPermissions[0], // First permission
    };
  }

  /**
   * Validate resource limits before execution
   */
  validateResourceLimits(
    skillId: string,
    operation: string,
    params: any
  ): { allowed: boolean; reason?: string } {
    const skillPerms = this.permissions.get(skillId);

    if (!skillPerms || !skillPerms.resourceLimits) {
      return { allowed: true }; // No limits defined
    }

    const limits = skillPerms.resourceLimits;

    // Check file size limit
    if (params.content || params.data) {
      const size = Buffer.byteLength(params.content || params.data, 'utf8');
      if (size > limits.maxFileSize) {
        return {
          allowed: false,
          reason: `Content size (${size} bytes) exceeds maximum allowed size (${limits.maxFileSize} bytes)`,
        };
      }
    }

    // Check execution time limit (will be enforced by timeout)
    if (params.timeout && params.timeout > limits.maxExecutionTime) {
      logger.warn({
        skillId,
        requestedTimeout: params.timeout,
        maxTimeout: limits.maxExecutionTime,
      }, 'Requested timeout exceeds limit, will be capped');
    }

    // Check path restrictions
    if (limits.allowedPaths && limits.allowedPaths.length > 0) {
      if (params.path) {
        const allowed = limits.allowedPaths.some(allowedPath =>
          params.path.startsWith(allowedPath)
        );

        if (!allowed) {
          return {
            allowed: false,
            reason: `Path '${params.path}' is not within allowed paths: ${limits.allowedPaths.join(', ')}`,
          };
        }
      }
    }

    return { allowed: true };
  }

  /**
   * Audit skill execution
   */
  async auditSkillExecution(
    skillId: string,
    operation: string,
    params: any,
    result: { success: boolean; error?: string }
  ): Promise<void> {
    const skillPerms = this.permissions.get(skillId);

    // Only audit if enabled for this skill or globally
    if (!this.auditEnabled || (!skillPerms?.audit && !this.isDangerousOperation(operation))) {
      return;
    }

    const entry: AuditLogEntry = {
      timestamp: new Date(),
      skillId,
      operation,
      permissions: skillPerms?.permissions || [],
      params: this.sanitizeParams(params),
      result: result.success ? 'success' : 'failure',
      reason: result.error,
    };

    this.auditLog.push(entry);

    logger.info({
      skillId,
      operation,
      success: result.success,
      auditLogSize: this.auditLog.length,
    }, 'Skill execution audited');

    // Check if we should trim the audit log
    if (this.auditLog.length > 10000) {
      // Keep only the last 10000 entries
      this.auditLog = this.auditLog.slice(-10000);
      logger.debug('Audit log trimmed to 10000 entries');
    }
  }

  /**
   * Check if an operation is considered dangerous
   */
  private isDangerousOperation(operation: string): boolean {
    const dangerousOps = ['delete', 'exec', 'remove', 'execute', 'system'];
    return dangerousOps.some(dangerous => operation.toLowerCase().includes(dangerous));
  }

  /**
   * Sanitize parameters for audit logging (remove sensitive data)
   */
  private sanitizeParams(params: any): any {
    if (!params || typeof params !== 'object') {
      return params;
    }

    const sanitized: any = {};
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'api_key', 'api-key'];

    for (const [key, value] of Object.entries(params)) {
      const isSensitive = sensitiveKeys.some(sensitive =>
        key.toLowerCase().includes(sensitive)
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeParams(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Get audit log entries
   */
  getAuditLog(options?: {
    skillId?: string;
    limit?: number;
    offset?: number;
  }): AuditLogEntry[] {
    let log = this.auditLog;

    // Filter by skill ID if specified
    if (options?.skillId) {
      log = log.filter(entry => entry.skillId === options.skillId);
    }

    // Sort by timestamp (newest first)
    log = log.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply offset and limit
    const offset = options?.offset || 0;
    const limit = options?.limit || 100;

    return log.slice(offset, offset + limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalSkills: number;
    auditedSkills: number;
    auditLogSize: number;
    permissionDistribution: Record<string, number>;
  } {
    const permissionDistribution: Record<string, number> = {};

    for (const skillPerms of this.permissions.values()) {
      for (const perm of skillPerms.permissions) {
        permissionDistribution[perm] = (permissionDistribution[perm] || 0) + 1;
      }
    }

    return {
      totalSkills: this.permissions.size,
      auditedSkills: Array.from(this.permissions.values()).filter(p => p.audit).length,
      auditLogSize: this.auditLog.length,
      permissionDistribution,
    };
  }

  /**
   * Enable or disable auditing
   */
  setAuditEnabled(enabled: boolean): void {
    this.auditEnabled = enabled;
    logger.info({ enabled }, 'Audit logging state changed');
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    logger.info('Audit log cleared');
  }

  /**
   * Get skill permissions
   */
  getSkillPermissions(skillId: string): SkillPermissions | undefined {
    return this.permissions.get(skillId);
  }

  /**
   * List all registered skills
   */
  listRegisteredSkills(): string[] {
    return Array.from(this.permissions.keys());
  }

  /**
   * Remove skill permissions (for dynamic skill unloading)
   */
  unregisterSkill(skillId: string): boolean {
    const deleted = this.permissions.delete(skillId);
    if (deleted) {
      logger.info({ skillId }, 'Skill permissions unregistered');
    }
    return deleted;
  }
}

// Singleton instance
let skillPermissionManager: SkillPermissionManager | null = null;

export function getSkillPermissionManager(): SkillPermissionManager {
  if (!skillPermissionManager) {
    skillPermissionManager = new SkillPermissionManager();
  }
  return skillPermissionManager;
}

/**
 * Decorator to add permission checking to any async function
 */
export function withPermissionCheck(
  skillId: string,
  requiredPermissions: Permission[]
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const manager = getSkillPermissionManager();

      // Check permissions
      const check = manager.checkPermissions(skillId, requiredPermissions);
      if (!check.granted) {
        throw new Error(`Permission denied: ${check.reason}`);
      }

      // Execute original method
      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
