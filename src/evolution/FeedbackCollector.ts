/**
 * Feedback Collector
 * Collect and manage user feedback for task execution
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { existsSync } from 'fs';
import { getLogger } from '../monitoring/logger.js';
import type { TaskFeedback, FeedbackCollectionResult, FeedbackStatistics } from './types.js';

const logger = getLogger('FeedbackCollector');

/**
 * Feedback storage directory
 */
const FEEDBACK_DIR = join(process.cwd(), 'memory', 'feedback');

/**
 * Feedback Collector - Collect and manage user feedback
 */
export class FeedbackCollector {
  private initialized: boolean = false;

  /**
   * Initialize the feedback collector
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure feedback directory exists
    if (!existsSync(FEEDBACK_DIR)) {
      await fs.mkdir(FEEDBACK_DIR, { recursive: true });
    }

    this.initialized = true;
    logger.info('FeedbackCollector initialized');
  }

  /**
   * Collect feedback for a task execution
   */
  async collectFeedback(feedback: TaskFeedback): Promise<FeedbackCollectionResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const feedbackId = `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const filePath = join(FEEDBACK_DIR, `${feedbackId}.json`);

      // Add feedback ID
      const feedbackWithId = {
        ...feedback,
        feedbackId,
      };

      // Save to file
      await fs.writeFile(filePath, JSON.stringify(feedbackWithId, null, 2));

      logger.info({
        feedbackId,
        sessionId: feedback.sessionId,
        agentType: feedback.agentType,
        rating: feedback.rating,
        success: feedback.success,
      }, 'Feedback collected');

      return {
        success: true,
        feedbackId,
        message: 'Feedback collected successfully',
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to collect feedback');
      return {
        success: false,
        message: `Failed to collect feedback: ${error.message}`,
      };
    }
  }

  /**
   * Get feedback for a specific agent
   */
  async getFeedbackForAgent(agentType: string, limit: number = 50): Promise<TaskFeedback[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(FEEDBACK_DIR);
      const feedbackFiles = files.filter(f => f.endsWith('.json'));

      const feedbacks: TaskFeedback[] = [];

      for (const file of feedbackFiles) {
        if (feedbacks.length >= limit) break;

        try {
          const content = await fs.readFile(join(FEEDBACK_DIR, file), 'utf-8');
          const feedback = JSON.parse(content) as TaskFeedback;

          if (feedback.agentType === agentType) {
            feedbacks.push(feedback);
          }
        } catch (error) {
          // Skip invalid files
          logger.warn({ file, error }, 'Failed to read feedback file');
        }
      }

      // Sort by timestamp (newest first)
      feedbacks.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return feedbacks;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get feedback for agent');
      return [];
    }
  }

  /**
   * Get feedback for a session
   */
  async getFeedbackForSession(sessionId: string): Promise<TaskFeedback[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(FEEDBACK_DIR);
      const feedbackFiles = files.filter(f => f.endsWith('.json'));

      const feedbacks: TaskFeedback[] = [];

      for (const file of feedbackFiles) {
        try {
          const content = await fs.readFile(join(FEEDBACK_DIR, file), 'utf-8');
          const feedback = JSON.parse(content) as TaskFeedback;

          if (feedback.sessionId === sessionId) {
            feedbacks.push(feedback);
          }
        } catch (error) {
          // Skip invalid files
        }
      }

      return feedbacks.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } catch (error: any) {
      logger.error({ error, sessionId }, 'Failed to get feedback for session');
      return [];
    }
  }

  /**
   * Get feedback statistics
   */
  async getStatistics(): Promise<FeedbackStatistics> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(FEEDBACK_DIR);
      const feedbackFiles = files.filter(f => f.endsWith('.json'));

      const allFeedbacks: TaskFeedback[] = [];

      for (const file of feedbackFiles) {
        try {
          const content = await fs.readFile(join(FEEDBACK_DIR, file), 'utf-8');
          const feedback = JSON.parse(content) as TaskFeedback;
          allFeedbacks.push(feedback);
        } catch (error) {
          // Skip invalid files
        }
      }

      // Calculate statistics
      const totalFeedbacks = allFeedbacks.length;
      const ratings = allFeedbacks.filter(f => f.rating !== undefined).map(f => f.rating!);
      const averageRating = ratings.length > 0
        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
        : 0;

      const successCount = allFeedbacks.filter(f => f.success).length;
      const successRate = totalFeedbacks > 0 ? successCount / totalFeedbacks : 0;

      // Agent performance
      const agentPerformance: Record<string, {
        totalTasks: number;
        averageRating: number;
        averageExecutionTime: number;
      }> = {};

      for (const feedback of allFeedbacks) {
        if (!agentPerformance[feedback.agentType]) {
          agentPerformance[feedback.agentType] = {
            totalTasks: 0,
            averageRating: 0,
            averageExecutionTime: 0,
          };
        }

        const perf = agentPerformance[feedback.agentType];
        perf.totalTasks++;

        if (feedback.rating !== undefined) {
          perf.averageRating = (perf.averageRating * (perf.totalTasks - 1) + feedback.rating) / perf.totalTasks;
        }

        perf.averageExecutionTime = (perf.averageExecutionTime * (perf.totalTasks - 1) + feedback.executionTime) / perf.totalTasks;
      }

      // Common issues
      const allIssues = allFeedbacks
        .flatMap(f => f.issues || [])
        .reduce((acc: Record<string, number>, issue) => {
          acc[issue] = (acc[issue] || 0) + 1;
          return acc;
        }, {});

      const commonIssues = Object.entries(allIssues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([issue, count]) => `${issue} (${count})`);

      return {
        totalFeedbacks,
        averageRating,
        successRate,
        agentPerformance,
        commonIssues,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get statistics');
      return {
        totalFeedbacks: 0,
        averageRating: 0,
        successRate: 0,
        agentPerformance: {},
        commonIssues: [],
      };
    }
  }

  /**
   * Delete feedback by ID
   */
  async deleteFeedback(feedbackId: string): Promise<boolean> {
    try {
      const filePath = join(FEEDBACK_DIR, `${feedbackId}.json`);

      if (!existsSync(filePath)) {
        return false;
      }

      await fs.unlink(filePath);
      logger.info({ feedbackId }, 'Feedback deleted');
      return true;
    } catch (error: any) {
      logger.error({ error, feedbackId }, 'Failed to delete feedback');
      return false;
    }
  }

  /**
   * Clean old feedback (older than specified days)
   */
  async cleanOldFeedback(daysToKeep: number = 30): Promise<number> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(FEEDBACK_DIR);
      const feedbackFiles = files.filter(f => f.endsWith('.json'));

      const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of feedbackFiles) {
        const filePath = join(FEEDBACK_DIR, file);
        const stats = await fs.stat(filePath);

        if (stats.mtimeMs < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }

      logger.info({ deletedCount, daysToKeep }, 'Old feedback cleaned');
      return deletedCount;
    } catch (error: any) {
      logger.error({ error }, 'Failed to clean old feedback');
      return 0;
    }
  }
}

// Singleton instance
let feedbackCollector: FeedbackCollector | null = null;

export function getFeedbackCollector(): FeedbackCollector {
  if (!feedbackCollector) {
    feedbackCollector = new FeedbackCollector();
  }
  return feedbackCollector;
}

export function createFeedbackCollector(): FeedbackCollector {
  return new FeedbackCollector();
}
