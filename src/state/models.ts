/**
 * State Models
 * Type definitions for the system
 */

export interface Intent {
  type: 'code' | 'data' | 'automation' | 'analysis' | 'deployment' | 'other';
  primaryGoal: string;
  capabilities: string[];
  complexity: 'simple' | 'medium' | 'complex';
  estimatedSteps: number;
  constraints: string[];
}

export interface Task {
  id: string;
  name: string;
  description: string;
  agentType: string;
  requiredSkills: string[];
  dependencies: string[];
  estimatedDuration: number;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export interface DAGNode {
  task: Task;
  dependencies: string[];
}

export interface AgentInfo {
  agentId: string;
  agentType: string;
  status: 'idle' | 'busy' | 'error';
  currentTask?: string;
  capabilities: string[];
  tasksCompleted: number;
  totalExecutionTime: number;
  createdAt: Date;
}

export interface SkillResult {
  success: boolean;
  result?: any;
  error?: string;
  metadata?: Record<string, any>;
}

export interface ExecutionContext {
  sessionId: string;
  taskId?: string;
  agentType?: string;
  tools: Map<string, any>;
  logger: any;
  blackboard: any;
}

export interface AgentConfig {
  taskId: string;
  skills: string[];
  systemPrompt?: string;
  context?: Record<string, any>;
}

export enum AgentStatus {
  IDLE = 'idle',
  BUSY = 'busy',
  ERROR = 'error',
}
