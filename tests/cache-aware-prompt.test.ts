/**
 * Cache-aware prompt layout tests.
 * Verifies that ClusterPromptBuilder maintains prefix cache stability.
 */
import { describe, it, expect } from 'vitest';
import { ClusterPromptBuilder } from '../src/llm/ClusterPromptBuilder.js';

describe('ClusterPromptBuilder — immutable prefix stability', () => {
  const baseConfig = {
    systemRules: ['Rule A: Always verify before writing.', 'Rule B: Never expose secrets.'],
    toolSpecs: [
      { name: 'read_file', description: 'Read a file', parameters: { path: 'string' } },
      { name: 'apply_patch', description: 'Apply a diff', parameters: { files: 'array' } },
      { name: 'bash', description: 'Run a shell command', parameters: { cmd: 'string' } },
    ],
    roleTaxonomy: {
      coordinator: { model: 'deepseek-v4-pro', thinking: 'enabled', reasoningEffort: 'high' },
      researcher: { model: 'deepseek-v4-flash', thinking: 'disabled', reasoningEffort: 'none' },
    },
    projectInstructions: 'Do not modify files outside workspace.',
    repoMapHash: 'abc123def456',
    artifactIndex: 'plan:plan_001, patch:patch_001',
  };

  it('produces stable prefix hash across multiple builds with same config', () => {
    const b1 = new ClusterPromptBuilder();
    const b2 = new ClusterPromptBuilder();
    b1.initialize({ ...baseConfig });
    b2.initialize({ ...baseConfig });

    expect(b1.getPrefixHash()).toBe(b2.getPrefixHash());
    expect(b1.isPrefixStable()).toBe(true);
    expect(b2.isPrefixStable()).toBe(true);
  });

  it('prefix hash changes when system rules change', () => {
    const b1 = new ClusterPromptBuilder();
    const b2 = new ClusterPromptBuilder();
    b1.initialize(baseConfig);
    b2.initialize({ ...baseConfig, systemRules: ['Different rule.'] });

    expect(b1.getPrefixHash()).not.toBe(b2.getPrefixHash());
  });

  it('tool schemas are sorted deterministically regardless of input order', () => {
    const reversedConfig = {
      ...baseConfig,
      toolSpecs: [...baseConfig.toolSpecs].reverse(),
    };

    const b1 = new ClusterPromptBuilder();
    const b2 = new ClusterPromptBuilder();
    b1.initialize(baseConfig);
    b2.initialize(reversedConfig);

    expect(b1.getPrefixHash()).toBe(b2.getPrefixHash());
  });

  it('append-only log does NOT change prefix hash', () => {
    const b = new ClusterPromptBuilder();
    b.initialize(baseConfig);
    const hashBefore = b.getPrefixHash();

    b.appendUserMessage('Fix the failing test');
    b.appendToolResult('read_file', 'Found 3 files in src/');
    b.appendArtifactRef('patch_001', 'patch');

    const hashAfter = b.getPrefixHash();
    expect(hashAfter).toBe(hashBefore);
  });

  it('volatile suffix does NOT change prefix hash', () => {
    const b = new ClusterPromptBuilder();
    b.initialize(baseConfig);
    const hashBefore = b.getPrefixHash();

    const prompt1 = b.buildPrompt('DAG step: step_code\nExpected output: patch');
    const prompt2 = b.buildPrompt('DAG step: step_test\nExpected output: test_report');

    expect(prompt1.prefixHash).toBe(hashBefore);
    expect(prompt2.prefixHash).toBe(hashBefore);
    expect(prompt1.volatileSuffix).not.toBe(prompt2.volatileSuffix);
  });

  it('buildFullPrompt includes all three zones', () => {
    const b = new ClusterPromptBuilder();
    b.initialize(baseConfig);
    b.appendUserMessage('Fix the TypeScript error');

    const full = b.buildFullPrompt('DAG step: step_code');

    expect(full).toContain('System Rules');
    expect(full).toContain('Rule A');
    expect(full).toContain('Available Tools');
    expect(full).toContain('read_file');
    expect(full).toContain('apply_patch');
    expect(full).toContain('bash');
    expect(full).toContain('Role Taxonomy');
    expect(full).toContain('Project Instructions');
    expect(full).toContain('Repo Map Hash');
    expect(full).toContain('[user]: Fix the TypeScript error');
    expect(full).toContain('DAG step: step_code');
  });

  it('prefix hash changes when project instructions differ', () => {
    const b1 = new ClusterPromptBuilder();
    const b2 = new ClusterPromptBuilder();
    b1.initialize(baseConfig);
    b2.initialize({ ...baseConfig, projectInstructions: 'Different project rules.' });

    expect(b1.getPrefixHash()).not.toBe(b2.getPrefixHash());
  });

  it('estimates cacheable token count', () => {
    const b = new ClusterPromptBuilder();
    b.initialize(baseConfig);
    const est = b.getCacheableTokenEstimate();
    expect(est).toBeGreaterThan(0);
  });

  it('different role taxonomy produces different hash', () => {
    const b1 = new ClusterPromptBuilder();
    const b2 = new ClusterPromptBuilder();
    b1.initialize(baseConfig);
    b2.initialize({
      ...baseConfig,
      roleTaxonomy: { custom: { model: 'deepseek-v4-pro', thinking: 'enabled', reasoningEffort: 'max' } },
    });

    expect(b1.getPrefixHash()).not.toBe(b2.getPrefixHash());
  });
});
