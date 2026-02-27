/**
 * Session Store
 * Manages session history as markdown files in memory/sessions/
 */

import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get project root directory (go up from src/state/)
const PROJECT_ROOT = join(__dirname, '../../..');

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

export interface SessionMetadata {
  sessionId: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

/**
 * Session Store - Manages session history as MD files
 */
export class SessionStore {
  private sessionsDir: string;
  private feedbackDir: string;
  private artifactsDir: string;

  constructor(baseDir?: string) {
    const memoryDir = baseDir || join(PROJECT_ROOT, 'memory');
    this.sessionsDir = join(memoryDir, 'sessions');
    this.feedbackDir = join(memoryDir, 'feedback');
    this.artifactsDir = join(memoryDir, 'artifacts');
  }

  /**
   * Ensure directories exist (call this before using the store)
   */
  async ensureDirectories(): Promise<void> {
    for (const dir of [this.sessionsDir, this.feedbackDir, this.artifactsDir]) {
      if (!existsSync(dir)) {
        await fs.mkdir(dir, { recursive: true });
      }
    }
  }

  /**
   * Get session file path
   */
  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.md`);
  }

  /**
   * Get feedback file path
   */
  private getFeedbackPath(sessionId: string): string {
    return join(this.feedbackDir, `${sessionId}.md`);
  }

  /**
   * Get artifacts path for a session
   */
  private getArtifactsPath(sessionId: string): string {
    return join(this.artifactsDir, sessionId);
  }

  /**
   * Create a new session
   */
  async createSession(sessionId: string, initialContext?: Record<string, any>): Promise<void> {
    const path = this.getSessionPath(sessionId);
    const now = new Date();

    let content = `# Session: ${sessionId}\n\n`;
    content += `**Created**: ${now.toISOString()}\n`;
    content += `**Status**: running\n`;

    if (initialContext) {
      content += `\n---\n\n## Initial Context\n\n`;
      content += `\`\`\`json\n${JSON.stringify(initialContext, null, 2)}\n\`\`\`\n`;
    }

    content += `\n---\n\n## Conversation\n\n`;

    await fs.writeFile(path, content, 'utf-8');
  }

