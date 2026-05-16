/**
 * State Models
 * Type definitions for the system
 */

export interface Intent {
  type: 'code' | 'data' | 'automation' | 'analysis' | 'deployment' | 'other' | 'conversation';
  primaryGoal: string;
  capabilities: string[];
  complexity: 'simple' | 'medium' | 'complex';
  estimatedSteps: number;
  constraints: string[];
  conversationType?: 'greeting' | 'thanks' | 'farewell' | 'chat' | 'help';
}

export interface Task {
  id: string;
  name: string;
  description: string;
  agentType: string;
  requiredSkills: string[];
  dependencies: string[];
  estimatedDuration: number;
  searchQuery?: string;
  status?: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: string;
  // New fields for reliability and optimization
  priority?: number;           // 0-10, 0 highest
  lane?: string;               // Lane identifier for queue management
  idempotencyKey?: string;     // Key for deduplication
  requiredResources?: string[]; // Resources needed for execution
  timeout?: number;            // Task timeout in milliseconds
  retryPolicy?: RetryPolicy;   // Custom retry policy
  maxRetries?: number;         // Maximum retry attempts
  retryCount?: number;         // Current retry attempt
  contract?: TaskContract;     // Engineering contract for DAG execution
  // DeepSeek cluster: model routing preserved from ClusterDAGBuilder
  model?: "deepseek-v4-pro" | "deepseek-v4-flash";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  inputArtifacts?: string[];
  outputArtifact?: string;
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
  model?: "deepseek-v4-pro" | "deepseek-v4-flash";
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
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

/**
 * Retry Policy Configuration
 */
export interface RetryPolicy {
  maxAttempts: number;
  strategy: 'exponential' | 'linear' | 'fixed';
  timeout: number;       // Task timeout in milliseconds
  baseDelay?: number;    // Base delay for backoff (ms)
}

/**
 * Task Lane Configuration for Priority Queues
 */
/**
 * TaskContract — engineering contract for DAG tasks.
 * Each sub-agent task must specify what it needs and what it should produce.
 */
export interface TaskContract {
  objective: string;
  inputs: string[];
  expectedArtifacts: string[];
  acceptanceCriteria: string[];
  allowedTools: string[];
  maxIterations: number;
}

/**
 * TaskResult — structured result from a DAG task execution.
 * The DAG scheduler uses this to decide: complete, retry, or re-plan.
 */
export interface TaskResult {
  status: "success" | "partial" | "failed";
  summary: string;
  artifacts: string[];
  evidence: string[];
  nextActions: string[];
}

export interface TaskLane {
  priority: number;        // 0-10, 0 highest
  maxConcurrency: number;  // Maximum concurrent tasks in this lane
  timeout: number;         // Default timeout for tasks in this lane (ms)
  retryPolicy: RetryPolicy;
  description: string;
}

/**
 * Session State Version Control
 */
export interface VersionedSessionState {
  version: number;         // Version number for optimistic locking
  lastModified: Date;      // Last modification timestamp
}

/**
 * Permission Types for Skill Authorization
 */
export enum Permission {
  FILE_READ = 'file:read',
  FILE_WRITE = 'file:write',
  FILE_DELETE = 'file:delete',
  NETWORK_HTTP = 'network:http',
  NETWORK_HTTPS = 'network:https',
  SYSTEM_EXEC = 'system:exec',
  ENV_READ = 'env:read',
  ENV_WRITE = 'env:write',
  LLM_ACCESS = 'llm:access',
}

/**
 * Skill Permissions Configuration
 */
export interface SkillPermissions {
  skillId: string;
  permissions: Permission[];
  resourceLimits?: {
    maxFileSize: number;        // bytes
    maxExecutionTime: number;   // milliseconds
    allowedPaths: string[];
  };
  audit: boolean;
}
