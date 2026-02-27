/**
 * Agent Router - 智能路由系统
 * 使用 LLM 进行语义匹配，动态选择最合适的 Agent
 */

import { LLMClient } from '../llm/LLMClient.js';
import { AgentCapability, AgentMatchResult, RouterConfig } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';
import { getAgentRegistry } from './AgentRegistry.js';

const logger = getLogger('AgentRouter');

/**
 * Agent 路由器 - 智能选择合适的 Agent 处理任务
 */
export class AgentRouter {
  constructor(
    private llm: LLMClient,
    private config: RouterConfig = {}
  ) {}

  /**
   * 智能路由 - 为任务选择最合适的 Agent
   */
  async route(task: {
    description: string;
    intent: string;
    capabilities: string[];
    complexity: number;
  }): Promise<AgentMatchResult[]> {
    logger.info({ task: task.description }, 'Routing task to agents');

    // 1. 获取所有已注册的 Agent 能力描述
    const registry = getAgentRegistry();
    const allCapabilities = registry.getAllCapabilities();

    if (allCapabilities.length === 0) {
      logger.warn('No agents registered, falling back to GenericAgent');
      return [{
        agentType: 'GenericAgent',
        confidence: 0.5,
        reason: 'No agents registered, using fallback',
        suggestedSkills: [],
      }];
    }

    // 2. 使用 LLM 进行语义匹配
    const matchResults = await this.semanticMatch(task, allCapabilities);

    // 3. 按置信度排序
    const sorted = matchResults.sort((a, b) => b.confidence - a.confidence);

    logger.info({
      topMatch: sorted[0]?.agentType,
      confidence: sorted[0]?.confidence,
      alternatives: sorted.slice(1, 3).map(r => ({ type: r.agentType, score: r.confidence }))
    }, 'Routing complete');

    return sorted;
  }

  /**
   * 使用 LLM 进行语义匹配
   */
  private async semanticMatch(
    task: { description: string; intent: string; capabilities: string[]; complexity: number },
    agentCapabilities: AgentCapability[]
  ): Promise<AgentMatchResult[]> {
    const agentsDescription = agentCapabilities.map(cap =>
      `Agent Type: ${cap.agentType}
Description: ${cap.description}
Strengths: ${cap.strengths?.join(', ') || 'N/A'}
Weaknesses: ${cap.weaknesses?.join(', ') || 'N/A'}
Ideal Tasks: ${cap.idealTasks?.join(', ') || 'N/A'}
Required Skills: ${cap.requiredSkills?.join(', ') || 'None'}
Examples: ${cap.examples?.join(', ') || 'N/A'}`
    ).join('\n\n---\n\n');

    const prompt = `你是一个智能任务路由专家。分析以下任务，为每个 Agent 评分。

## 任务信息
- 描述: ${task.description}
- 意图类型: ${task.intent}
- 所需能力: ${task.capabilities.join(', ')}
- 复杂度: ${task.complexity}/10

## 可用 Agent
${agentsDescription}

## 评分规则
1. 置信度 (0-1): Agent 完成此任务的能力评估
2. 推荐技能: 建议使用的技能列表
3. 理由: 简要解释为何给出此评分

请以 JSON 格式返回：
\`\`\`json
{
  "matches": [
    {
      "agentType": "CodeAgent",
      "confidence": 0.95,
      "reason": "任务涉及代码生成，CodeAgent 专门处理此类工作",
      "suggestedSkills": ["code-generation", "file-ops"]
    }
  ]
}
\`\`\`

注意：
- confidence 必须是 0 到 1 之间的数字
- 所有 Agent 都应该被评分
- 可以给多个 Agent 较高分数（表示可能需要协作）`;

    try {
      const response = await this.llm.complete(prompt, { responseFormat: 'json' });
      const parsed = JSON.parse(response);

      if (parsed.matches && Array.isArray(parsed.matches)) {
        return parsed.matches;
      }

      // Fallback: 如果解析失败，使用简单匹配
      return this.fallbackMatch(task, agentCapabilities);
    } catch (error: any) {
      logger.warn({ error: error.message }, 'LLM semantic match failed, using fallback');
      return this.fallbackMatch(task, agentCapabilities);
    }
  }

  /**
   * 降级匹配 - 当 LLM 失败时使用
   */
  private fallbackMatch(
    task: { description: string; intent: string; capabilities: string[] },
    agentCapabilities: AgentCapability[]
  ): AgentMatchResult[] {
    const desc = task.description.toLowerCase();
    const intent = task.intent.toLowerCase();

    return agentCapabilities.map(cap => {
      let score = 0.3; // 基础分

      // 关键词匹配
      const keywords = cap.idealTasks || [];
      const matchedKeywords = keywords.filter(kw =>
        desc.includes(kw.toLowerCase()) || intent.includes(kw.toLowerCase())
      );
      score += matchedKeywords.length * 0.15;

      // 能力匹配
      const matchedCapabilities = cap.requiredSkills?.filter(skill =>
        task.capabilities.some(cap => cap.includes(skill))
      ) || [];
      score += matchedCapabilities.length * 0.1;

      // 意图类型匹配
      if (cap.description.toLowerCase().includes(intent)) {
        score += 0.2;
      }

      return {
        agentType: cap.agentType,
        confidence: Math.min(score, 1),
        reason: `Fallback match based on keywords: ${matchedKeywords.join(', ')}`,
        suggestedSkills: matchedCapabilities,
      };
    }).sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * 决定是否需要多 Agent 协作
   */
  shouldCollaborate(matches: AgentMatchResult[]): boolean {
    if (matches.length < 2) return false;

    // 如果前两名得分接近且都较高，建议协作
    const [first, second] = matches;
    const scoreDiff = first.confidence - second.confidence;

    return (
      first.confidence > 0.6 &&
      second.confidence > 0.5 &&
      scoreDiff < 0.15
    );
  }

  /**
   * 获取协作建议
   */
  getCollaborationPlan(matches: AgentMatchResult[]): {
    primary: AgentMatchResult;
    supporters: AgentMatchResult[];
    strategy: string;
  } {
    const [primary, ...rest] = matches;

    return {
      primary,
      supporters: rest.slice(0, 2), // 最多 2 个支持 Agent
      strategy: this.generateCollaborationStrategy(primary, rest.slice(0, 2)),
    };
  }

  /**
   * 生成协作策略
   */
  private generateCollaborationStrategy(
    primary: AgentMatchResult,
    supporters: AgentMatchResult[]
  ): string {
    if (supporters.length === 0) {
      return `${primary.agentType} 独立完成任务`;
    }

    const supporterNames = supporters.map(s => s.agentType).join(', ');
    return `${primary.agentType} 主导，${supporterNames} 提供支持`;
  }
}

/**
 * 创建路由器
 */
export function createAgentRouter(llm: LLMClient, config?: RouterConfig): AgentRouter {
  return new AgentRouter(llm, config);
}
