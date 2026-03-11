/**
 * Sandbox Manager
 * Provides comprehensive sandbox isolation for NAC operations
 * - Command execution restrictions
 * - File system access control
 * - Network access control
 * - Resource limits
 */

import { getLogger } from '../monitoring/logger.js';
import { resolve } from 'path';

const logger = getLogger('SandboxManager');

/**
 * Sandbox security level
 */
export enum SandboxLevel {
  STRICT = 'strict',       // 最严格模式 - 最小权限
  MODERATE = 'moderate',   // 适度模式 - 开发环境
  PERMISSIVE = 'permissive' // 宽松模式 - 生产环境
}

/**
 * Command category for classification
 */
export enum CommandCategory {
  SAFE = 'safe',           // 完全安全的命令
  RESTRICTED = 'restricted', // 受限命令，需要特殊权限
  DANGEROUS = 'dangerous',  // 危险命令，默认禁止
  NETWORK = 'network',      // 网络相关命令
  SYSTEM = 'system'         // 系统管理命令
}

/**
 * Command rule definition
 */
export interface CommandRule {
  command: string;           // 命令名称
  category: CommandCategory; // 命令分类
  allowed: boolean;          // 是否允许
  requiresApproval: boolean; // 是否需要额外批准
  maxArgs?: number;          // 最大参数数量
  allowedFlags?: string[];   // 允许的标志
  deniedFlags?: string[];    // 禁止的标志
  description?: string;      // 命令描述
}

/**
 * Path access rule
 */
export interface PathRule {
  path: string;              // 路径模式
  allowed: boolean;          // 是否允许访问
  readOnly: boolean;         // 是否只读
  recursive: boolean;        // 是否递归应用于子目录
  description?: string;
}

/**
 * Network access rule
 */
export interface NetworkRule {
  host: string;              // 主机名或IP
  port?: number;             // 端口号
  allowed: boolean;          // 是否允许访问
  protocol?: 'http' | 'https' | 'ws' | 'wss'; // 协议限制
}

/**
 * Resource limits
 */
export interface ResourceLimits {
  maxExecutionTime: number;  // 最大执行时间(毫秒)
  maxMemory: number;         // 最大内存使用(MB)
  maxCpuUsage: number;       // 最大CPU使用率(%)
  maxFileSize: number;       // 最大文件大小(MB)
  maxProcesses: number;      // 最大进程数
}

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  level: SandboxLevel;
  commandWhitelist: CommandRule[];
  pathWhitelist: PathRule[];
  networkRules: NetworkRule[];
  resourceLimits: ResourceLimits;
  enableLogging: boolean;
  enableAudit: boolean;
}

/**
 * Default safe commands (file operations, text processing, etc.)
 */
