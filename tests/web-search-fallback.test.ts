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

  it('extracts a direct URL through mirror fallback', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.startsWith('https://r.jina.ai/http://example.com')) {
        return {
          ok: true,
          text: async () => '# Example\n\nThis is extracted markdown content from mirror.',
        } as any;
      }

      throw new Error(`unexpected url: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock as any);

    const result = await WebSearchSkill.execute(
      { logger: console as any },
      { query: 'https://example.com/article', numResults: 5 }
    );

    expect(result.success).toBe(true);
    expect(result.result?.source).toBe('Web Page Extraction');
    expect(result.result?.results?.[0]?.extractionProvider).toBe('r.jina.ai');
    expect(result.result?.results?.[0]?.contentPreview).toContain('extracted markdown content');
  });
});
