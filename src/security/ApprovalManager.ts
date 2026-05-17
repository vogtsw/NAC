/**
 * ApprovalManager — interactive approval for agent-mode tool calls.
 *
 * In plan mode: writes are always denied (handled by ModeToolGate).
 * In agent mode: writes, network, and git-write require explicit approval.
 * In yolo mode: most writes are auto-approved, but git-push and external paths still denied.
 *
 * Supports deterministic approval policies for testing.
 */

import type { ModeToolDecision, RuntimeMode } from './ModeToolGate.js';

export type ApprovalDecision = 'allow' | 'deny' | 'ask';

export interface ApprovalRule {
  toolName: string;
  decision: ApprovalDecision;
  reason?: string;
}

export interface ApprovalPolicy {
  /** Deterministic policy for tests: toolName → decision */
  rules?: Record<string, ApprovalDecision>;
  /** In interactive mode, pending decisions are queued for user input */
  interactive?: boolean;
}

export class ApprovalManager {
  private policy: ApprovalPolicy;
  private pending: Map<string, { toolName: string; params?: Record<string, unknown>; resolve?: (d: ApprovalDecision) => void }> = new Map();

  constructor(policy: ApprovalPolicy = {}) {
    this.policy = { interactive: true, ...policy };
  }

  /**
   * Check whether a tool call requires approval.
   * Returns 'ask' when interactive approval is needed.
   */
  evaluate(
    toolName: string,
    mode: RuntimeMode,
    params?: Record<string, unknown>,
  ): ModeToolDecision {
    // Deterministic test policy takes precedence
    if (this.policy.rules) {
      const rule = this.policy.rules[toolName];
      if (rule) {
        return {
          allowed: rule === 'allow',
          reason: rule === 'allow' ? undefined : `Denied by deterministic policy: ${toolName}`,
        };
      }
      // No explicit rule → fall through to mode-based defaults
    }

    if (mode === 'plan') {
      // Plan mode: any write/destructive is already blocked by ModeToolGate
      return { allowed: false, reason: 'Plan mode: no writes allowed' };
    }

    if (mode === 'agent') {
      return {
        allowed: false,
        reason: `Agent mode: ${toolName} requires interactive approval`,
      };
    }

    // YOLO: auto-approve unless it's git push
    if (toolName === 'git_push' || toolName === 'git-ops') {
      return { allowed: false, reason: 'YOLO mode: git push requires explicit approval' };
    }

    return { allowed: true };
  }

  /**
   * Queue a pending approval request for interactive mode.
   * In tests with deterministic policy, resolves immediately.
   */
  queueApproval(id: string, toolName: string, params?: Record<string, unknown>): ModeToolDecision {
    if (this.policy.rules) {
      const rule = this.policy.rules[toolName];
      if (rule === 'allow') return { allowed: true };
      if (rule === 'deny') return { allowed: false, reason: `Denied: ${toolName}` };
    }

    if (!this.policy.interactive) {
      return { allowed: false, reason: `Non-interactive mode: ${toolName} requires approval` };
    }

    this.pending.set(id, { toolName, params });
    return { allowed: false, reason: `Approval required for: ${toolName}. Use approve/deny commands.` };
  }

  approve(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve?.('allow');
    this.pending.delete(id);
    return true;
  }

  deny(id: string): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve?.('deny');
    this.pending.delete(id);
    return true;
  }

  listPending(): Array<{ id: string; toolName: string; params?: Record<string, unknown> }> {
    return Array.from(this.pending.entries()).map(([id, entry]) => ({
      id,
      toolName: entry.toolName,
      params: entry.params,
    }));
  }

  clearPending(): void {
    for (const [, entry] of this.pending) {
      entry.resolve?.('deny');
    }
    this.pending.clear();
  }
}
