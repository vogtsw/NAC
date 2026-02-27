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

/**
 * Agent 能力描述
 */
export interface AgentCapability {
  agentType: string;
  description: string;
  strengths?: string[];
  weaknesses?: string[];
  idealTasks?: string[];
  requiredSkills?: string[];
  examples?: string[];
}

/**
 * Agent 匹配结果
 */
export interface AgentMatchResult {
  agentType: string;
  confidence: number;
  reason: string;
  suggestedSkills: string[];
}

/**
 * Agent 类型类（用于动态创建实例）
 */
export interface AgentTypeClass {
  new (llm: any, skillManager: any, agentType: string): any;
}

/**
 * 路由器配置
 */
export interface RouterConfig {
  enableCache?: boolean;
  cacheTTL?: number;
  fallbackToGeneric?: boolean;
  collaborationThreshold?: number;
}

/**
 * Agent Profile（用于自定义 Agent 配置）
 */
export interface AgentProfileConfig {
  agentType: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  idealTasks: string[];
  requiredSkills: string[];
  examples: string[];
  version: string;
  author?: string;
  systemPromptFile?: string;
}
