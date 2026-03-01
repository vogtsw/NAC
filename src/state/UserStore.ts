/**
 * User Store
 * Manages user profile data persistence
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get project root directory
const PROJECT_ROOT = join(__dirname, '../../..');

import type { UserProfileData } from './models_extended.js';

export class UserStore {
  private profilesDir: string;
  private index: Map<string, string> = new Map(); // userId -> filePath

  constructor(baseDir?: string) {
    const memoryDir = baseDir || join(PROJECT_ROOT, 'memory');
    this.profilesDir = join(memoryDir, 'users', 'profiles');
  }

  /**
   * Ensure directories exist
   */
  async ensureDirectories(): Promise<void> {
    if (!existsSync(this.profilesDir)) {
      await fs.mkdir(this.profilesDir, { recursive: true });
    }
  }

  /**
   * Get user profile file path
   */
  private getUserPath(userId: string): string {
    return join(this.profilesDir, `${userId}.json`);
  }

  /**
   * Load user profile
   */
  async loadUser(userId: string): Promise<UserProfileData | null> {
    const path = this.getUserPath(userId);

    if (!existsSync(path)) {
      return null;
    }

    try {
      const content = await fs.readFile(path, 'utf-8');
      const data = JSON.parse(content);

      // Convert date strings back to Date objects
      if (data.createdAt) data.createdAt = new Date(data.createdAt);
      if (data.updatedAt) data.updatedAt = new Date(data.updatedAt);
      if (data.history) {
        data.history.forEach((h: any) => {
          if (h.timestamp) h.timestamp = new Date(h.timestamp);
        });
      }

      this.index.set(userId, path);
      return data;
    } catch (error: any) {
      console.error(`Failed to load user ${userId}:`, error.message);
      return null;
    }
  }

  /**
   * Save user profile
   */
  async saveUser(userId: string, data: UserProfileData): Promise<void> {
    await this.ensureDirectories();

    const path = this.getUserPath(userId);
    data.updatedAt = new Date();

    try {
      await fs.writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
      this.index.set(userId, path);
    } catch (error: any) {
      throw new Error(`Failed to save user ${userId}: ${error.message}`);
    }
  }

  /**
   * Delete user profile
   */
  async deleteUser(userId: string): Promise<boolean> {
    const path = this.getUserPath(userId);

    if (!existsSync(path)) {
      return false;
    }

    try {
      await fs.unlink(path);
      this.index.delete(userId);
      return true;
    } catch (error: any) {
      console.error(`Failed to delete user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * List all users
   */
  async listUsers(): Promise<string[]> {
    await this.ensureDirectories();

    try {
      const files = await fs.readdir(this.profilesDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /**
   * Check if user exists
   */
  async userExists(userId: string): Promise<boolean> {
    const data = await this.loadUser(userId);
    return data !== null;
  }
}

// Singleton instance
let userStore: UserStore | null = null;

export function getUserStore(): UserStore {
  if (!userStore) {
    userStore = new UserStore();
  }
  return userStore;
}

export function createUserStore(baseDir?: string): UserStore {
  return new UserStore(baseDir);
}
