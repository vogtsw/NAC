/**
 * Mode / Approval / Sandbox integration tests.
 * Verifies that plan/agent/yolo modes are enforced at every tool call.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { checkModeToolAccess } from '../src/security/ModeToolGate.js';
import { ApprovalManager } from '../src/security/ApprovalManager.js';

describe('ModeToolGate — plan mode', () => {
  it('allows read tools', () => {
    expect(checkModeToolAccess('file-ops', 'plan', { operation: 'read' }).allowed).toBe(true);
    expect(checkModeToolAccess('grep', 'plan').allowed).toBe(true);
    expect(checkModeToolAccess('diagnostics', 'plan').allowed).toBe(true);
  });

  it('blocks write tools', () => {
    const write = checkModeToolAccess('file-ops', 'plan', { operation: 'write' });
    expect(write.allowed).toBe(false);
    expect(write.reason).toContain('Plan mode');

    const patch = checkModeToolAccess('apply-patch', 'plan');
    expect(patch.allowed).toBe(false);
  });

  it('blocks destructive tools', () => {
    const rm = checkModeToolAccess('file-ops', 'plan', { operation: 'delete' });
    expect(rm.allowed).toBe(false);

    const bash = checkModeToolAccess('terminal-exec', 'plan');
    expect(bash.allowed).toBe(false);
  });

  it('blocks network tools', () => {
    const ws = checkModeToolAccess('web-search', 'plan');
    expect(ws.allowed).toBe(false);
  });
});

describe('ModeToolGate — agent mode', () => {
  it('allows read tools', () => {
    expect(checkModeToolAccess('file-ops', 'agent', { operation: 'read' }).allowed).toBe(true);
  });

  it('allows write tools (delegates approval to ApprovalManager)', () => {
    // In agent mode, writes are allowed through the gate but require approval
    const write = checkModeToolAccess('file-ops', 'agent', { operation: 'write' });
    expect(write.allowed).toBe(true);
  });

  it('blocks git write without explicit approval', () => {
    const commit = checkModeToolAccess('git_commit', 'agent');
    expect(commit.allowed).toBe(false);
    expect(commit.reason).toContain('approval');
  });

  it('blocks git push', () => {
    const push = checkModeToolAccess('git_push', 'agent');
    expect(push.allowed).toBe(false);
  });

  it('blocks network tools without explicit approval', () => {
    const net = checkModeToolAccess('web_search', 'agent');
    expect(net.allowed).toBe(false);
  });

  it('requires confirmation for file delete', () => {
    const del = checkModeToolAccess('file-ops', 'agent', { operation: 'delete' });
    expect(del.allowed).toBe(false);
    expect(del.reason).toContain('confirmation');

    const delConfirm = checkModeToolAccess('file-ops', 'agent', { operation: 'delete', confirmed: true });
    expect(delConfirm.allowed).toBe(true);
  });
});

describe('ModeToolGate — yolo mode', () => {
  it('allows workspace writes', () => {
    expect(checkModeToolAccess('file-ops', 'yolo', { operation: 'write' }).allowed).toBe(true);
    expect(checkModeToolAccess('apply-patch', 'yolo').allowed).toBe(true);
  });

  it('still blocks git push', () => {
    const push = checkModeToolAccess('git_push', 'yolo');
    expect(push.allowed).toBe(false);
    expect(push.reason).toContain('git push');
  });
});

describe('ModeToolGate — edge cases', () => {
  it('defaults to agent mode for invalid mode', () => {
    const r = checkModeToolAccess('file-ops', 'invalid' as any, { operation: 'read' });
    expect(r.allowed).toBe(true);
  });

  it('handles undefined mode gracefully', () => {
    const r = checkModeToolAccess('file-ops', undefined, { operation: 'read' });
    expect(r.allowed).toBe(true);
  });

  it('normalizes tool names', () => {
    const r = checkModeToolAccess('apply-patch', 'plan');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('write');
  });
});

describe('ApprovalManager', () => {
  it('denies all writes in plan mode', () => {
    const am = new ApprovalManager();
    const r = am.evaluate('file_write', 'plan');
    expect(r.allowed).toBe(false);
  });

  it('requires interactive approval in agent mode', () => {
    const am = new ApprovalManager();
    const r = am.evaluate('file_write', 'agent');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('interactive');
  });

  it('auto-approves writes in yolo mode', () => {
    const am = new ApprovalManager();
    const r = am.evaluate('file_write', 'yolo');
    expect(r.allowed).toBe(true);
  });

  it('still blocks git push in yolo mode', () => {
    const am = new ApprovalManager();
    const r = am.evaluate('git_push', 'yolo');
    expect(r.allowed).toBe(false);
  });

  it('respects deterministic test policy', () => {
    const am = new ApprovalManager({
      rules: { file_write: 'allow', git_push: 'deny' },
    });
    expect(am.evaluate('file_write', 'agent').allowed).toBe(true);
    expect(am.evaluate('git_push', 'agent').allowed).toBe(false);
  });

  it('queues and lists pending approvals', () => {
    const am = new ApprovalManager({ interactive: true });
    am.queueApproval('req1', 'git_commit');
    const pending = am.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe('git_commit');
  });

  it('clears pending requests', () => {
    const am = new ApprovalManager({ interactive: true });
    am.queueApproval('req1', 'file_delete');
    am.clearPending();
    expect(am.listPending()).toHaveLength(0);
  });
});
