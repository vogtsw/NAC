/**
 * Intent Parser
 * Parse user input into structured intent using LLM
 */

import { LLMClient } from '../llm/LLMClient.js';
import { IntentAnalysisPrompt } from '../llm/prompts.js';
import { Intent } from '../state/models.js';
import { getLogger } from '../monitoring/logger.js';

const logger = getLogger('IntentParser');

/**
 * Intent Parser - Analyzes user input to extract structured intent
 */
export class IntentParser {
  constructor(private llm: LLMClient) {}

  /**
   * Parse user input into intent
   */
  async parse(userInput: string): Promise<Intent> {
    logger.info({ userInput: userInput.substring(0, 100) }, 'Parsing user intent');

    if (this.shouldUseDeterministicFallback()) {
      return this.parseWithRules(userInput);
    }

    const prompt = IntentAnalysisPrompt.format(userInput);

    try {
      const response = await this.llm.complete(prompt, {
        responseFormat: 'json',
        temperature: 0.3,
      });

      const parsed = JSON.parse(response);

      // Map the response to our Intent interface
      const intent: Intent = {
        type: parsed.intent_type || parsed.type,
        primaryGoal: parsed.primary_goal,
        capabilities: parsed.required_capabilities || parsed.capabilities || [],
        complexity: parsed.complexity,
        estimatedSteps: parsed.estimated_steps,
        constraints: parsed.constraints || [],
        conversationType: parsed.conversation_type,
      };

      logger.info(
        {
          intentType: intent.type,
          complexity: intent.complexity,
          estimatedSteps: intent.estimatedSteps,
        },
        'Intent parsed successfully'
      );

      return intent;
    } catch (error: any) {
      logger.warn({ error: error.message }, 'Failed to parse intent with LLM, using rule-based fallback');
      return this.parseWithRules(userInput);
    }
  }

  private shouldUseDeterministicFallback(): boolean {
    const isTestRuntime = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    return isTestRuntime && process.env.USE_LIVE_LLM_FOR_TESTS !== 'true';
  }

  private parseWithRules(userInput: string): Intent {
    const normalized = userInput.toLowerCase();

    if (/^(hi|hello|hey)\b|你好|您好|嗨/.test(normalized)) {
      return {
        type: 'conversation',
        primaryGoal: userInput,
        capabilities: [],
        complexity: 'simple',
        estimatedSteps: 0,
        constraints: [],
        conversationType: 'greeting',
      };
    }

    if (/search|find|look up|news|google|搜索|查找|新闻|最新/.test(normalized)) {
      return {
        type: 'automation',
        primaryGoal: userInput,
        capabilities: ['web-search', 'information-retrieval'],
        complexity: 'simple',
        estimatedSteps: 1,
        constraints: [],
      };
    }

    if (/api|code|function|class|test|generate|implement|refactor|代码|生成|实现|开发|接口|测试/.test(normalized)) {
      return {
        type: 'code',
        primaryGoal: userInput,
        capabilities: ['code_gen', 'api_design', 'testing'],
        complexity: userInput.length > 80 ? 'medium' : 'simple',
        estimatedSteps: userInput.length > 80 ? 3 : 2,
        constraints: [],
      };
    }

    return {
      type: 'analysis',
      primaryGoal: userInput,
      capabilities: ['analysis'],
      complexity: userInput.length > 120 ? 'medium' : 'simple',
      estimatedSteps: 1,
      constraints: [],
    };
  }

  /**
   * Assess task complexity (1-10 scale)
   */
  assessComplexity(intent: Intent): number {
    const factors = {
      typeWeight: this.getTypeWeight(intent.type),
      capabilityCount: intent.capabilities.length * 0.5,
      stepCount: intent.estimatedSteps * 0.1,
      constraintCount: intent.constraints.length * 0.2,
    };

    const score = Object.values(factors).reduce((sum: number, v: number) => sum + v, 0);
    return Math.min(10, Math.max(1, Math.round(score)));
  }

  /**
   * Get weight for intent type
   */
  private getTypeWeight(type: Intent['type']): number {
    const weights: Record<Intent['type'], number> = {
      code: 3,
      data: 2,
      automation: 4,
      analysis: 2,
      deployment: 5,
      other: 1,
      conversation: 0,
    };
    return weights[type] || 1;
  }
}
