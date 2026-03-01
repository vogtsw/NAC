/**
 * State Models Extension
 * Extended type definitions for user profiles and scheduled tasks
 */

export interface UserProfileData {
  userId: string;
  preferences: UserPreferences;
  history: InteractionHistory[];
  statistics: UserStatistics;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPreferences {
  // 编程偏好
  programming: {
    defaultLanguage: string;
    preferredLanguages: string[];
    codeStyle: 'functional' | 'oop' | 'procedural';
    frameworks: string[];
    tools: string[];
  };
  // Agent 偏好
  agents: {
    preferredAgents: string[];
    avoidedAgents: string[];
    defaultAgent: string;
  };
  // 技能偏好
  skills: {
    frequentlyUsed: string[];
    customSettings: Record<string, any>;
  };
  // 交互偏好
  interaction: {
    verbosity: 'concise' | 'normal' | 'detailed';
    language: 'zh-CN' | 'en-US';
    timeZone: string;
    theme: 'light' | 'dark';
  };
}

export interface InteractionHistory {
  sessionId: string;
  timestamp: Date;
  userInput: string;
  agentUsed: string;
  skillsUsed: string[];
  executionTime: number;
  success: boolean;
  rating?: number;
}

export interface UserStatistics {
  totalInteractions: number;
  totalTasksCompleted: number;
  averageExecutionTime: number;
  mostUsedAgents: Record<string, number>;
  mostUsedSkills: Record<string, number>;
  successRate: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  type: 'once' | 'cron' | 'delay';
  schedule: ScheduleConfig;
  task: {
    userInput: string;
    context?: Record<string, any>;
    userId?: string;
  };
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  executions: ExecutionRecord[];
  createdAt: Date;
  nextRunAt?: Date;
  lastRunAt?: Date;
  completedAt?: Date;
}

export interface ScheduleConfig {
  once?: {
    executeAt: Date;
  };
  cron?: {
    expression: string;
    timezone?: string;
    startDate?: Date;
    endDate?: Date;
    maxRuns?: number;
  };
  delay?: {
    delayMs: number;
  };
}

export interface ExecutionRecord {
  runId: string;
  startedAt: Date;
  completedAt?: Date;
  status: 'running' | 'success' | 'failed';
  result?: any;
  error?: string;
}
