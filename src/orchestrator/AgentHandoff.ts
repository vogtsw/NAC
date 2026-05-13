/**
 * Agent Handoff Protocol
 * Structured JSON-schema-based handoff between agents in the cluster.
 * All inter-agent communication uses typed payloads instead of natural language.
 */

export type ArtifactType =
  | "plan"
  | "repo_context"
  | "repo_map"
  | "file_summary"
  | "patch"
  | "test_report"
  | "failure_analysis"
  | "review"
  | "final_answer";

export interface AgentHandoff<T = unknown> {
  fromAgent: string;
  toAgent: string;
  runId: string;
  artifactType: ArtifactType;
  confidence: number;
  payload: T;
  nextAction: string;
  tokenCost?: number;
  timestamp: number;
}

export interface PlanArtifact {
  goal: string;
  steps: Array<{
    id: string;
    name: string;
    description: string;
    agentRole: string;
    dependencies: string[];
    expectedOutput: string;
  }>;
  constraints: string[];
  assumptions: string[];
  riskLevel: "low" | "medium" | "high" | "critical";
}

export interface RepoContextArtifact {
  repoPath: string;
  fileTree: string;
  keyFiles: Array<{
    path: string;
    purpose: string;
    complexity: "simple" | "moderate" | "complex";
  }>;
  dependencies: Record<string, string>;
  architectureNotes: string;
}

export interface PatchArtifact {
  files: Array<{
    path: string;
    operation: "create" | "modify" | "delete";
    diff: string;
    newContent: string;
  }>;
  summary: string;
  breakingChanges: boolean;
  fileCount: number;
  linesAdded: number;
  linesRemoved: number;
}

export interface TestReportArtifact {
  command: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{
    testName: string;
    error: string;
    suggestion: string;
  }>;
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
  };
}

export interface ReviewArtifact {
  overallScore: number;
  issues: Array<{
    severity: "critical" | "major" | "minor" | "info";
    category: "security" | "performance" | "correctness" | "style" | "architecture";
    description: string;
    location?: string;
    suggestedFix?: string;
  }>;
  approved: boolean;
  suggestions: string[];
  riskLevel: "low" | "medium" | "high";
}

export interface ClusterArtifact<T = unknown> {
  id: string;
  runId: string;
  type: ArtifactType;
  producer: string;
  consumers: string[];
  content: T;
  confidence: number;
  tokenCost?: number;
  model?: string;
  thinkingEnabled?: boolean;
  createdAt: number;
}

/**
 * Validate a handoff payload matches expected schema.
 */
export function validateHandoff<T>(
  handoff: AgentHandoff<T>,
  expectedType: ArtifactType,
): boolean {
  return handoff.artifactType === expectedType && handoff.confidence > 0;
}

/**
 * Create a typed handoff from one agent to another.
 */
export function createHandoff<T>(args: {
  fromAgent: string;
  toAgent: string;
  runId: string;
  artifactType: ArtifactType;
  confidence: number;
  payload: T;
  nextAction: string;
  tokenCost?: number;
}): AgentHandoff<T> {
  return {
    fromAgent: args.fromAgent,
    toAgent: args.toAgent,
    runId: args.runId,
    artifactType: args.artifactType,
    confidence: args.confidence,
    payload: args.payload,
    nextAction: args.nextAction,
    tokenCost: args.tokenCost,
    timestamp: Date.now(),
  };
}
