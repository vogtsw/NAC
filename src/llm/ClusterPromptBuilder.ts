/**
 * ClusterPromptBuilder — cache-aware prompt layout for DeepSeek cluster agents.
 *
 * Partitions each LLM request into three zones:
 *
 *   Immutable prefix (cacheable):
 *     System rules, tool schemas (stable order), role taxonomy,
 *     project instructions (CLAUDE.md), repo map hash, artifact index.
 *
 *   Append-only log:
 *     User messages, assistant tool calls, tool result summaries, artifact IDs.
 *
 *   Volatile suffix:
 *     Current agent role, current DAG step, relevant artifact excerpts,
 *     expected output schema, transient scratch / failure details.
 *
 * Rules:
 *   - Never inject timestamps or random values into the immutable prefix.
 *   - Sort tool definitions deterministically.
 *   - Hash the immutable prefix and record it in telemetry.
 *   - Keep reasoning_content separate from user-visible content.
 */

import { createHash } from 'crypto';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('ClusterPromptBuilder');

export interface PromptZones {
  /** Immutable prefix — computed once per run, reused across turns. */
  immutablePrefix: string;
  /** Append-only log — grows each turn, appended to the prefix. */
  appendLog: string;
  /** Volatile suffix — changes per request, not cached. */
  volatileSuffix: string;
  /** SHA-256 hash of the immutable prefix for telemetry. */
  prefixHash: string;
}

export interface ClusterPromptConfig {
  systemRules: string[];
  toolSpecs: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  roleTaxonomy: Record<string, { model: string; thinking: string; reasoningEffort: string }>;
  projectInstructions: string;
  repoMapHash: string;
  artifactIndex: string;
}

export class ClusterPromptBuilder {
  private toolSpecs: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
  private config: ClusterPromptConfig | null = null;
  private cachedPrefix: string | null = null;
  private cachedHash: string | null = null;
  private appendLogEntries: string[] = [];
  private basePromptTokens: number = 0;

  /**
   * Initialize with immutable configuration. Called once per cluster run.
   */
  initialize(config: ClusterPromptConfig): void {
    this.config = config;
    this.toolSpecs = [...config.toolSpecs].sort((a, b) => a.name.localeCompare(b.name));
    this.appendLogEntries = [];
    this.cachedPrefix = this.buildImmutablePrefix();
    this.cachedHash = createHash('sha256').update(this.cachedPrefix).digest('hex').substring(0, 16);
    this.basePromptTokens = Math.ceil(this.cachedPrefix.length / 3.5); // rough estimate
    logger.info({ prefixHash: this.cachedHash, baseTokens: this.basePromptTokens }, 'ClusterPromptBuilder initialized');
  }

  /**
   * Build the immutable prefix — must be deterministic across turns.
   */
  private buildImmutablePrefix(): string {
    if (!this.config) return '';

    const sections: string[] = [];

    // 1. System rules (stable order)
    if (this.config.systemRules.length > 0) {
      sections.push('## System Rules\n' + this.config.systemRules.join('\n'));
    }

    // 2. Tool schemas (deterministically sorted by name)
    if (this.toolSpecs.length > 0) {
      const toolLines = this.toolSpecs.map(t =>
        `- ${t.name}: ${t.description} (params: ${JSON.stringify(t.parameters)})`
      );
      sections.push('## Available Tools\n' + toolLines.join('\n'));
    }

    // 3. Role taxonomy
    if (this.config.roleTaxonomy && Object.keys(this.config.roleTaxonomy).length > 0) {
      const roleLines = Object.entries(this.config.roleTaxonomy).map(
        ([role, spec]) => `- ${role}: ${spec.model} (thinking=${spec.thinking}, effort=${spec.reasoningEffort})`
      );
      sections.push('## Role Taxonomy\n' + roleLines.join('\n'));
    }

    // 4. Project instructions
    if (this.config.projectInstructions) {
      sections.push('## Project Instructions\n' + this.config.projectInstructions);
    }

    // 5. Repo map hash
    if (this.config.repoMapHash) {
      sections.push(`## Repo Map Hash: ${this.config.repoMapHash}`);
    }

    // 6. Artifact index (stable — artifact IDs, not content)
    if (this.config.artifactIndex) {
      sections.push(`## Artifact Index\n${this.config.artifactIndex}`);
    }

    return sections.join('\n\n');
  }

  /**
   * Append a user message to the append-only log.
   */
  appendUserMessage(content: string): void {
    this.appendLogEntries.push(`[user]: ${content}`);
  }

  /**
   * Append a tool call + result summary to the append-only log.
   */
  appendToolResult(toolName: string, summary: string): void {
    this.appendLogEntries.push(`[tool ${toolName}]: ${summary}`);
  }

  /**
   * Append an artifact reference (ID only — not full content).
   */
  appendArtifactRef(artifactId: string, artifactType: string): void {
    this.appendLogEntries.push(`[artifact ${artifactType}]: ${artifactId}`);
  }

  /**
   * Build the full prompt for the current turn.
   *
   * @param volatileSuffix — current role, DAG step, relevant excerpts, expected output
   * @returns PromptZones with all three sections + prefix hash
   */
  buildPrompt(volatileSuffix: string): PromptZones {
    const prefix = this.cachedPrefix || this.buildImmutablePrefix();
    const appendLog = this.appendLogEntries.join('\n');
    const hash = this.cachedHash || createHash('sha256').update(prefix).digest('hex').substring(0, 16);

    return {
      immutablePrefix: prefix,
      appendLog,
      volatileSuffix,
      prefixHash: hash,
    };
  }

  /**
   * Build the complete prompt string for sending to the LLM.
   */
  buildFullPrompt(volatileSuffix: string): string {
    const zones = this.buildPrompt(volatileSuffix);
    return [
      zones.immutablePrefix,
      zones.appendLog ? `## Conversation Log\n${zones.appendLog}` : '',
      `## Current Context\n${zones.volatileSuffix}`,
    ].filter(Boolean).join('\n\n');
  }

  /**
   * Get the prefix hash for telemetry.
   */
  getPrefixHash(): string {
    return this.cachedHash || '';
  }

  /**
   * Check if prefix is still cache-valid (hasn't been invalidated by mutation).
   */
  isPrefixStable(): boolean {
    return this.cachedPrefix !== null && this.cachedHash !== null;
  }

  /**
   * Estimate the cacheable token count.
   */
  getCacheableTokenEstimate(): number {
    return this.basePromptTokens;
  }
}

/** Singleton */
let _promptBuilder: ClusterPromptBuilder | null = null;

export function getClusterPromptBuilder(): ClusterPromptBuilder {
  if (!_promptBuilder) _promptBuilder = new ClusterPromptBuilder();
  return _promptBuilder;
}
