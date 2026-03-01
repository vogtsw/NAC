/**
 * Skill Installer
 * Install skills from various sources: npm, git, local, MCP servers
 */

import { promises as fs } from 'fs';
import { join, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { getLogger } from '../monitoring/logger.js';

const execAsync = promisify(exec);
const logger = getLogger('SkillInstaller');

export interface SkillInstallOptions {
  source: 'npm' | 'git' | 'local' | 'mcp';
  name?: string;
  url?: string;
  path?: string;
  version?: string;
  force?: boolean;
}

export interface SkillInstallResult {
  success: boolean;
  skillName?: string;
  message: string;
  installedPath?: string;
}

/**
 * Skill Installer - Install skills from multiple sources
 */
export class SkillInstaller {
  private skillsDir: string;

  constructor(skillsDir: string = resolve(process.cwd(), 'skills')) {
    this.skillsDir = skillsDir;
  }

  /**
   * Ensure skills directory exists
   */
  private async ensureSkillsDir(): Promise<void> {
    if (!existsSync(this.skillsDir)) {
      await fs.mkdir(this.skillsDir, { recursive: true });
    }
  }

  /**
   * Install a skill from various sources
   */
  async install(options: SkillInstallOptions): Promise<SkillInstallResult> {
    await this.ensureSkillsDir();

    switch (options.source) {
      case 'npm':
        return await this.installFromNPM(options);
      case 'git':
        return await this.installFromGit(options);
      case 'local':
        return await this.installFromLocal(options);
      case 'mcp':
        return await this.installFromMCP(options);
      default:
        return {
          success: false,
          message: `Unknown source: ${options.source}`,
        };
    }
  }

  /**
   * Install skill from npm package
   * Example: @nexus-skills/github, nexus-skill-weather
   */
  private async installFromNPM(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { name, version = 'latest' } = options;

    if (!name) {
      return {
        success: false,
        message: 'npm package name is required',
      };
    }

    try {
      logger.info({ package: name, version }, 'Installing skill from npm');

      // Create a temporary directory for installation
      const tempDir = join(process.cwd(), '.tmp', 'npm-skills');
      await fs.mkdir(tempDir, { recursive: true });

      // Install the package
      const packageSpec = version === 'latest' ? name : `${name}@${version}`;
      await execAsync(`npm install ${packageSpec}`, { cwd: tempDir });

      // Find the installed package
      const nodeModulesDir = join(tempDir, 'node_modules');
      const packageDir = name.startsWith('@')
        ? join(nodeModulesDir, name.split('/')[0], name.split('/')[1])
        : join(nodeModulesDir, name);

      if (!existsSync(packageDir)) {
        throw new Error(`Package not found after installation: ${packageDir}`);
      }

      // Copy to skills directory
      const skillName = name.replace(/^@nexus-skills\//, '').replace(/^nexus-skill-/, '');
      const targetDir = join(this.skillsDir, skillName);

      if (existsSync(targetDir) && !options.force) {
        return {
          success: false,
          message: `Skill already exists: ${skillName}. Use --force to overwrite.`,
        };
      }

      await fs.mkdir(targetDir, { recursive: true });
      await this.copyDirectory(packageDir, targetDir);

      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });

      logger.info({ skill: skillName, path: targetDir }, 'Skill installed from npm');

      return {
        success: true,
        skillName,
        message: `Successfully installed ${skillName} from npm`,
        installedPath: targetDir,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to install skill from npm');
      return {
        success: false,
        message: `Failed to install from npm: ${error.message}`,
      };
    }
  }

  /**
   * Install skill from git repository
   * Example: https://github.com/user/nexus-skills.git
   */
  private async installFromGit(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { url, name } = options;

    if (!url) {
      return {
        success: false,
        message: 'Git repository URL is required',
      };
    }

    try {
      logger.info({ url }, 'Installing skill from git');

      // Extract skill name from URL or use provided name
      const match = url.match(/([^/]+)\.git$/);
      const skillName = name || (match ? match[1] : 'git-skill');
      const targetDir = join(this.skillsDir, skillName);

      if (existsSync(targetDir) && !options.force) {
        return {
          success: false,
          message: `Skill already exists: ${skillName}. Use --force to overwrite.`,
        };
      }

      // Clone the repository
      await execAsync(`git clone ${url} ${targetDir}`, {
        cwd: this.skillsDir,
      });

      logger.info({ skill: skillName, path: targetDir }, 'Skill installed from git');

      return {
        success: true,
        skillName,
        message: `Successfully installed ${skillName} from git`,
        installedPath: targetDir,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to install skill from git');
      return {
        success: false,
        message: `Failed to install from git: ${error.message}`,
      };
    }
  }

  /**
   * Install skill from local directory
   */
  private async installFromLocal(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { path: localPath, name } = options;

    if (!localPath) {
      return {
        success: false,
        message: 'Local path is required',
      };
    }

    try {
      const resolvedPath = resolve(localPath);

      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          message: `Path does not exist: ${localPath}`,
        };
      }

      const skillName = name || require('path').basename(resolvedPath);
      const targetDir = join(this.skillsDir, skillName);

      if (existsSync(targetDir) && !options.force) {
        return {
          success: false,
          message: `Skill already exists: ${skillName}. Use --force to overwrite.`,
        };
      }

      await fs.mkdir(targetDir, { recursive: true });
      await this.copyDirectory(resolvedPath, targetDir);

      logger.info({ skill: skillName, path: targetDir }, 'Skill installed from local');

      return {
        success: true,
        skillName,
        message: `Successfully installed ${skillName} from local path`,
        installedPath: targetDir,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to install skill from local');
      return {
        success: false,
        message: `Failed to install from local: ${error.message}`,
      };
    }
  }

  /**
   * Install skill from MCP server
   * This creates a local skill that connects to an MCP server
   */
  private async installFromMCP(options: SkillInstallOptions): Promise<SkillInstallResult> {
    const { name, url } = options;

    if (!name) {
      return {
        success: false,
        message: 'MCP server name is required',
      };
    }

    try {
      logger.info({ name, url }, 'Installing skill from MCP server');

      const skillDir = join(this.skillsDir, name);
      await fs.mkdir(skillDir, { recursive: true });

      // Create SKILL.md for MCP server
      const skillMd = `---
name: ${name}
description: MCP Server: ${name}
metadata:
  nexus:
    type: mcp
    server: ${url || 'stdio'}
---

## Overview
This skill connects to an MCP (Model Context Protocol) server: ${name}

## Server Configuration
- **Name**: ${name}
- **URL**: ${url || 'stdio (default)'}
- **Type**: MCP Server

## Usage
This skill automatically exposes tools from the MCP server to the agent.
`;

      await fs.writeFile(join(skillDir, 'SKILL.md'), skillMd);

      // Create MCP client wrapper
      const clientTs = `/**
 * MCP Client for ${name}
 * Automatically generated - DO NOT EDIT
 */

import { Skill } from '../../types.js';

export const skill: Skill = {
  name: '${name}',
  description: 'MCP Server: ${name}',
  category: 'mcp',
  version: '1.0.0',
  enabled: true,
  builtin: false,
  parameters: {
    optional: ['server', 'url']
  },
  async execute(params, context) {
    // MCP server integration
    // This will be handled by the MCP client
    return {
      success: true,
      result: { message: 'MCP server integration not yet implemented' }
    };
  }
};
`;

      await fs.writeFile(join(skillDir, 'index.ts'), clientTs);

      logger.info({ skill: name, path: skillDir }, 'MCP skill installed');

      return {
        success: true,
        skillName: name,
        message: `Successfully created MCP skill: ${name}`,
        installedPath: skillDir,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to install MCP skill');
      return {
        success: false,
        message: `Failed to install MCP skill: ${error.message}`,
      };
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and other unnecessary directories
        if (['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          continue;
        }
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * List all installed skills
   */
  async listInstalled(): Promise<string[]> {
    if (!existsSync(this.skillsDir)) {
      return [];
    }

    const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /**
   * Remove an installed skill
   */
  async remove(skillName: string): Promise<SkillInstallResult> {
    const skillPath = join(this.skillsDir, skillName);

    if (!existsSync(skillPath)) {
      return {
        success: false,
        message: `Skill not found: ${skillName}`,
      };
    }

    try {
      await fs.rm(skillPath, { recursive: true, force: true });
      logger.info({ skill: skillName }, 'Skill removed');

      return {
        success: true,
        skillName,
        message: `Successfully removed ${skillName}`,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to remove skill');
      return {
        success: false,
        message: `Failed to remove skill: ${error.message}`,
      };
    }
  }

  /**
   * Update a skill from git
   */
  async update(skillName: string): Promise<SkillInstallResult> {
    const skillPath = join(this.skillsDir, skillName);

    if (!existsSync(skillPath)) {
      return {
        success: false,
        message: `Skill not found: ${skillName}`,
      };
    }

    const gitDir = join(skillPath, '.git');
    if (!existsSync(gitDir)) {
      return {
        success: false,
        message: `Skill is not installed from git: ${skillName}`,
      };
    }

    try {
      await execAsync('git pull', { cwd: skillPath });
      logger.info({ skill: skillName }, 'Skill updated from git');

      return {
        success: true,
        skillName,
        message: `Successfully updated ${skillName}`,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to update skill');
      return {
        success: false,
        message: `Failed to update skill: ${error.message}`,
      };
    }
  }
}

// Singleton instance
let installer: SkillInstaller | null = null;

export function getSkillInstaller(skillsDir?: string): SkillInstaller {
  if (!installer) {
    installer = new SkillInstaller(skillsDir);
  }
  return installer;
}
