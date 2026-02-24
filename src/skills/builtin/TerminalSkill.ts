/**
 * Terminal Skill
 * Execute shell commands
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const TerminalSkill: Skill = {
  name: 'terminal-exec',
  version: '1.0.0',
  description: 'Execute shell commands',
  category: SkillCategory.TERMINAL,
  enabled: true,
  builtin: true,
  parameters: {
    required: ['command'],
    optional: ['cwd', 'timeout', 'env'],
  },

  validate(params: any): boolean {
    return !!params.command;
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { command, cwd = process.cwd(), timeout = 30000, env = {} } = params;

    try {
      const execOptions = {
        cwd,
        timeout,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024, // 10MB
      };

      const { stdout, stderr } = await execAsync(command, execOptions);

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
          duration: Date.now(),
        },
      };
    } catch (error: any) {
      return {
        success: error.code === 0,
        error: error.message,
        result: {
          command,
          stdout: error.stdout || '',
          stderr: error.stderr || '',
          exitCode: error.code || 1,
        },
      };
    }
  },
};

export default TerminalSkill;
