/**
 * ClusterRunStore — first-class persistent runtime for ClusterRun objects.
 *
 * Each `nac cluster` invocation creates a ClusterRun with:
 * - Unique runId (shared with TeamPlan and artifact runIds)
 * - Status lifecycle: queued → running → completed/failed/canceled
 * - Append-only event log for DAG step transitions
 * - Metrics accumulator (tokens, cache, cost, duration)
 * - Artifact index (runId + artifactType → artifact)
 *
 * Default backend: in-memory Map (production: Redis-backed Blackboard store).
 */

import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('ClusterRunStore');

export type RunStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'canceled';

export interface ClusterRunEvent {
  timestamp: number;
  type: 'run_started' | 'run_completed' | 'run_failed' | 'run_canceled'
    | 'step_started' | 'step_completed' | 'step_failed'
    | 'artifact_recorded' | 'metric_updated';
  runId: string;
  stepId?: string;
  detail?: Record<string, unknown>;
}

export interface ClusterRunMetrics {
  proTokens: number;
  flashTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  cacheHitRate: number;
  costUsd: number;
  wallClockMs: number;
  toolCalls: number;
  toolSuccessRate: number;
  testsRun: string[];
  testsPassed: boolean;
}

export interface ClusterRunRecord {
  id: string;
  goal: string;
  mode: 'plan' | 'agent' | 'yolo';
  status: RunStatus;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  teamPlan?: unknown;
  dag?: unknown;
  artifactIds: string[];
  events: ClusterRunEvent[];
  metrics: ClusterRunMetrics;
  error?: string;
}

const DEFAULT_METRICS: ClusterRunMetrics = {
  proTokens: 0,
  flashTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  cacheHitRate: 0,
  costUsd: 0,
  wallClockMs: 0,
  toolCalls: 0,
  toolSuccessRate: 1,
  testsRun: [],
  testsPassed: false,
};

export class ClusterRunStore {
  private runs: Map<string, ClusterRunRecord> = new Map();

  createRun(run: {
    id: string;
    goal: string;
    mode: 'plan' | 'agent' | 'yolo';
    cwd?: string;
    teamPlan?: unknown;
    dag?: unknown;
  }): ClusterRunRecord {
    const record: ClusterRunRecord = {
      id: run.id,
      goal: run.goal,
      mode: run.mode,
      status: 'queued',
      cwd: run.cwd || process.cwd(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      teamPlan: run.teamPlan,
      dag: run.dag,
      artifactIds: [],
      events: [],
      metrics: { ...DEFAULT_METRICS },
    };

    this.runs.set(run.id, record);
    logger.info({ runId: run.id, mode: run.mode }, 'ClusterRun created');
    this.appendEvent(run.id, { timestamp: Date.now(), type: 'run_started', runId: run.id });
    return record;
  }

  updateRunStatus(runId: string, status: RunStatus, error?: string): ClusterRunRecord | undefined {
    const record = this.runs.get(runId);
    if (!record) {
      logger.warn({ runId }, 'Attempted to update non-existent run');
      return undefined;
    }
    record.status = status;
    record.updatedAt = Date.now();
    if (error) record.error = error;

    const eventType = status === 'completed' ? 'run_completed'
      : status === 'failed' ? 'run_failed'
      : status === 'canceled' ? 'run_canceled'
      : 'run_started';

    this.appendEvent(runId, { timestamp: Date.now(), type: eventType, runId, detail: error ? { error } : undefined });

    logger.info({ runId, status }, 'ClusterRun status updated');
    return record;
  }

  appendEvent(runId: string, event: ClusterRunEvent): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.events.push(event);
    record.updatedAt = Date.now();
  }

  recordArtifact(runId: string, artifactId: string): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.artifactIds.push(artifactId);
    record.updatedAt = Date.now();
    this.appendEvent(runId, {
      timestamp: Date.now(),
      type: 'artifact_recorded',
      runId,
      detail: { artifactId },
    });
  }

  recordMetrics(runId: string, partial: Partial<ClusterRunMetrics>): void {
    const record = this.runs.get(runId);
    if (!record) return;
    Object.assign(record.metrics, partial);
    record.updatedAt = Date.now();
    // Recalculate cache hit rate when token counts change
    if (partial.cacheHitTokens !== undefined || partial.cacheMissTokens !== undefined) {
      const total = record.metrics.cacheHitTokens + record.metrics.cacheMissTokens;
      record.metrics.cacheHitRate = total > 0 ? record.metrics.cacheHitTokens / total : 0;
    }
    this.appendEvent(runId, {
      timestamp: Date.now(),
      type: 'metric_updated',
      runId,
      detail: partial as Record<string, unknown>,
    });
  }

  recordStepEvent(runId: string, stepId: string, type: 'step_started' | 'step_completed' | 'step_failed', detail?: Record<string, unknown>): void {
    this.appendEvent(runId, { timestamp: Date.now(), type, runId, stepId, detail });
  }

  getRun(runId: string): ClusterRunRecord | undefined {
    return this.runs.get(runId);
  }

  listRuns(filter?: { status?: RunStatus; mode?: string }): ClusterRunRecord[] {
    let runs = Array.from(this.runs.values());
    if (filter?.status) runs = runs.filter(r => r.status === filter.status);
    if (filter?.mode) runs = runs.filter(r => r.mode === filter.mode);
    return runs.sort((a, b) => b.createdAt - a.createdAt);
  }

  getRunIds(): string[] {
    return Array.from(this.runs.keys());
  }

  /** Snapshot for ClusterReporter — actuals only, no estimates. */
  getSnapshot(runId: string): ClusterRunRecord | undefined {
    return this.runs.get(runId);
  }
}

/** Singleton */
let _store: ClusterRunStore;

export function getClusterRunStore(): ClusterRunStore {
  if (!_store) _store = new ClusterRunStore();
  return _store;
}
