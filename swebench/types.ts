/**
 * SWE-bench integration types — real GitHub issue evaluation harness.
 * Based on SWE-bench/SWE-bench_Lite schema.
 */

export interface SWEBenchInstance {
  repo: string; // e.g. "pallets/flask"
  instance_id: string; // e.g. "pallets__flask-4045"
  base_commit: string; // commit to checkout before fix
  patch: string; // gold fix patch
  test_patch: string; // test-only patch that adds the failing test
  problem_statement: string;
  hints_text: string;
  created_at: string;
  version: string;
  FAIL_TO_PASS: string; // JSON array of test IDs
  PASS_TO_PASS: string; // JSON array of test IDs that must stay passing
  environment_setup_commit: string;
}

export interface SWEBenchEvalResult {
  instance_id: string;
  repo: string;
  resolved: boolean; // all FAIL_TO_PASS pass AND all PASS_TO_PASS still pass
  failToPass: number;
  failToPassPassed: number;
  passToPass: number;
  passToPassStillPass: number;
  model: string;
  tokensUsed: number;
  cost: number;
  durationMs: number;
  patch?: string;
  error?: string;
}

export interface SandboxInfo {
  repoPath: string;
  venvPath: string;
  pythonBin: string;
  pipBin: string;
  testCmd: string;
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, string>;
  result: string;
}

export interface AgentRunResult {
  patch: string;
  toolCalls: AgentToolCall[];
  tokens: number;
  cost: number;
  durationMs: number;
}
