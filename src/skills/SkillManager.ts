/**
 * Skill Manager
 * Manage skill registration, loading, and execution
 * Supports both built-in and external/custom skills
 */

import { Skill, SkillCategory, SkillContext, SkillResult, SkillMetadata } from './types.js';
import { getLogger } from '../monitoring/logger.js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = getLogger('SkillManager');

/**
 * Skill package manifest structure
 */
export interface SkillPackageManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  main: string; // Entry point file
  skills: string[]; // Skill names exported by this package
  dependencies?: Record<string, string>; // NPM dependencies
  permissions?: string[]; // Required permissions (file, network, etc.)
}

/**
 * Skill load result
 */
export interface SkillLoadResult {
  success: boolean;
  skills: string[];
  errors?: string[];
}

const SKILL_DIRS = [
  join(__dirname, 'builtin'), // Built-in skills
  resolve(process.cwd(), 'skills'), // User skills directory (unified)
];

/**
 * Skill Manager - Central skill registry and executor
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private externalSkillPackages: Map<string, SkillPackageManifest> = new Map();
  private initialized: boolean = false;

  constructor() {
    // Don't call async in constructor
    this.loadBuiltinSkillsSync();
  }

  /**
   * Initialize the skill manager (async)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.loadBuiltinSkills();
    await this.loadExternalSkills();
    this.initialized = true;
  }

  /**
   * Register a skill
   */
  register(skill: Skill): void {
    // Check for name conflicts
    if (this.skills.has(skill.name)) {
      logger.warn({ skill: skill.name }, 'Skill already registered, overwriting');
    }
    this.skills.set(skill.name, skill);
    logger.info(
      { skill: skill.name, version: skill.version, category: skill.category, builtin: skill.builtin },
      'Skill registered'
    );
  }

  /**
   * Register multiple skills at once
   */
  registerMany(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * Unregister a skill
   */
  unregister(skillName: string): boolean {
    const deleted = this.skills.delete(skillName);
    if (deleted) {
      logger.info({ skill: skillName }, 'Skill unregistered');
    }
    return deleted;
  }

  /**
   * Get a skill by name
   */
  getSkill(skillName: string): Skill | undefined {
    return this.skills.get(skillName);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(skillName: string): boolean {
    return this.skills.has(skillName);
  }

  /**
   * List all skills
   */
  listSkills(): SkillMetadata[] {
    const skills: SkillMetadata[] = [];

    for (const skill of this.skills.values()) {
      skills.push({
        skillId: skill.name,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        version: skill.version,
        enabled: skill.enabled,
        builtin: skill.builtin || false,
        parameters: skill.parameters,
      });
    }

    return skills;
  }

  /**
   * List skills by category
   */
  listSkillsByCategory(category: SkillCategory): SkillMetadata[] {
    return this.listSkills().filter((s) => s.category === category);
  }

  /**
   * List enabled skills
   */
  listEnabledSkills(): SkillMetadata[] {
    return this.listSkills().filter((s) => s.enabled);
  }

  /**
   * List external (non-builtin) skills
   */
  listExternalSkills(): SkillMetadata[] {
    return this.listSkills().filter((s) => !s.builtin);
  }

  /**
   * List built-in skills
   */
  listBuiltinSkills(): SkillMetadata[] {
    return this.listSkills().filter((s) => s.builtin);
  }

  /**
   * Search skills by name or description
   */
  searchSkills(query: string): SkillMetadata[] {
    const lowerQuery = query.toLowerCase();
    return this.listSkills().filter((s) =>
      s.name.toLowerCase().includes(lowerQuery) ||
      s.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get skill packages info
   */
  listSkillPackages(): SkillPackageManifest[] {
    return Array.from(this.externalSkillPackages.values());
  }

  /**
   * Execute a skill
   */
  async executeSkill(
    skillName: string,
    params: any,
    context: SkillContext = {}
  ): Promise<SkillResult> {
    const skill = this.skills.get(skillName);

    if (!skill) {
      logger.warn({ skill: skillName }, 'Skill not found');
      return {
        success: false,
        error: `Skill not found: ${skillName}`,
      };
    }

    if (!skill.enabled) {
      logger.warn({ skill: skillName }, 'Skill is disabled');
      return {
        success: false,
        error: `Skill is disabled: ${skillName}`,
      };
    }

    if (skill.validate && !skill.validate(params)) {
      logger.warn({ skill: skillName, params }, 'Invalid skill parameters');
      return {
        success: false,
        error: `Invalid parameters for skill: ${skillName}`,
      };
    }

    logger.info({ skill: skillName, params }, 'Executing skill');

    try {
      const startTime = Date.now();
      const result = await skill.execute(context, params);
      const duration = Date.now() - startTime;

      logger.info({ skill: skillName, duration, success: result.success }, 'Skill executed');

      // Record usage
      await this.recordUsage(skillName, result);

      return result;
    } catch (error: any) {
      logger.error({ skill: skillName, error: error.message }, 'Skill execution failed');
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get skills for a task type
   */
  getSkillsForTask(taskType: string): string[] {
    const taskSkillMap: Record<string, string[]> = {
      code: ['code-generation', 'code-review', 'git-ops'],
      data: ['data-analysis', 'file-ops'],
      automation: ['file-ops', 'terminal-exec', 'browser-auto'],
      analysis: ['code-review', 'data-analysis'],
      testing: ['test-generation', 'test-runner'],
      deployment: ['git-ops', 'terminal-exec', 'file-ops'],
    };

    return taskSkillMap[taskType] || [];
  }

  /**
   * Get all available skill names
   */
  getAvailableSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Enable a skill
   */
  enableSkill(skillName: string): boolean {
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = true;
      logger.info({ skill: skillName }, 'Skill enabled');
      return true;
    }
    return false;
  }

  /**
   * Disable a skill
   */
  disableSkill(skillName: string): boolean {
    const skill = this.skills.get(skillName);
    if (skill) {
      skill.enabled = false;
      logger.info({ skill: skillName }, 'Skill disabled');
      return true;
    }
    return false;
  }

  /**
   * Load built-in skills (sync stub for constructor)
   */
  private loadBuiltinSkillsSync(): void {
    // Skills will be loaded when initialize() is called
    // This is just a placeholder for the constructor
  }

  /**
   * Load built-in skills
   */
  private async loadBuiltinSkills(): Promise<void> {
    // Register skills directly to avoid dynamic import issues
    const { CodeGenerationSkill } = await import('./builtin/CodeGenerationSkill.js');
    const { FileOpsSkill } = await import('./builtin/FileOpsSkill.js');
    const { TerminalSkill } = await import('./builtin/TerminalSkill.js');
    const { CodeReviewSkill } = await import('./builtin/CodeReviewSkill.js');
    const { DataAnalysisSkill } = await import('./builtin/DataAnalysisSkill.js');
    const { DocxProcessingSkill } = await import('./builtin/DocxProcessingSkill.js');

    this.register(CodeGenerationSkill);
    this.register(FileOpsSkill);
    this.register(TerminalSkill);
    this.register(CodeReviewSkill);
    this.register(DataAnalysisSkill);
    this.register(DocxProcessingSkill);

    logger.info({ count: 6 }, 'Builtin skills loaded');
  }

  /**
   * Load external skills from custom directories
   */
  async loadExternalSkills(): Promise<SkillLoadResult> {
    const result: SkillLoadResult = {
      success: true,
      skills: [],
      errors: [],
    };

    for (const skillDir of SKILL_DIRS.slice(1)) { // Skip built-in dir
      if (!existsSync(skillDir)) {
        continue;
      }

      try {
        const loaded = await this.loadSkillsFromDirectory(skillDir);
        result.skills.push(...loaded.skills);
        if (loaded.errors) {
          result.errors?.push(...loaded.errors);
        }
      } catch (error: any) {
        result.errors?.push(`Failed to load from ${skillDir}: ${error.message}`);
      }
    }

    if (result.skills.length > 0) {
      logger.info({ count: result.skills.length, skills: result.skills }, 'External skills loaded');
    }

    return result;
  }

  /**
   * Load skills from a directory
   * Supports both individual skill files and skill packages with manifest
   */
  async loadSkillsFromDirectory(directory: string): Promise<SkillLoadResult> {
    const result: SkillLoadResult = {
      success: true,
      skills: [],
      errors: [],
    };

    try {
      // Check for skill package manifest
      const manifestPath = join(directory, 'skill-manifest.json');
      if (existsSync(manifestPath)) {
        return await this.loadSkillPackage(directory, manifestPath);
      }

      // Load individual skill files
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Recursively load from subdirectories
          const subResult = await this.loadSkillsFromDirectory(join(directory, entry.name));
          result.skills.push(...subResult.skills);
          if (subResult.errors) {
            result.errors?.push(...subResult.errors);
          }
        } else if (entry.name.endsWith('.skill.js') || entry.name.endsWith('.skill.ts') ||
                   entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
          // Skip index.ts/index.js files (they're likely package entry points)
          if (entry.name === 'index.ts' || entry.name === 'index.js') {
            continue;
          }
          // Load individual skill file
          try {
            const skillPath = join(directory, entry.name);
            const loaded = await this.loadSkillFromFile(skillPath);
            if (loaded) {
              result.skills.push(loaded.name);
            }
          } catch (error: any) {
            result.errors?.push(`${entry.name}: ${error.message}`);
          }
        }
      }
    } catch (error: any) {
      result.success = false;
      result.errors?.push(error.message);
    }

    return result;
  }

  /**
   * Load a skill package with manifest
   */
  async loadSkillPackage(directory: string, manifestPath: string): Promise<SkillLoadResult> {
    const result: SkillLoadResult = {
      success: true,
      skills: [],
      errors: [],
    };

    try {
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifest: SkillPackageManifest = JSON.parse(manifestContent);

      // Store manifest
      this.externalSkillPackages.set(manifest.name, manifest);

      // Load main entry point
      const mainPath = resolve(directory, manifest.main);
      const module = await import(mainPath);

      // Register exported skills
      for (const skillName of manifest.skills) {
        if (module[skillName]) {
          const skill: Skill = module[skillName];
          skill.builtin = false;
          this.register(skill);
          result.skills.push(skill.name);
        } else {
          result.errors?.push(`Skill ${skillName} not found in ${mainPath}`);
        }
      }

      logger.info({ package: manifest.name, skills: result.skills }, 'Skill package loaded');
    } catch (error: any) {
      result.success = false;
      result.errors?.push(error.message);
    }

    return result;
  }

  /**
   * Load a single skill from a file
   * Expected export format: export const skillName: Skill = { ... }
   * or: export default skillObject
   *
   * Note: TypeScript files (.ts) must be compiled to .js before loading,
   * or use tsx runtime for development
   */
  async loadSkillFromFile(filePath: string): Promise<Skill | null> {
    try {
      // For .ts files in development, try to use compiled version or tsx
      let importPath = filePath;

      if (filePath.endsWith('.ts')) {
        // Check if compiled version exists
        const jsPath = filePath.replace('.ts', '.js');
        if (existsSync(jsPath)) {
          importPath = jsPath;
        } else {
          logger.warn({ file: filePath }, 'TypeScript skill file found but no compiled .js version exists');
          logger.warn({ hint: 'Run: tsc <skill-file> or use the build script' }, 'Compile the skill first');
          return null;
        }
      }

      // Convert to file:// URL for Windows compatibility
      const fileUrl = process.platform === 'win32'
        ? `file:///${importPath.replace(/\\/g, '/')}`
        : `file://${importPath}`;

      const module = await import(fileUrl);

      // Try to find the skill export
      let skill: Skill | null = null;

      // Check for default export
      if (module.default && typeof module.default === 'object') {
        skill = module.default;
      }
      // Check for named exports (find first one that matches Skill interface)
      else {
        for (const key in module) {
          const value = module[key];
          if (value && typeof value === 'object' && value.name && value.execute) {
            skill = value;
            break;
          }
        }
      }

      if (skill) {
        skill.builtin = false;
        this.register(skill);
        return skill;
      }

      logger.warn({ file: filePath }, 'No valid skill export found');
      return null;
    } catch (error: any) {
      logger.error({ file: filePath, error: error.message }, 'Failed to load skill file');
      return null;
    }
  }

  /**
   * Install a skill package from a local path or npm package
   */
  async installSkillPackage(source: string): Promise<SkillLoadResult> {
    logger.info({ source }, 'Installing skill package');

    // Check if it's a local directory
    if (existsSync(source)) {
      const manifestPath = join(source, 'skill-manifest.json');
      if (existsSync(manifestPath)) {
        return await this.loadSkillPackage(source, manifestPath);
      }
      return await this.loadSkillsFromDirectory(source);
    }

    // TODO: Support npm package installation
    const result: SkillLoadResult = {
      success: false,
      skills: [],
      errors: ['npm package installation not yet supported'],
    };

    return result;
  }

  /**
   * Uninstall a skill package
   */
  async uninstallSkillPackage(packageName: string): Promise<boolean> {
    const manifest = this.externalSkillPackages.get(packageName);
    if (!manifest) {
      logger.warn({ package: packageName }, 'Package not found');
      return false;
    }

    // Unregister all skills from this package
    for (const skillName of manifest.skills) {
      this.unregister(skillName);
    }

    this.externalSkillPackages.delete(packageName);
    logger.info({ package: packageName }, 'Skill package uninstalled');
    return true;
  }

  /**
   * Reload a skill package
   */
  async reloadSkillPackage(packageName: string): Promise<SkillLoadResult> {
    const manifest = this.externalSkillPackages.get(packageName);
    if (!manifest) {
      return {
        success: false,
        skills: [],
        errors: ['Package not found'],
      };
    }

    // Uninstall first
    await this.uninstallSkillPackage(packageName);

    // Reinstall
    // Note: This assumes the package path is still valid
    return await this.installSkillPackage(packageName);
  }

  /**
   * Get skill statistics
   */
  getStats(): {
    total: number;
    builtin: number;
    external: number;
    enabled: number;
    disabled: number;
    byCategory: Record<string, number>;
  } {
    const skills = this.listSkills();
    const byCategory: Record<string, number> = {};

    for (const skill of skills) {
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
    }

    return {
      total: skills.length,
      builtin: skills.filter((s) => s.builtin).length,
      external: skills.filter((s) => !s.builtin).length,
      enabled: skills.filter((s) => s.enabled).length,
      disabled: skills.filter((s) => !s.enabled).length,
      byCategory,
    };
  }

  /**
   * Record skill usage for analytics
   */
  private async recordUsage(skillName: string, result: SkillResult): Promise<void> {
    // In a real implementation, this would store to a database
    // For now, just log
    logger.debug({ skill: skillName, success: result.success }, 'Skill usage recorded');
  }
}

// Singleton instance
let skillManager: SkillManager | null = null;

export function getSkillManager(): SkillManager {
  if (!skillManager) {
    skillManager = new SkillManager();
  }
  return skillManager;
}

export function createSkillManager(): SkillManager {
  return new SkillManager();
}