  /**
   * Add a message to a session
   */
  async addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): Promise<void> {
    const path = this.getSessionPath(sessionId);

    if (!existsSync(path)) {
      await this.createSession(sessionId);
    }

    const timestamp = new Date().toISOString();
    const sectionName = role === 'user' ? 'User Input' : role === 'assistant' ? 'Agent Response' : 'System Note';

    let messageContent = `\n### ${sectionName}\n\n`;
    messageContent += `**Time**: ${timestamp}\n\n`;

    if (role === 'assistant' && (content.includes('```') || content.includes('function'))) {
      // Format code blocks nicely
      messageContent += content + '\n';
    } else {
      messageContent += content + '\n';
    }

    await fs.appendFile(path, messageContent, 'utf-8');

    // Update timestamp
    await this.updateMetadata(sessionId, { updatedAt: new Date() });
  }

  /**
   * Get session content as markdown
   */
  async getSessionContent(sessionId: string): Promise<string | null> {
    const path = this.getSessionPath(sessionId);

    if (!existsSync(path)) {
      return null;
    }

    return await fs.readFile(path, 'utf-8');
  }

  /**
   * Get session messages as array (for LLM context)
   */
  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const content = await this.getSessionContent(sessionId);
    if (!content) {
      return [];
    }

    const messages: SessionMessage[] = [];
    const lines = content.split('\n');
    let currentRole: 'user' | 'assistant' | 'system' | null = null;
    let currentContent: string[] = [];
    let currentTimestamp: Date | null = null;

    for (const line of lines) {
      // Check for section headers
      if (line.startsWith('### User Input')) {
        if (currentRole) {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n').trim(),
            timestamp: currentTimestamp || new Date(),
          });
        }
        currentRole = 'user';
        currentContent = [];
        currentTimestamp = null;
      } else if (line.startsWith('### Agent Response')) {
        if (currentRole) {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n').trim(),
            timestamp: currentTimestamp || new Date(),
          });
        }
        currentRole = 'assistant';
        currentContent = [];
        currentTimestamp = null;
      } else if (line.startsWith('### System Note')) {
        if (currentRole) {
          messages.push({
            role: currentRole,
            content: currentContent.join('\n').trim(),
            timestamp: currentTimestamp || new Date(),
          });
        }
        currentRole = 'system';
        currentContent = [];
        currentTimestamp = null;
      } else if (line.startsWith('**Time**:') && currentRole) {
        const timeStr = line.replace('**Time**:', '').trim();
        currentTimestamp = new Date(timeStr);
      } else if (currentRole && !line.startsWith('#') && !line.startsWith('**') && line !== '---') {
        currentContent.push(line);
      }
    }

    // Add last message
    if (currentRole && currentContent.length > 0) {
      messages.push({
        role: currentRole,
        content: currentContent.join('\n').trim(),
        timestamp: currentTimestamp || new Date(),
      });
    }

    return messages;
  }

  /**
   * Get session metadata
   */
  async getMetadata(sessionId: string): Promise<SessionMetadata | null> {
    const content = await this.getSessionContent(sessionId);
    if (!content) {
      return null;
    }

    const lines = content.split('\n');
    const metadata: Partial<SessionMetadata> = { sessionId };

    for (const line of lines) {
      if (line.startsWith('**Created**:')) {
        metadata.createdAt = new Date(line.replace('**Created**:', '').trim());
      } else if (line.startsWith('**Status**:')) {
        metadata.status = line.replace('**Status**:', '').trim() as SessionMetadata['status'];
      }
    }

    // Count messages
    const messages = await this.getSessionMessages(sessionId);
    metadata.messageCount = messages.length;
    metadata.updatedAt = messages.length > 0 ? messages[messages.length - 1].timestamp : metadata.createdAt || new Date();

    return metadata as SessionMetadata;
  }

  /**
   * Update session metadata
   */
  async updateMetadata(sessionId: string, updates: Partial<SessionMetadata>): Promise<void> {
    const path = this.getSessionPath(sessionId);

    if (!existsSync(path)) {
      return;
    }

    let content = await fs.readFile(path, 'utf-8');
    const lines = content.split('\n');
    const newLines: string[] = [];

    for (const line of lines) {
      if (updates.status && line.startsWith('**Status**:')) {
        newLines.push(`**Status**: ${updates.status}`);
      } else if (updates.updatedAt && line.startsWith('**Updated**:')) {
        newLines.push(`**Updated**: ${updates.updatedAt.toISOString()}`);
      } else {
        newLines.push(line);
      }
    }

    content = newLines.join('\n');
    await fs.writeFile(path, content, 'utf-8');
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: 'running' | 'completed' | 'failed'): Promise<void> {
    await this.updateMetadata(sessionId, { status });

    // Add completion note
    if (status !== 'running') {
      await this.addMessage(sessionId, 'system',
        `Session ${status}. ${status === 'completed' ? 'All tasks completed successfully.' : 'Session ended with errors.'}`
      );
    }
  }

  /**
   * Save feedback for a session
   */
  async saveFeedback(sessionId: string, feedback: {
    rating?: number;
    satisfied?: boolean;
    issues?: string[];
    suggestions?: string;
  }): Promise<void> {
    const path = this.getFeedbackPath(sessionId);
    const metadata = await this.getMetadata(sessionId);

    let content = `# Feedback for Session: ${sessionId}\n\n`;
    content += `**Session Date**: ${metadata?.createdAt?.toISOString() || 'Unknown'}\n`;
    content += `**Feedback Date**: ${new Date().toISOString()}\n\n`;

    if (feedback.rating !== undefined) {
      content += `## Rating\n\n${feedback.rating}/5\n\n`;
    }

    if (feedback.satisfied !== undefined) {
      content += `## Satisfaction\n\n${feedback.satisfied ? '✓ Satisfied' : '✗ Not Satisfied'}\n\n`;
    }

    if (feedback.issues && feedback.issues.length > 0) {
      content += `## Issues\n\n`;
      for (const issue of feedback.issues) {
        content += `- ${issue}\n`;
      }
      content += '\n';
    }

    if (feedback.suggestions) {
      content += `## Suggestions\n\n${feedback.suggestions}\n\n`;
    }

    await fs.writeFile(path, content, 'utf-8');
  }

  /**
   * Save artifact for a session
   */
  async saveArtifact(sessionId: string, artifactName: string, content: string | Buffer): Promise<string> {
    const artifactPath = this.getArtifactsPath(sessionId);

    if (!existsSync(artifactPath)) {
      await fs.mkdir(artifactPath, { recursive: true });
    }

    const filePath = join(artifactPath, artifactName);
    await fs.writeFile(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Get artifact path
   */
  async getArtifact(sessionId: string, artifactName: string): Promise<string | null> {
    const filePath = join(this.getArtifactsPath(sessionId), artifactName);

    if (!existsSync(filePath)) {
      return null;
    }

    return filePath;
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionMetadata[]> {
    const sessions: SessionMetadata[] = [];

    if (!existsSync(this.sessionsDir)) {
      return sessions;
    }

    const files = await fs.readdir(this.sessionsDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const sessionId = file.replace('.md', '');
      const metadata = await this.getMetadata(sessionId);
      if (metadata) {
        sessions.push(metadata);
      }
    }

    return sessions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = this.getSessionPath(sessionId);
    const feedbackPath = this.getFeedbackPath(sessionId);
    const artifactPath = this.getArtifactsPath(sessionId);

    if (existsSync(sessionPath)) {
      await fs.unlink(sessionPath);
    }

    if (existsSync(feedbackPath)) {
      await fs.unlink(feedbackPath);
    }

    if (existsSync(artifactPath)) {
      await fs.rm(artifactPath, { recursive: true, force: true });
    }
  }

  /**
   * Clear old sessions (older than specified days)
   */
  async clearOldSessions(daysOld: number = 30): Promise<number> {
    const sessions = await this.listSessions();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    let deleted = 0;

    for (const session of sessions) {
      if (session.createdAt < cutoffDate) {
        await this.deleteSession(session.sessionId);
        deleted++;
      }
    }

    return deleted;
  }
}

// Singleton instance
let sessionStore: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!sessionStore) {
    sessionStore = new SessionStore();
  }
  return sessionStore;
}

export function createSessionStore(baseDir?: string): SessionStore {
  return new SessionStore(baseDir);
}
