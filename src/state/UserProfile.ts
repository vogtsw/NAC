/**
 * User Profile
 * Manages user preferences, history, and statistics
 */

import type { UserProfileData, UserPreferences, InteractionHistory, UserStatistics } from './models_extended.js';
import { getUserStore } from './UserStore.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('UserProfile');

const DEFAULT_PREFERENCES: UserPreferences = {
  programming: {
    defaultLanguage: 'TypeScript',
    preferredLanguages: ['TypeScript', 'JavaScript', 'Python'],
    codeStyle: 'functional',
    frameworks: [],
    tools: [],
  },
  agents: {
    preferredAgents: [],
    avoidedAgents: [],
    defaultAgent: 'GenericAgent',
  },
  skills: {
    frequentlyUsed: [],
    customSettings: {},
  },
  interaction: {
    verbosity: 'normal',
    language: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    theme: 'light',
  },
};

export class UserProfile {
  private userId: string;
  private data: UserProfileData;
  private store: ReturnType<typeof getUserStore>;

  constructor(userId: string) {
    this.userId = userId;
    this.store = getUserStore();
  }

  /**
   * Initialize or load user profile
   */
  async initialize(): Promise<void> {
    await this.store.ensureDirectories();

    let data = await this.store.loadUser(this.userId);

    if (!data) {
      // Create new user profile with defaults
      data = this.createDefaultProfile();
      await this.store.saveUser(this.userId, data);
    }

    this.data = data;
  }

  /**
   * Get user preferences
   */
  getPreferences(): UserPreferences {
    return this.data.preferences;
  }

  /**
   * Update user preferences
   */
  async updatePreferences(updates: Partial<UserPreferences>): Promise<void> {
    // Deep merge preferences
    this.data.preferences = this.deepMerge(this.data.preferences, updates);
    await this.store.saveUser(this.userId, this.data);
    logger.info({ userId: this.userId, updates }, 'User preferences updated');
  }

  /**
   * Record an interaction
   */
  async recordInteraction(interaction: InteractionHistory): Promise<void> {
    this.data.history.push(interaction);

    // Limit history to 1000 entries
    if (this.data.history.length > 1000) {
      this.data.history = this.data.history.slice(-1000);
    }

    await this.store.saveUser(this.userId, this.data);
    await this.updateStatistics();
  }

  /**
   * Get user statistics
   */
  getStatistics(): UserStatistics {
    return this.data.statistics;
  }

  /**
   * Get interaction history
   */
  getHistory(limit?: number): InteractionHistory[] {
    const history = this.data.history;
    return limit ? history.slice(-limit) : history;
  }

  /**
   * Get recommended agents based on usage history
   */
  getRecommendedAgents(): string[] {
    const stats = this.data.statistics.mostUsedAgents;
    return Object.entries(stats)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([agent]) => agent);
  }

  /**
   * Get recommended skills based on usage history
   */
  getRecommendedSkills(): string[] {
    const frequent = this.data.preferences.skills.frequentlyUsed;
    return frequent.slice(0, 5);
  }

  /**
   * Get user's default programming language
   */
  getDefaultLanguage(): string {
    return this.data.preferences.programming.defaultLanguage;
  }

  /**
   * Get user's preferred frameworks
   */
  getPreferredFrameworks(): string[] {
    return this.data.preferences.programming.frameworks;
  }

  /**
   * Get user's code style preference
   */
  getCodeStyle(): string {
    return this.data.preferences.programming.codeStyle;
  }

  /**
   * Check if user prefers a specific agent
   */
  prefersAgent(agentType: string): boolean {
    return this.data.preferences.agents.preferredAgents.includes(agentType);
  }

  /**
   * Check if user avoids a specific agent
   */
  avoidsAgent(agentType: string): boolean {
    return this.data.preferences.agents.avoidedAgents.includes(agentType);
  }

  /**
   * Update statistics after recording interaction
   */
  private async updateStatistics(): Promise<void> {
    const stats = this.data.statistics;
    const history = this.data.history;

    // Update basic stats
    stats.totalInteractions = history.length;
    stats.totalTasksCompleted = history.filter(h => h.success).length;

    if (history.length > 0) {
      const totalTime = history.reduce((sum, h) => sum + h.executionTime, 0);
      stats.averageExecutionTime = totalTime / history.length;
      stats.successRate = stats.totalTasksCompleted / history.length;
    }

    // Update most used agents
    stats.mostUsedAgents = {};
    history.forEach(h => {
      stats.mostUsedAgents[h.agentUsed] = (stats.mostUsedAgents[h.agentUsed] || 0) + 1;
    });

    // Update most used skills
    stats.mostUsedSkills = {};
    history.forEach(h => {
      h.skillsUsed.forEach(skill => {
        stats.mostUsedSkills[skill] = (stats.mostUsedSkills[skill] || 0) + 1;
      });
    });

    // Update frequently used skills
    const skillCounts = stats.mostUsedSkills;
    this.data.preferences.skills.frequentlyUsed = Object.entries(skillCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([skill]) => skill);
  }

  /**
   * Create default user profile
   */
  private createDefaultProfile(): UserProfileData {
    const now = new Date();

    return {
      userId: this.userId,
      preferences: JSON.parse(JSON.stringify(DEFAULT_PREFERENCES)),
      history: [],
      statistics: {
        totalInteractions: 0,
        totalTasksCompleted: 0,
        averageExecutionTime: 0,
        mostUsedAgents: {},
        mostUsedSkills: {},
        successRate: 1,
      },
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Deep merge objects
   */
  private deepMerge(target: any, source: any): any {
    const output = { ...target };

    for (const key in source) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        if (target[key] instanceof Object && !Array.isArray(target[key])) {
          output[key] = this.deepMerge(target[key], source[key]);
        } else {
          output[key] = source[key];
        }
      } else {
        output[key] = source[key];
      }
    }

    return output;
  }

  /**
   * Export user data as JSON
   */
  exportData(): string {
    return JSON.stringify(this.data, null, 2);
  }

  /**
   * Import user data from JSON
   */
  async importData(jsonData: string): Promise<void> {
    try {
      const data = JSON.parse(jsonData) as UserProfileData;
      await this.store.saveUser(this.userId, data);
      this.data = data;
      logger.info({ userId: this.userId }, 'User data imported');
    } catch (error: any) {
      throw new Error(`Failed to import user data: ${error.message}`);
    }
  }
}

// Singleton cache
const profileCache: Map<string, UserProfile> = new Map();

export function getUserProfile(userId: string): UserProfile {
  if (!profileCache.has(userId)) {
    profileCache.set(userId, new UserProfile(userId));
  }
  return profileCache.get(userId)!;
}

export async function getOrLoadUserProfile(userId: string): Promise<UserProfile> {
  const profile = getUserProfile(userId);
  await profile.initialize();
  return profile;
}
