/**
 * Prompt Builder
 * Assembles complete LLM context from system prompts, session history, skills, and user input
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSessionStore, SessionMessage, type SessionStore } from '../state/SessionStore.js';
import { getSkillManager } from '../skills/SkillManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get project root directory
const PROJECT_ROOT = join(__dirname, '../..');

/**
 * Prompt Builder - Assembles complete LLM context
 */
export class PromptBuilder {
  private agentsDir: string;
  private sessionStore: SessionStore;
  private skillManager: any;

  constructor() {
    this.agentsDir = join(PROJECT_ROOT, 'config', 'agents');
    this.sessionStore = getSessionStore();
    this.skillManager = getSkillManager();
  }

  /**
   * Get system prompt for an agent type from MD file
   */
  async getSystemPrompt(agentType: string): Promise<string> {
    const promptPath = join(this.agentsDir, `${agentType}.system.md`);

    // Try specific agent type first
    if (existsSync(promptPath)) {
      return await fs.readFile(promptPath, 'utf-8');
    }

    // Fallback to default
    const defaultPath = join(this.agentsDir, 'default.system.md');
    if (existsSync(defaultPath)) {
      return await fs.readFile(defaultPath, 'utf-8');
    }

    // Final fallback
    return this.getDefaultSystemPrompt();
  }

  /**
   * Get default system prompt
   */
  private getDefaultSystemPrompt(): string {
    return `You are an AI assistant designed to help users with their tasks.

## Core Principles
- Be helpful, accurate, and concise
- Ask clarifying questions when needed
- Respect user privacy and data security
- Provide actionable solutions`;
  }

  /**
   * Format session messages for LLM context
   */
  private formatSessionMessages(messages: SessionMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    let formatted = '\n## Previous Conversation\n\n';

    // Only include recent messages to avoid context overflow
    const recentMessages = messages.slice(-10); // Last 10 messages

    for (const msg of recentMessages) {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      formatted += `### ${role}\n${msg.content}\n\n`;
    }

    return formatted;
  }

  /**
   * Format skills summary for LLM context
   */
  private async formatSkillsSummary(_agentType?: string): Promise<string> {
    const allSkills = this.skillManager.listSkills();

    if (allSkills.length === 0) {
      return '';
    }

    let formatted = '\n## Available Skills\n\n';

    // Group skills by category
    const byCategory: Record<string, typeof allSkills> = {};
    for (const skill of allSkills) {
      if (!byCategory[skill.category]) {
        byCategory[skill.category] = [];
      }
      byCategory[skill.category].push(skill);
    }

    for (const [category, skills] of Object.entries(byCategory)) {
      formatted += `### ${category}\n`;
      for (const skill of skills) {
        if (skill.enabled) {
          formatted += `- **${skill.name}**: ${skill.description}\n`;
        }
      }
      formatted += '\n';
    }

    return formatted;
  }

  /**
   * Build complete context for LLM
   */
  async buildContext(options: {
    agentType: string;
    sessionId?: string;
    userInput: string;
    includeSessionHistory?: boolean;
    includeSkills?: boolean;
    additionalContext?: string;
  }): Promise<string> {
    const {
      agentType,
      sessionId,
      userInput,
      includeSessionHistory = true,
      includeSkills = true,
      additionalContext = '',
    } = options;

    const parts: string[] = [];

    // 1. System Prompt
    const systemPrompt = await this.getSystemPrompt(agentType);
    parts.push(systemPrompt);

    // 2. Session History (if available and requested)
    if (includeSessionHistory && sessionId) {
      const messages = await this.sessionStore.getSessionMessages(sessionId);
      if (messages.length > 0) {
        const sessionContent = this.formatSessionMessages(messages);
        parts.push(sessionContent);
      }
    }

    // 3. Skills Summary
    if (includeSkills) {
      const skillsSummary = await this.formatSkillsSummary(agentType);
      if (skillsSummary) {
        parts.push(skillsSummary);
      }
    }

    // 4. Additional Context
    if (additionalContext) {
      parts.push(`\n## Context\n\n${additionalContext}`);
    }

    // 5. Current User Input
    parts.push(`\n## Current Request\n\n${userInput}`);

    // Join all parts
    return parts.join('\n\n---\n\n');
  }

  /**
   * Build simple prompt (for quick tasks without full context)
   */
  async buildSimplePrompt(agentType: string, userInput: string, context?: string): Promise<string> {
    const systemPrompt = await this.getSystemPrompt(agentType);

    let prompt = systemPrompt;

    if (context) {
      prompt += `\n\n## Context\n\n${context}`;
    }

    prompt += `\n\n## Request\n\n${userInput}`;

    return prompt;
  }

  /**
   * Extract user input from assembled context (for parsing responses)
   */
  extractUserInput(assembledContext: string): string {
    const match = assembledContext.match(/## Current Request\n\n([\s\S]+?)(?=\n\n---|$)/);
    return match ? match[1].trim() : assembledContext;
  }

  /**
   * Get skills summary for specific task type
   */
  async getSkillsForTask(taskType: string): Promise<string> {
    const skills = this.skillManager.getSkillsForTask(taskType);

    if (skills.length === 0) {
      return '';
    }

    let formatted = '\n## Relevant Skills\n\n';

    for (const skillName of skills) {
      const skill = this.skillManager.getSkill(skillName);
      if (skill && skill.enabled) {
        formatted += `- **${skill.name}**: ${skill.description}\n`;
      }
    }

    return formatted;
  }

  /**
   * Build context for skill execution
   */
  async buildSkillContext(options: {
    agentType: string;
    sessionId?: string;
    skillName: string;
    skillParams: Record<string, any>;
    userInput: string;
  }): Promise<string> {
    const { agentType, sessionId, skillName, skillParams, userInput } = options;

    const parts: string[] = [];

    // System prompt
    const systemPrompt = await this.getSystemPrompt(agentType);
    parts.push(systemPrompt);

    // Skill context
    parts.push(`\n## Task: Execute Skill "${skillName}"\n`);
    parts.push(`\n### Parameters\n\`\`\`json\n${JSON.stringify(skillParams, null, 2)}\n\`\`\``);

    // User input
    parts.push(`\n### User Request\n${userInput}`);

    // Session history
    if (sessionId) {
      const messages = await this.sessionStore.getSessionMessages(sessionId);
      if (messages.length > 0) {
        parts.push(this.formatSessionMessages(messages));
      }
    }

    return parts.join('\n\n');
  }

  /**
   * Truncate context to fit within token limit (rough estimation)
   */
  truncateContext(context: string, maxTokens: number = 4000): string {
    // Rough estimation: ~4 chars per token
    const maxChars = maxTokens * 4;

    if (context.length <= maxChars) {
      return context;
    }

    // Truncate from the middle, keeping start and end
    const keepStart = Math.floor(maxChars * 0.4);
    const keepEnd = Math.floor(maxChars * 0.4);

    const start = context.substring(0, keepStart);
    const end = context.substring(context.length - keepEnd);

    return `${start}\n\n... [Context truncated to fit token limit] ...\n\n${end}`;
  }
}

// Singleton instance
let promptBuilder: PromptBuilder | null = null;

export function getPromptBuilder(): PromptBuilder {
  if (!promptBuilder) {
    promptBuilder = new PromptBuilder();
  }
  return promptBuilder;
}

export function createPromptBuilder(): PromptBuilder {
  return new PromptBuilder();
}
