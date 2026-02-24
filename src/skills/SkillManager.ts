/**
 * Skill Manager
 * Manage skill registration, loading, and execution
 */

import { Skill, SkillCategory, SkillContext, SkillResult, SkillMetadata } from './types.js';
import { getLogger } from '../monitoring/logger.js';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const logger = getLogger('SkillManager');

/**
 * Skill Manager - Central skill registry and executor
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private agentSkills: Map<string, string[]> = new Map();
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
    this.initialized = true;
  }

  /**
   * Register a skill
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    logger.info(
      { skill: skill.name, version: skill.version, category: skill.category },
      'Skill registered'
    );
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

    this.register(CodeGenerationSkill);
    this.register(FileOpsSkill);
    this.register(TerminalSkill);
    this.register(CodeReviewSkill);
    this.register(DataAnalysisSkill);

    logger.info({ count: 5 }, 'Builtin skills loaded');
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
