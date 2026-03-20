/**
 * Terminal Skill
 * Execute shell commands with sandbox security
 * Integrated with SandboxManager for command execution control
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getSandboxManager } from '../../security/SandboxManager.js';
import { getLogger } from '../../../src/monitoring/logger.js';

const execAsync = promisify(exec);
const logger = getLogger('TerminalSkill');

export const TerminalSkill: Skill = {
  name: 'terminal-exec',
  version: '2.0.0',
  description: 'Execute shell commands with sandbox security restrictions',
  category: SkillCategory.TERMINAL,
  enabled: true,
  builtin: true,
  parameters: {
    required: ['command'],
    optional: ['cwd', 'timeout', 'env', 'bypassSandbox'],
  },

  validate(params: any): boolean {
    return !!params.command;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { command, cwd = process.cwd(), timeout = 30000, env = {}, bypassSandbox = false } = params;

    try {
      // 🔒 SANDBOX SECURITY CHECK
      if (!bypassSandbox) {
        const sandbox = getSandboxManager();

        // Check if command is allowed
        const commandCheck = sandbox.isCommandAllowed(command);
        if (!commandCheck.allowed) {
          logger.warn({
            command,
            reason: commandCheck.reason,
            rule: commandCheck.rule
          }, 'Command blocked by sandbox');

          return {
            success: false,
            error: `🔒 沙箱限制: ${commandCheck.reason}\n\n` +
                   `如需执行此命令，请：\n` +
                   `1. 确认命令安全性\n` +
                   `2. 使用 FileOpsSkill 代替文件操作\n` +
                   `3. 或设置 bypassSandbox: true (不推荐)`,
            requiresApproval: commandCheck.rule?.requiresApproval,
            metadata: {
              command,
              sandboxBlocked: true,
              reason: commandCheck.reason,
              category: commandCheck.rule?.category
            }
          };
        }

        // Check if working directory is allowed
        const pathCheck = sandbox.isPathAllowed(cwd, 'read');
        if (!pathCheck.allowed) {
          logger.warn({
            cwd,
            reason: pathCheck.reason
          }, 'Working directory blocked by sandbox');

          return {
            success: false,
            error: `🔒 沙箱限制: ${pathCheck.reason}`,
            metadata: {
              command,
              cwd,
              sandboxBlocked: true,
              reason: pathCheck.reason
            }
          };
        }

        // Get resource limits
        const limits = sandbox.getResourceLimits();
        const adjustedTimeout = Math.min(timeout, limits.maxExecutionTime);

        logger.info({
          command,
          cwd,
          timeout: adjustedTimeout,
          sandboxEnforced: true
        }, 'Executing command with sandbox restrictions');
      } else {
        logger.warn({ command }, '⚠️ Executing command WITHOUT sandbox protection');
      }

      // Execute command
      const execOptions = {
        cwd,
        timeout: adjustedTimeout,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      };

      const startTime = Date.now();
      const { stdout, stderr } = await execAsync(command, execOptions);
      const duration = Date.now() - startTime;

      logger.info({
        command,
        duration,
        stdoutLength: stdout.length,
        stderrLength: stderr.length
      }, 'Command executed successfully');

      return {
        success: true,
        result: {
          command,
          stdout,
          stderr,
          exitCode: 0,
        },
        metadata: {
          command,
          cwd,
          duration,
          sandboxProtected: !bypassSandbox
        },
      };
    } catch (error: any) {
      logger.error({
        command,
        error: error.message,
        code: error.code,
        signal: error.signal
      }, 'Command execution failed');

      return {
        success: error.code === 0,
        error: error.message,
        result: {
          command,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          exitCode: error.code || 1,
        },
        metadata: {
          command,
          executionFailed: true,
          timeout: error.killed && error.signal === 'SIGTERM'
        }
      };
    }
  },
};

export default TerminalSkill;
