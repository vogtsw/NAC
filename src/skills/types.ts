/**
 * Skill Types
 * Type definitions for the skills system
 */

import pino from 'pino';

/**
 * Skill category enum
 */
export enum SkillCategory {
  CODE = 'code',
  DATA = 'data',
  AUTOMATION = 'automation',
  ANALYSIS = 'analysis',
  FILE = 'file',
  TERMINAL = 'terminal',
  BROWSER = 'browser',
  GIT = 'git',
  TESTING = 'testing',
}

/**
 * Skill interface
 */
export interface Skill {
  name: string;
  version: string;
  description: string;
  category: SkillCategory;
  enabled: boolean;
  builtin?: boolean;
  parameters?: SkillParameters;

  execute(context: SkillContext, params: any): Promise<SkillResult>;
  validate?(params: any): boolean;
}

/**
 * Skill parameters schema
 */
export interface SkillParameters {
  required?: string[];
  optional?: string[];
  schema?: Record<string, any>;
}

/**
 * Skill execution context
 */
export interface SkillContext {
  tools?: Map<string, any>;
  logger?: pino.Logger;
  blackboard?: any;
  sessionId?: string;
  taskId?: string;
  agentType?: string;
}

/**
 * Skill execution result
 */
export interface SkillResult {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}

/**
 * Skill metadata
 */
export interface SkillMetadata {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  enabled: boolean;
  builtin: boolean;
  parameters?: SkillParameters;
}