const DEFAULT_SAFE_COMMANDS: CommandRule[] = [
  // File operations
  { command: 'ls', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'List directory contents' },
  { command: 'cat', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, maxArgs: 10, description: 'Concatenate and display files' },
  { command: 'head', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, maxArgs: 5, description: 'Output the first part of files' },
  { command: 'tail', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, maxArgs: 5, description: 'Output the last part of files' },
  { command: 'grep', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Print lines matching a pattern' },
  { command: 'find', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Search for files in a directory hierarchy' },
  { command: 'wc', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Print newline, word, and byte counts' },
  { command: 'sort', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Sort lines of text files' },
  { command: 'uniq', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Report or omit repeated lines' },
  { command: 'diff', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, maxArgs: 2, description: 'Compare files line by line' },

  // Text processing
  { command: 'echo', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Display a line of text' },
  { command: 'printf', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Format and print data' },
  { command: 'sed', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, deniedFlags: ['-i'], description: 'Stream editor' }, // -i can modify files
  { command: 'awk', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Pattern scanning and processing language' },

  // Development tools
  { command: 'node', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Execute Node.js scripts' },
  { command: 'npm', category: CommandCategory.RESTRICTED, allowed: true, requiresApproval: true, description: 'Node.js package manager' },
  { command: 'pnpm', category: CommandCategory.RESTRICTED, allowed: true, requiresApproval: true, description: 'Fast, disk space efficient package manager' },
  { command: 'tsx', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'TypeScript executor' },
  { command: 'tsc', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'TypeScript compiler' },
  { command: 'git', category: CommandCategory.RESTRICTED, allowed: true, requiresApproval: true, description: 'Version control system' },

  // System information (read-only)
  { command: 'pwd', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Print name of current/working directory' },
  { command: 'whoami', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Print current user' },
  { command: 'date', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Print or set system date and time' },
  { command: 'uname', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, allowedFlags: ['-a', '-r', '-v', '-m'], description: 'Print system information' },
  { command: 'df', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Report file system disk space usage' },
  { command: 'du', category: CommandCategory.SAFE, allowed: true, requiresApproval: false, description: 'Estimate file space usage' },
];

/**
 * Dangerous commands (always blocked)
 */
const DANGEROUS_COMMANDS: CommandRule[] = [
  { command: 'rm', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Remove files or directories' },
  { command: 'rmdir', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Remove empty directories' },
  { command: 'mv', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Move (rename) files' },
  { command: 'cp', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Copy files and directories' },
  { command: 'chmod', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Change file mode bits' },
  { command: 'chown', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Change file owner and group' },
  { command: 'dd', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Convert and copy a file' },
  { command: 'mkfs', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Build a Linux filesystem' },
  { command: 'fdisk', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Partition table manipulator' },
  { command: 'shutdown', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Halt, power-off or reboot the machine' },
  { command: 'reboot', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Halt, power-off or reboot the machine' },
  { command: 'kill', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Send a signal to a process' },
  { command: 'killall', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Kill processes by name' },
  { command: 'su', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Substitute user identity' },
  { command: 'sudo', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Execute a command as another user' },
  { command: 'passwd', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Change user password' },
  { command: 'useradd', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Create a new user' },
  { command: 'userdel', category: CommandCategory.DANGEROUS, allowed: false, requiresApproval: true, description: 'Delete a user account' },
  { command: 'curl', category: CommandCategory.NETWORK, allowed: false, requiresApproval: true, description: 'Transfer data from or to a server' },
  { command: 'wget', category: CommandCategory.NETWORK, allowed: false, requiresApproval: true, description: 'Network downloader' },
  { command: 'ssh', category: CommandCategory.NETWORK, allowed: false, requiresApproval: true, description: 'OpenSSH SSH client' },
  { command: 'nc', category: CommandCategory.NETWORK, allowed: false, requiresApproval: true, description: 'Netcat - arbitrary TCP and UDP connections' },
  { command: 'telnet', category: CommandCategory.NETWORK, allowed: false, requiresApproval: true, description: 'User interface to the TELNET protocol' },
];

/**
 * Default path whitelist
 */
const DEFAULT_PATH_WHITELIST: PathRule[] = [
  { path: process.cwd(), allowed: true, readOnly: false, recursive: true, description: 'Current working directory' },
  { path: `${process.cwd()}/src`, allowed: true, readOnly: false, recursive: true, description: 'Source code directory' },
  { path: `${process.cwd()}/tests`, allowed: true, readOnly: false, recursive: true, description: 'Tests directory' },
  { path: `${process.cwd()}/docs`, allowed: true, readOnly: false, recursive: true, description: 'Documentation directory' },
  { path: `${process.cwd()}/config`, allowed: true, readOnly: false, recursive: true, description: 'Configuration directory' },
  { path: `${process.cwd()}/memory`, allowed: true, readOnly: false, recursive: true, description: 'Memory directory' },
  { path: `${process.cwd()}/skills`, allowed: true, readOnly: false, recursive: true, description: 'Skills directory' },
  { path: `${process.cwd()}/temp`, allowed: true, readOnly: false, recursive: true, description: 'Temporary directory' },
  { path: '/tmp', allowed: true, readOnly: false, recursive: true, description: 'System temporary directory' },
  { path: process.env.HOME || '/home/user', allowed: true, readOnly: true, recursive: false, description: 'User home directory (read-only)' },
];

/**
 * Default resource limits
 */
const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxExecutionTime: 30000,    // 30 seconds
  maxMemory: 512,             // 512 MB
  maxCpuUsage: 80,            // 80%
  maxFileSize: 10,            // 10 MB
  maxProcesses: 10,           // 10 processes
};

/**
 * Sandbox Manager class
 */
export class SandboxManager {
  private config: SandboxConfig;
  private auditLog: Array<{
    timestamp: Date;
    operation: string;
    details: any;
    allowed: boolean;
    reason?: string;
  }> = [];

  constructor(config?: Partial<SandboxConfig>) {
    this.config = {
      level: SandboxLevel.MODERATE,
      commandWhitelist: [...DEFAULT_SAFE_COMMANDS, ...DANGEROUS_COMMANDS],
      pathWhitelist: DEFAULT_PATH_WHITELIST,
      networkRules: [],
      resourceLimits: DEFAULT_RESOURCE_LIMITS,
      enableLogging: true,
      enableAudit: true,
      ...config
    };

    logger.info({ level: this.config.level }, 'Sandbox Manager initialized');
  }

  /**
   * Check if a command is allowed to execute
   */
  isCommandAllowed(command: string): { allowed: boolean; reason?: string; rule?: CommandRule } {
    const commandName = command.split(' ')[0].trim();
    const rule = this.config.commandWhitelist.find(r => r.command === commandName);

    if (!rule) {
      const reason = `命令 "${commandName}" 不在白名单中`;
      logger.warn({ command: commandName }, 'Command not in whitelist');
      this.audit('command', { command, commandName }, false, reason);
      return { allowed: false, reason };
    }

    if (!rule.allowed) {
      const reason = `命令 "${commandName}" 被禁止: ${rule.description || '危险操作'}`;
      logger.warn({ command: commandName, category: rule.category }, 'Command is blocked');
      this.audit('command', { command, commandName, category: rule.category }, false, reason);
      return { allowed: false, reason, rule };
    }

    if (rule.requiresApproval) {
      const reason = `命令 "${commandName}" 需要额外批准: ${rule.description || '受限操作'}`;
      logger.info({ command: commandName }, 'Command requires approval');
      this.audit('command', { command, commandName, requiresApproval: true }, false, reason);
      return { allowed: false, reason, rule };
    }

    // Check command flags
    const flags = this.extractFlags(command);
    if (rule.deniedFlags && flags.some(f => rule.deniedFlags?.includes(f))) {
      const deniedFlag = flags.find(f => rule.deniedFlags?.includes(f));
      const reason = `命令 "${commandName}" 使用了禁止的标志: ${deniedFlag}`;
      logger.warn({ command: commandName, flag: deniedFlag }, 'Command uses denied flag');
      this.audit('command', { command, commandName, deniedFlag }, false, reason);
      return { allowed: false, reason, rule };
    }

    if (rule.maxArgs && this.countArgs(command) > rule.maxArgs) {
      const reason = `命令 "${commandName}" 参数过多 (最大: ${rule.maxArgs})`;
      logger.warn({ command: commandName, maxArgs: rule.maxArgs }, 'Command has too many arguments');
      this.audit('command', { command, commandName, argCount: this.countArgs(command) }, false, reason);
      return { allowed: false, reason, rule };
    }

    logger.info({ command: commandName, category: rule.category }, 'Command allowed');
    this.audit('command', { command, commandName, category: rule.category }, true);
    return { allowed: true, rule };
  }

  /**
   * Check if a path is allowed to be accessed
   */
  isPathAllowed(path: string, mode: 'read' | 'write' | 'delete'): { allowed: boolean; reason?: string; rule?: PathRule } {
    const resolvedPath = resolve(path);

    // Check if path matches any whitelist rule
    for (const rule of this.config.pathWhitelist) {
      const rulePath = resolve(rule.path);

      if (resolvedPath.startsWith(rulePath) || (rule.recursive && resolvedPath.startsWith(rulePath))) {
        if (!rule.allowed) {
          const reason = `路径 "${resolvedPath}" 不在允许范围内`;
          this.audit('path', { path: resolvedPath, mode }, false, reason);
          return { allowed: false, reason };
        }

        if (rule.readOnly && (mode === 'write' || mode === 'delete')) {
          const reason = `路径 "${resolvedPath}" 为只读`;
          this.audit('path', { path: resolvedPath, mode, readOnly: true }, false, reason);
          return { allowed: false, reason };
        }

        this.audit('path', { path: resolvedPath, mode }, true);
        return { allowed: true, rule };
      }
    }

    const reason = `路径 "${resolvedPath}" 不在白名单中`;
    logger.warn({ path: resolvedPath }, 'Path not in whitelist');
    this.audit('path', { path: resolvedPath, mode }, false, reason);
    return { allowed: false, reason };
  }

  /**
   * Check if network access is allowed
   */
  isNetworkAllowed(url: string): { allowed: boolean; reason?: string; rule?: NetworkRule } {
    try {
      const parsedUrl = new URL(url);

      // Check if there's a rule for this host
      const rule = this.config.networkRules.find(r =>
        r.host === parsedUrl.hostname ||
        r.host === '*' || // wildcard
        parsedUrl.hostname.endsWith(r.host.replace('*', ''))
      );

      if (rule) {
        if (!rule.allowed) {
          const reason = `访问 "${parsedUrl.hostname}" 被禁止`;
          this.audit('network', { url, host: parsedUrl.hostname }, false, reason);
          return { allowed: false, reason };
        }

        if (rule.protocol && parsedUrl.protocol !== `${rule.protocol}:`) {
          const reason = `协议 "${parsedUrl.protocol}" 不被允许，仅允许 "${rule.protocol}"`;
          this.audit('network', { url, protocol: parsedUrl.protocol }, false, reason);
          return { allowed: false, reason };
        }

        if (rule.port && parseInt(parsedUrl.port) !== rule.port) {
          const reason = `端口 "${parsedUrl.port}" 不被允许，仅允许端口 "${rule.port}"`;
          this.audit('network', { url, port: parsedUrl.port }, false, reason);
          return { allowed: false, reason };
        }

        this.audit('network', { url, host: parsedUrl.hostname }, true);
        return { allowed: true, rule };
      }

      // Default: allow HTTPS, deny HTTP
      if (parsedUrl.protocol === 'https:') {
        this.audit('network', { url, protocol: 'https' }, true);
        return { allowed: true };
      } else if (parsedUrl.protocol === 'http:') {
        const reason = `HTTP协议不安全，请使用HTTPS`;
        this.audit('network', { url, protocol: 'http' }, false, reason);
        return { allowed: false, reason };
      }

      // Unknown protocol - deny by default
      const reason = `协议 "${parsedUrl.protocol}" 不被允许`;
      this.audit('network', { url, protocol: parsedUrl.protocol }, false, reason);
      return { allowed: false, reason };
    } catch (error: any) {
      const reason = `无效的URL: ${error.message}`;
      this.audit('network', { url }, false, reason);
      return { allowed: false, reason };
    }
  }

  /**
   * Get resource limits
   */
  getResourceLimits(): ResourceLimits {
    return { ...this.config.resourceLimits };
  }

  /**
   * Update sandbox configuration
   */
  updateConfig(config: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info({ config }, 'Sandbox configuration updated');
  }

  /**
   * Get audit log
   */
  getAuditLog(): Array<any> {
    return [...this.auditLog];
  }

  /**
   * Clear audit log
   */
  clearAuditLog(): void {
    this.auditLog = [];
    logger.info('Audit log cleared');
  }

  /**
   * Export audit log to file
   */
  async exportAuditLog(filePath: string): Promise<void> {
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, JSON.stringify(this.auditLog, null, 2));
    logger.info({ path: filePath }, 'Audit log exported');
  }

  /**
   * Get sandbox statistics
   */
  getStats(): {
    totalOperations: number;
    allowedOperations: number;
    blockedOperations: number;
    byCategory: Record<string, number>;
    recentBlocked: Array<any>;
  } {
    const total = this.auditLog.length;
    const allowed = this.auditLog.filter(e => e.allowed).length;
    const blocked = total - allowed;

    const byCategory: Record<string, number> = {};
    for (const entry of this.auditLog) {
      const category = entry.operation;
      byCategory[category] = (byCategory[category] || 0) + 1;
    }

    const recentBlocked = this.auditLog
      .filter(e => !e.allowed)
      .slice(-10);

    return {
      totalOperations: total,
      allowedOperations: allowed,
      blockedOperations: blocked,
      byCategory,
      recentBlocked
    };
  }

  /**
   * Private: Add entry to audit log
   */
  private audit(operation: string, details: any, allowed: boolean, reason?: string): void {
    if (!this.config.enableAudit) return;

    const entry = {
      timestamp: new Date(),
      operation,
      details,
      allowed,
      reason
    };

    this.auditLog.push(entry);

    if (this.config.enableLogging) {
      if (allowed) {
        logger.debug({ operation, details }, 'Sandbox operation allowed');
      } else {
        logger.warn({ operation, details, reason }, 'Sandbox operation blocked');
      }
    }

    // Keep only last 10000 entries to prevent memory issues
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }
  }

  /**
   * Private: Extract flags from command
   */
  private extractFlags(command: string): string[] {
    return command.match(/-\w+/g) || [];
  }

  /**
   * Private: Count command arguments
   */
  private countArgs(command: string): number {
    return command.split(' ').filter(arg => arg && !arg.startsWith('-')).length - 1;
  }
}

// Singleton instance
let sandboxManager: SandboxManager | null = null;

/**
 * Get the singleton sandbox manager instance
 */
export function getSandboxManager(): SandboxManager {
  if (!sandboxManager) {
    sandboxManager = new SandboxManager();
  }
  return sandboxManager;
}

/**
 * Create a new sandbox manager instance
 */
export function createSandboxManager(config?: Partial<SandboxConfig>): SandboxManager {
  return new SandboxManager(config);
}

/**
 * Convenience function to check if command is allowed
 */
export function isCommandAllowed(command: string): { allowed: boolean; reason?: string } {
  return getSandboxManager().isCommandAllowed(command);
}

/**
 * Convenience function to check if path is allowed
 */
export function isPathAllowed(path: string, mode: 'read' | 'write' | 'delete'): { allowed: boolean; reason?: string } {
  return getSandboxManager().isPathAllowed(path, mode);
}

/**
 * Convenience function to check if network access is allowed
 */
export function isNetworkAllowed(url: string): { allowed: boolean; reason?: string } {
  return getSandboxManager().isNetworkAllowed(url);
}
