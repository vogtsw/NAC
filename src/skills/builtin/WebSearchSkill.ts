/**
 * Web Search Skill
 * Provides minimal real web search plus webpage markdown extraction.
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';

const MAX_RESULTS = 20;
const MAX_ENRICHED_RESULTS = 3;
const MAX_PREVIEW_LENGTH = 320;
const FETCH_TIMEOUT_MS = 12000;

type SearchResultItem = {
  rank: number;
  title: string;
  url: string;
  snippet: string;
  source: string;
  contentPreview?: string;
  extractionProvider?: string;
};

function isGithubTrendingQuery(query: string): boolean {
  return /github|git hub|trending|trend|热门|最火|开源|仓库|repo|repository/i.test(query || '');
}

function isProbablyUrl(value: string): boolean {
  return /^(https?:\/\/|www\.)/i.test((value || '').trim());
}

function normalizeUrl(value: string): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractFirstUrl(text: string): string | null {
  const match = (text || '').match(/https?:\/\/[^\s)>\]}]+|www\.[^\s)>\]}]+/i);
  return match ? normalizeUrl(match[0]) : null;
}

function decodeHtmlEntities(text: string): string {
  return (text || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

function stripTags(text: string): string {
  return decodeHtmlEntities((text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function stripMarkdown(text: string): string {
  return (text || '')
    .replace(/^---[\s\S]*?---/m, ' ')
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/[*_~>-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
  const normalized = (text || '').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3).trim()}...`;
}

function parseDuckDuckGoRedirect(url: string): string {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    const redirected = parsed.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return url;
  }
}

async function fetchText(url: string, context: SkillContext, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    context.logger?.debug?.({ url }, 'Fetching URL');
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'text/html, text/plain, text/markdown, application/json;q=0.9, */*;q=0.8',
        'User-Agent': 'nexus-agent-cluster-web-search-skill',
        ...(init?.headers || {}),
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function buildGithubSearchQuery(rawQuery: string): { q: string; since: string } {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const isTrendingStyle = /热门|最火|trending|trend|top\s*10|top10|本周|latest|最新/i.test(rawQuery || '');

  const cleaned = (rawQuery || '')
    .replace(/github|git\s*hub/gi, ' ')
    .replace(/本周|最新|最火|热门|项目|进行介绍|介绍|前10|top\s*10|top10/gi, ' ')
    .replace(/对|上|的|进行|请|帮我|给我|一下/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const keywordTokens = (cleaned.match(/[a-zA-Z0-9_+.#-]{2,}/g) || []).filter(Boolean);

  if (isTrendingStyle || keywordTokens.length === 0) {
    return { q: `created:>=${since}`, since };
  }

  return {
    q: `${keywordTokens.join(' ')} in:name,description,readme created:>=${since}`,
    since,
  };
}

async function searchGithubTrending(query: string, numResults: number, context: SkillContext): Promise<SkillResult> {
  const take = Math.max(1, Math.min(numResults, MAX_RESULTS));
  const { q, since } = buildGithubSearchQuery(query);
  const endpoint = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${take}`;

  context.logger?.info({ query, githubQuery: q, since, take }, 'Searching GitHub trending repositories');

  const payload = JSON.parse(await fetchText(endpoint, context, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  }));

  const items = Array.isArray(payload.items) ? payload.items : [];
  const results: SearchResultItem[] = items.map((repo: any, idx: number) => ({
    rank: idx + 1,
    title: repo.full_name || repo.name,
    url: repo.html_url,
    snippet: `${repo.description || 'No description'} | ⭐ ${repo.stargazers_count || 0} | ${repo.language || 'Unknown'}`,
    source: 'GitHub Search API',
  }));

  return formatSearchResponse(query, results, {
    source: 'GitHub Search API',
    timeWindowSince: since,
  }, `已为你检索 GitHub 近 7 天（自 ${since} 起）热门项目 Top ${results.length}：`);
}

function extractDuckDuckGoHtmlResults(html: string, take: number): SearchResultItem[] {
  const results: SearchResultItem[] = [];
  const pattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) && results.length < take) {
    const rawUrl = decodeHtmlEntities(match[1]);
    const title = stripTags(match[2]);
    const normalizedUrl = normalizeUrl(parseDuckDuckGoRedirect(rawUrl));

    if (!title || !normalizedUrl) {
      continue;
    }

    const nearby = html.slice(match.index, match.index + 1200);
    const snippetMatch = nearby.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = truncate(stripTags(snippetMatch?.[1] || ''));

    if (results.some((item) => item.url === normalizedUrl)) {
      continue;
    }

    results.push({
      rank: results.length + 1,
      title,
      url: normalizedUrl,
      snippet,
      source: 'DuckDuckGo HTML',
    });
  }

  return results;
}

async function searchDuckDuckGoHtml(query: string, numResults: number, context: SkillContext): Promise<SearchResultItem[]> {
  const take = Math.max(1, Math.min(numResults, MAX_RESULTS));
  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  context.logger?.info({ query, take }, 'Searching DuckDuckGo HTML');
  const html = await fetchText(endpoint, context);
  return extractDuckDuckGoHtmlResults(html, take);
}

async function searchDuckDuckGoInstant(query: string, numResults: number, context: SkillContext): Promise<SearchResultItem[]> {
  const take = Math.max(1, Math.min(numResults, MAX_RESULTS));
  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;

  context.logger?.info({ query, take }, 'Searching DuckDuckGo instant API');
  const payload = JSON.parse(await fetchText(endpoint, context));
  const related = Array.isArray(payload.RelatedTopics) ? payload.RelatedTopics : [];

  return related
    .flatMap((item: any) => (Array.isArray(item.Topics) ? item.Topics : [item]))
    .filter((item: any) => item && typeof item.Text === 'string' && typeof item.FirstURL === 'string')
    .slice(0, take)
    .map((item: any, idx: number) => ({
      rank: idx + 1,
      title: item.Text.split(' - ')[0] || item.Text,
      url: item.FirstURL,
      snippet: item.Text,
      source: 'DuckDuckGo Instant API',
    }));
}

function buildMirrorCandidates(url: string): Array<{ provider: string; url: string }> {
  const normalized = normalizeUrl(url);
  if (!normalized) {
    return [];
  }

  const withoutProtocol = normalized.replace(/^https?:\/\//i, '');
  return [
    { provider: 'r.jina.ai', url: `https://r.jina.ai/http://${withoutProtocol}` },
    { provider: 'markdown.new', url: `https://markdown.new/${normalized}` },
    { provider: 'defuddle.md', url: `https://defuddle.md/${normalized}` },
    { provider: 'direct', url: normalized },
  ];
}

async function extractWebpageContent(targetUrl: string, context: SkillContext): Promise<{
  provider: string;
  content: string;
}> {
  const candidates = buildMirrorCandidates(targetUrl);
  let lastError = 'No extractor candidates';

  for (const candidate of candidates) {
    try {
      const raw = await fetchText(candidate.url, context);
      const cleaned = truncate(stripMarkdown(raw), 1200);
      if (cleaned) {
        return { provider: candidate.provider, content: cleaned };
      }
    } catch (error: any) {
      lastError = `${candidate.provider}: ${error?.message || 'unknown error'}`;
      context.logger?.warn?.({ url: targetUrl, provider: candidate.provider, error: error?.message }, 'Content extraction failed');
    }
  }

  throw new Error(lastError);
}

async function enrichResults(results: SearchResultItem[], context: SkillContext): Promise<SearchResultItem[]> {
  const enriched: SearchResultItem[] = [];

  for (const item of results) {
    if (enriched.length >= MAX_ENRICHED_RESULTS) {
      break;
    }

    try {
      const extracted = await extractWebpageContent(item.url, context);
      item.contentPreview = truncate(extracted.content);
      item.extractionProvider = extracted.provider;
      enriched.push(item);
    } catch {
      // Keep base search result if extraction fails.
    }
  }

  return results;
}

function formatSearchResponse(
  query: string,
  results: SearchResultItem[],
  extraMetadata: Record<string, any>,
  heading: string
): SkillResult {
  const lines = results.map((result) => {
    const parts = [
      `${result.rank}. ${result.title}`,
      `   ${result.url}`,
      result.snippet ? `   ${result.snippet}` : '',
      result.contentPreview ? `   摘要(${result.extractionProvider}): ${result.contentPreview}` : '',
    ].filter(Boolean);

    return parts.join('\n');
  });

  return {
    success: true,
    result: {
      query,
      response: `${heading}\n\n${lines.join('\n\n')}`,
      results,
      totalResults: results.length,
      ...extraMetadata,
    },
    metadata: {
      query,
      totalResults: results.length,
      ...extraMetadata,
    },
  };
}

function buildOfflineFallback(query: string, source: string, reason: string): SkillResult {
  const safeReason = (reason || 'Unknown error').slice(0, 240);
  const githubUrl = `https://github.com/search?q=${encodeURIComponent(query || '')}&type=repositories`;
  const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query || '')}`;

  return {
    success: true,
    result: {
      query,
      response: [
        '搜索服务暂时不可用，已返回可直接访问的检索入口：',
        `1) GitHub: ${githubUrl}`,
        `2) DuckDuckGo: ${ddgUrl}`,
        '',
        `原因：${safeReason}`,
      ].join('\n'),
      results: [
        {
          rank: 1,
          title: 'GitHub repository search',
          url: githubUrl,
          snippet: 'Open to view repository results directly on GitHub.',
          source: 'GitHub',
        },
        {
          rank: 2,
          title: 'DuckDuckGo search',
          url: ddgUrl,
          snippet: 'Open to view broader search results.',
          source: 'DuckDuckGo',
        },
      ],
      totalResults: 2,
      source,
      degraded: true,
    },
    metadata: {
      query,
      source,
      degraded: true,
      reason: safeReason,
    },
  };
}

async function fetchUrlDirectly(query: string, targetUrl: string, context: SkillContext): Promise<SkillResult> {
  const extracted = await extractWebpageContent(targetUrl, context);
  const result: SearchResultItem = {
    rank: 1,
    title: targetUrl,
    url: targetUrl,
    snippet: truncate(extracted.content),
    source: 'Web Page',
    contentPreview: truncate(extracted.content),
    extractionProvider: extracted.provider,
  };

  return formatSearchResponse(
    query,
    [result],
    {
      source: 'Web Page Extraction',
      extractionProvider: extracted.provider,
      directUrl: targetUrl,
    },
    `已抓取网页内容：${targetUrl}`
  );
}

async function searchWeb(query: string, numResults: number, context: SkillContext): Promise<SkillResult> {
  try {
    const htmlResults = await searchDuckDuckGoHtml(query, numResults, context);
    if (htmlResults.length > 0) {
      await enrichResults(htmlResults, context);
      return formatSearchResponse(query, htmlResults, { source: 'DuckDuckGo HTML' }, `搜索结果（${htmlResults.length} 条）：`);
    }
  } catch (htmlError: any) {
    context.logger?.warn?.({ error: htmlError?.message, query }, 'DuckDuckGo HTML search failed');
  }

  try {
    const instantResults = await searchDuckDuckGoInstant(query, numResults, context);
    if (instantResults.length > 0) {
      await enrichResults(instantResults, context);
      return formatSearchResponse(
        query,
        instantResults,
        { source: 'DuckDuckGo Instant API' },
        `搜索结果（${instantResults.length} 条）：`
      );
    }
  } catch (instantError: any) {
    context.logger?.warn?.({ error: instantError?.message, query }, 'DuckDuckGo instant search failed');
    return buildOfflineFallback(query, 'duckduckgo', instantError?.message || 'search failed');
  }

  return buildOfflineFallback(query, 'duckduckgo', 'No search results');
}

export const WebSearchSkill: Skill = {
  name: 'web-search',
  version: '3.0.0',
  description: 'Search the web and extract webpage content with markdown mirror fallbacks.',
  category: SkillCategory.AUTOMATION,
  enabled: true,
  builtin: true,

  parameters: {
    required: ['query'],
    optional: ['numResults', 'language'],
    schema: {
      query: 'string - Search query or URL',
      numResults: 'number - Number of results (default: 5, max: 20)',
      language: 'string - Preferred language code',
    },
  },

  validate(params: any): boolean {
    return !!params.query && typeof params.query === 'string';
  },

  async execute(context: SkillContext, params: any): Promise<SkillResult> {
    const { query, numResults = 5 } = params;
    const normalizedNumResults =
      typeof numResults === 'number' && Number.isFinite(numResults) ? numResults : parseInt(String(numResults), 10) || 5;

    try {
      const directUrl = isProbablyUrl(query) ? normalizeUrl(query) : extractFirstUrl(query);
      if (directUrl) {
        return await fetchUrlDirectly(query, directUrl, context);
      }

      if (isGithubTrendingQuery(query)) {
        try {
          return await searchGithubTrending(query, normalizedNumResults, context);
        } catch (githubError: any) {
          context.logger?.warn?.({ error: githubError?.message, query }, 'GitHub search failed, falling back to general web search');
        }
      }

      return await searchWeb(query, normalizedNumResults, context);
    } catch (error: any) {
      context.logger?.error?.({ error: error?.message, query }, 'Web search failed');
      return buildOfflineFallback(query, 'web-fallback', error?.message || 'search failed');
    }
  },
};

export default WebSearchSkill;
