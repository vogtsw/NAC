/**
 * Core types for the Agent Harness.
 * Defines the message/tool/turn/state primitives that the agent loop operates on.
 */
import type { z } from "zod";

// ── Messages ──────────────────────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolCallContent {
  type: "tool_call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  toolCallId: string;
  name: string;
  result: string;
  isError?: boolean;
}

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessageContent[];
  timestamp?: number;
}

// ── Tools ──────────────────────────────────────────────────

export interface ToolParamDef {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParamDef>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParamDef[];
  /** Whether this tool is safe to parallelize with other safe tools */
  safeForParallel?: boolean;
  /** Whether this tool requires human approval before execution */
  requiresApproval?: boolean;
  /** Schema as JSON Schema object (generated at registration time) */
  jsonSchema?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  result: string;
  isError: boolean;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutorFn {
  (args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult>;
}

export interface ToolExecutionContext {
  sessionId: string;
  workingDir: string;
  approvedPaths: Set<string>;
  signal?: AbortSignal;
}

// ── Agent Loop ─────────────────────────────────────────────

export interface AgentConfig {
  model: string;
  provider: "deepseek" | "openai" | "custom";
  baseUrl?: string;
  apiKey?: string;
  maxIterations: number;
  temperature: number;
  maxTokens: number;
  systemPrompt?: string;
  skills?: string[];
  workingDir?: string;
}

export interface AgentTurn {
  index: number;
  messages: Message[];
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  llmResponse?: string;
  reasoning?: string;
  duration: number;
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
}

export type AgentStopReason =
  | "stop_sequence"       // model returned stop
  | "max_iterations"      // hit iteration limit
  | "tool_loop_detected"  // repeated tool calls detected
  | "user_interrupt"      // user cancelled
  | "error"               // unrecoverable error
  | "task_completed";     // explicit completion tool called

export interface AgentResult {
  turns: AgentTurn[];
  stopReason: AgentStopReason;
  finalResponse: string;
  totalDuration: number;
  totalTokens: TokenUsage;
  toolCallCount: number;
  toolSuccessRate: number;
}

// ── Session ────────────────────────────────────────────────

export interface SessionState {
  id: string;
  status: "active" | "completed" | "failed" | "compressed";
  parentSessionId?: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown>;
}

// ── Memory ─────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  type: "fact" | "preference" | "pattern" | "feedback";
  content: string;
  source: string;
  confidence: number;
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  tags: string[];
}

// ── Trajectory (for evaluation / SFT data) ─────────────────

export interface TrajectoryStep {
  stepIndex: number;
  observation: string;
  reasoning: string;
  action: { tool: string; args: Record<string, unknown> } | null;
  result: string;
  isError: boolean;
  duration: number;
}

export interface Trajectory {
  id: string;
  sessionId: string;
  task: string;
  steps: TrajectoryStep[];
  outcome: "success" | "failure" | "partial";
  totalSteps: number;
  totalDuration: number;
  annotations?: TrajectoryAnnotation[];
  createdAt: number;
}

export interface TrajectoryAnnotation {
  type: "score" | "label" | "correction";
  value: string | number;
  annotator: "human" | "auto" | "llm";
  timestamp: number;
}

// ── Eval Metrics ───────────────────────────────────────────

export interface EvalMetrics {
  taskCompletionRate: number;
  toolCallSuccessRate: number;
  avgIterationsPerTask: number;
  avgTokensPerTask: number;
  avgDurationPerTask: number;
  trajectoryCount: number;
  annotatedTrajectoryCount: number;
}

export interface FeedbackEntry {
  id: string;
  sessionId: string;
  task: string;
  rating: number;
  issues: string[];
  suggestions: string[];
  timestamp: number;
}
