/**
 * AgentSessionManager — persistent sub-agent session lifecycle.
 *
 * Replaces one-shot agent.execute() with open/eval/close semantics:
 * - openSession: create a session with role, model policy, tool whitelist
 * - evalSession: send a turn to the session agent, accumulate transcript
 * - closeSession: finalize, collect output contract
 * - cancelSession: abort a running / pending session
 *
 * Session fields match goal.md AgentSession interface:
 * id, runId, name, role, status, modelPolicy, allowedTools, forkContext,
 * transcriptHandle?, summary?
 *
 * Each session's LLM requests record: requested model, actual model,
 * thinking, reasoning_effort, prompt/completion/reasoning/cache tokens, duration.
 */

import { getLogger } from '../monitoring/logger.js';
import type { ModelPolicy } from '../agents/BaseAgent.js';

const logger = getLogger('AgentSessionManager');

export type SessionRole = 'coordinator' | 'explore' | 'plan' | 'implementer' | 'verifier' | 'review' | 'custom';
export type SessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SessionLLMRecord {
  turnIndex: number;
  requestedModel: string;
  actualModel: string;
  thinking: string;
  reasoningEffort: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  durationMs: number;
}

export interface AgentSession {
  id: string;
  runId: string;
  name: string;
  role: SessionRole;
  status: SessionStatus;
  modelPolicy: ModelPolicy;
  allowedTools: string[];
  forkContext: boolean;
  transcript: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  llmRecords: SessionLLMRecord[];
  artifactIds: string[];
  finalOutput?: unknown;
  summary?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export class AgentSessionManager {
  private sessions: Map<string, AgentSession> = new Map();

  openSession(params: {
    id: string;
    runId: string;
    name: string;
    role: SessionRole;
    modelPolicy?: ModelPolicy;
    allowedTools?: string[];
    forkContext?: boolean;
  }): AgentSession {
    const session: AgentSession = {
      id: params.id,
      runId: params.runId,
      name: params.name,
      role: params.role,
      status: 'pending',
      modelPolicy: params.modelPolicy || {},
      allowedTools: params.allowedTools || [],
      forkContext: params.forkContext ?? false,
      transcript: [],
      llmRecords: [],
      artifactIds: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(params.id, session);
    logger.info({ sessionId: params.id, role: params.role, runId: params.runId }, 'AgentSession opened');
    return session;
  }

  evalSession(sessionId: string, turn: { role: 'user' | 'assistant' | 'system'; content: string }): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    if (session.status === 'pending') {
      session.status = 'running';
    }

    session.transcript.push(turn);
    session.updatedAt = Date.now();
    return session;
  }

  recordLLMUsage(sessionId: string, record: SessionLLMRecord): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.llmRecords.push(record);
    session.updatedAt = Date.now();
  }

  closeSession(sessionId: string, finalOutput?: unknown, summary?: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.status = 'completed';
    session.finalOutput = finalOutput;
    session.summary = summary;
    session.updatedAt = Date.now();

    logger.info({ sessionId, role: session.role }, 'AgentSession closed');
    return session;
  }

  cancelSession(sessionId: string, reason?: string): AgentSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    session.status = 'cancelled';
    session.error = reason;
    session.updatedAt = Date.now();

    logger.warn({ sessionId, reason }, 'AgentSession cancelled');
    return session;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(runId: string): AgentSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.runId === runId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  linkArtifact(sessionId: string, artifactId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.artifactIds.push(artifactId);
    session.updatedAt = Date.now();
  }

  /** Summarize sessions for a run (for ClusterReporter) */
  summarizeRun(runId: string): {
    totalSessions: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalTurns: number;
    totalTokens: { prompt: number; completion: number; reasoning: number; cacheHit: number; cacheMiss: number };
  } {
    const sessions = this.listSessions(runId);
    const tokens = { prompt: 0, completion: 0, reasoning: 0, cacheHit: 0, cacheMiss: 0 };

    for (const s of sessions) {
      for (const r of s.llmRecords) {
        tokens.prompt += r.promptTokens;
        tokens.completion += r.completionTokens;
        tokens.reasoning += r.reasoningTokens;
        tokens.cacheHit += r.cacheHitTokens;
        tokens.cacheMiss += r.cacheMissTokens;
      }
    }

    return {
      totalSessions: sessions.length,
      completed: sessions.filter(s => s.status === 'completed').length,
      failed: sessions.filter(s => s.status === 'failed').length,
      cancelled: sessions.filter(s => s.status === 'cancelled').length,
      totalTurns: sessions.reduce((sum, s) => sum + s.transcript.length, 0),
      totalTokens: tokens,
    };
  }
}

let _sessionManager: AgentSessionManager;

export function getAgentSessionManager(): AgentSessionManager {
  if (!_sessionManager) _sessionManager = new AgentSessionManager();
  return _sessionManager;
}
