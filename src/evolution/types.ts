/**
 * Evolution System Types
 * Types for feedback collection, prompt optimization, and DAG optimization
 */

/**
 * Task execution feedback
 */
export interface TaskFeedback {
  // Session & Task
  sessionId: string;
  taskId: string;
  timestamp: Date;

  // Execution Info
  agentType: string;
  systemPromptUsed: string;
  skillsUsed: string[];
  executionTime: number;
  success: boolean;

  // DAG Execution
  totalAgents: number;
  agentSequence: string[];
  parallelGroups: number;
  actualExecutionTime: number;

  // User Feedback
  rating?: number; // 1-5
  satisfied?: boolean;
  issues?: string[];
  suggestions?: string[];
  underperformingAgents?: string[];
  optimizableSteps?: string[];
  retry?: boolean;
}

/**
 * Feedback collection result
 */
export interface FeedbackCollectionResult {
  success: boolean;
  feedbackId?: string;
  message: string;
}

/**
 * Prompt optimization result
 */
export interface PromptOptimizationResult {
  success: boolean;
  agentType: string;
  oldPrompt: string;
  newPrompt: string;
  improvements: string[];
}

/**
 * Feedback statistics
 */
export interface FeedbackStatistics {
  totalFeedbacks: number;
  averageRating: number;
  successRate: number;
  agentPerformance: Record<string, {
    totalTasks: number;
    averageRating: number;
    averageExecutionTime: number;
  }>;
  commonIssues: string[];
}
