/**
 * Web Search Skill
 * Performs real searches. For GitHub trending queries, uses GitHub Search API.
 */

import { Skill, SkillCategory, SkillContext, SkillResult } from '../types.js';

const MAX_RESULTS = 20;

function isGithubTrendingQuery(query: string): boolean {
  return /github|git hub|trending|trend|热门|最火|开源|仓库|repo|repository/i.test(query || '');
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

  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nexus-agent-cluster-web-search-skill',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const payload: any = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];

  const results = items.map((repo: any, idx: number) => ({
    rank: idx + 1,
    name: repo.name,
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description || '',
    stars: repo.stargazers_count || 0,
    language: repo.language || 'Unknown',
    updatedAt: repo.updated_at,
  }));

  const lines = results.map(
    (r: any) =>
      `${r.rank}. ${r.fullName} (⭐ ${r.stars}, ${r.language})\n   ${r.url}\n   ${r.description || 'No description'}`
  );

  const responseText =
    `已为你检索 GitHub 近 7 天（自 ${since} 起）热门项目 Top ${results.length}：\n\n` +
    lines.join('\n\n');

  return {
    success: true,
    result: {
      query,
      response: responseText,
      results,
      totalResults: results.length,
      source: 'GitHub Search API',
      timeWindowSince: since,
    },
    metadata: {
      query,
      githubQuery: q,
      totalResults: results.length,
      source: 'github',
      since,
    },
  };
}

async function searchDuckDuckGo(query: string, numResults: number, context: SkillContext): Promise<SkillResult> {
  const take = Math.max(1, Math.min(numResults, MAX_RESULTS));
  const endpoint = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&no_redirect=1`;

  context.logger?.info({ query, take }, 'Searching DuckDuckGo instant API');

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`DuckDuckGo API error ${response.status}`);
  }

  const payload: any = await response.json();
  const related = Array.isArray(payload.RelatedTopics) ? payload.RelatedTopics : [];

  const flat = related
    .flatMap((item: any) => (Array.isArray(item.Topics) ? item.Topics : [item]))
    .filter((item: any) => item && typeof item.Text === 'string' && typeof item.FirstURL === 'string')
    .slice(0, take)
    .map((item: any, idx: number) => ({
      rank: idx + 1,
      title: item.Text.split(' - ')[0] || item.Text,
      url: item.FirstURL,
      snippet: item.Text,
      source: 'DuckDuckGo',
    }));

  const results = flat.length > 0
    ? flat
    : [
        {
          rank: 1,
          title: `DuckDuckGo results for: ${query}`,
          url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          snippet: 'No structured instant answers found. Open the URL for full result list.',
          source: 'DuckDuckGo',
        },
      ];

  const lines = results.map(
    (r: any) => `${r.rank}. ${r.title}\n   ${r.url}\n   ${r.snippet || ''}`
  );

  return {
    success: true,
    result: {
      query,
      response: `搜索结果（${results.length} 条）：\n\n${lines.join('\n\n')}`,
      results,
      totalResults: results.length,
      source: 'DuckDuckGo Instant API',
    },
    metadata: {
      query,
      totalResults: results.length,
      source: 'duckduckgo',
    },
  };
}

function buildOfflineFallback(query: string, source: 'github' | 'duckduckgo' | 'mixed', reason: string): SkillResult {
  const safeReason = (reason || 'Unknown error').slice(0, 240);
  const githubUrl = `https://github.com/search?q=${encodeURIComponent(query || '')}&type=repositories`;
  const ddgUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query || '')}`;
  const guidance = [
    '搜索服务暂时不可用，已返回可直接访问的检索入口：',
    `1) GitHub: ${githubUrl}`,
    `2) DuckDuckGo: ${ddgUrl}`,
    '',
    `原因：${safeReason}`,
  ].join('\n');

  return {
    success: true,
    result: {
      query,
      response: guidance,
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
      source: source === 'github' ? 'GitHub Fallback' : source === 'duckduckgo' ? 'DuckDuckGo Fallback' : 'Web Fallback',
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

export const WebSearchSkill: Skill = {
  name: 'web-search',
  version: '2.0.0',
  description: 'Search the web; supports real GitHub trending retrieval.',
  category: SkillCategory.AUTOMATION,
  enabled: true,
  builtin: true,

  parameters: {
    required: ['query'],
    optional: ['numResults', 'language'],
    schema: {
      query: 'string - Search query',
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
      if (isGithubTrendingQuery(query)) {
        try {
          return await searchGithubTrending(query, normalizedNumResults, context);
        } catch (githubError: any) {
          context.logger?.warn(
            { error: githubError?.message, query },
            'GitHub search failed, falling back to DuckDuckGo'
          );
          try {
            return await searchDuckDuckGo(query, normalizedNumResults, context);
          } catch (duckError: any) {
            context.logger?.error(
              { githubError: githubError?.message, duckError: duckError?.message, query },
              'All web search providers failed'
            );
            return buildOfflineFallback(query, 'mixed', `${githubError?.message || ''}; ${duckError?.message || ''}`);
          }
        }
      }

      return await searchDuckDuckGo(query, normalizedNumResults, context);
    } catch (error: any) {
      context.logger?.error({ error: error.message, query }, 'Web search failed');
      return buildOfflineFallback(query, 'duckduckgo', error?.message || 'search failed');
    }
  },
};

export default WebSearchSkill;
