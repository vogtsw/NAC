import { describe, it, expect, vi, afterEach } from 'vitest';
import { WebSearchSkill } from '../src/skills/builtin/WebSearchSkill.js';

describe('WebSearchSkill fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns degraded success when all providers fail', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock as any);

    const result = await WebSearchSkill.execute(
      { logger: console as any },
      { query: '收集最新的github最火的10个仓库 介绍下', numResults: 10 }
    );

    expect(result.success).toBe(true);
    expect(result.result?.degraded).toBe(true);
    expect(Array.isArray(result.result?.results)).toBe(true);
    expect(result.result?.results?.length).toBeGreaterThan(0);
  });
});

