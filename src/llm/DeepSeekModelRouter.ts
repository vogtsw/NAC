/**
 * DeepSeek Model Router
 * Routes cluster tasks to the optimal DeepSeek model + reasoning policy.
 * Implements the task.md spec: Pro for high-value reasoning, Flash for low-cost parallel labor.
 */

import type { DeepSeekModelPolicy, DeepSeekModel } from "./DeepSeekModelPolicy.js";
import { ROLE_MODEL_POLICIES } from "./DeepSeekModelPolicy.js";
import { getLogger } from "../monitoring/logger.js";

const logger = getLogger("DeepSeekModelRouter");

export type ClusterRole =
  | "coordinator"
  | "planner"
  | "researcher"
  | "code_agent"
  | "tester"
  | "reviewer"
  | "summarizer";

export interface ClusterTask {
  role: ClusterRole;
  description: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  estimatedComplexity?: "simple" | "moderate" | "complex";
}

export interface RoutingDecision {
  policy: DeepSeekModelPolicy;
  reason: string;
}

export class DeepSeekModelRouter {
  private overrides: Map<ClusterRole, DeepSeekModelPolicy> = new Map();

  /**
   * Override the default policy for a role.
   */
  setOverride(role: ClusterRole, policy: DeepSeekModelPolicy): void {
    this.overrides.set(role, policy);
    logger.info({ role, policy }, "Model policy override set");
  }

  /**
   * Clear all overrides.
   */
  clearOverrides(): void {
    this.overrides.clear();
  }

  /**
   * Route a task to the best model policy.
   */
  route(task: ClusterTask): RoutingDecision {
    if (this.overrides.has(task.role)) {
      return {
        policy: { ...this.overrides.get(task.role)! },
        reason: `Override for role '${task.role}'`,
      };
    }

    const policy = this.computePolicy(task);
    return { policy, reason: this.explainDecision(task, policy) };
  }

  private computePolicy(task: ClusterTask): DeepSeekModelPolicy {
    const base = ROLE_MODEL_POLICIES[task.role] || ROLE_MODEL_POLICIES.default;

    // Upgrade reasoning for high-risk or complex tasks
    if (task.riskLevel === "high" || task.riskLevel === "critical") {
      return {
        ...base,
        thinking: "enabled",
        reasoningEffort: "max",
      };
    }

    if (task.estimatedComplexity === "complex" && base.reasoningEffort !== "max") {
      return {
        ...base,
        reasoningEffort: "high",
      };
    }

    return { ...base };
  }

  private explainDecision(
    task: ClusterTask,
    policy: DeepSeekModelPolicy,
  ): string {
    const modelLabel = policy.model === "deepseek-v4-pro" ? "Pro (high-capability)" : "Flash (cost-optimized)";
    const thinkingLabel = policy.thinking === "enabled"
      ? `thinking on (effort: ${policy.reasoningEffort || "default"})`
      : "thinking off";
    return `Role '${task.role}' → ${modelLabel}, ${thinkingLabel}`;
  }

  /**
   * Generate team model plan for a collaboration mode.
   */
  generateTeamModelPlan(args: {
    mode: "pipeline" | "parallel-research" | "map-reduce" | "self-healing" | "debate-review";
    researcherCount?: number;
  }): {
    coordinator: DeepSeekModelPolicy;
    members: Array<{ role: ClusterRole; count: number; policy: DeepSeekModelPolicy }>;
  } {
    const { mode, researcherCount = 3 } = args;

    const coordinator = { ...ROLE_MODEL_POLICIES.coordinator };

    const members: Array<{ role: ClusterRole; count: number; policy: DeepSeekModelPolicy }> = [];

    // Researchers are always Flash (parallel cheap labor)
    members.push({
      role: "researcher",
      count: researcherCount,
      policy: { ...ROLE_MODEL_POLICIES.researcher },
    });

    if (mode === "pipeline" || mode === "map-reduce" || mode === "self-healing") {
      members.push({
        role: "code_agent",
        count: 1,
        policy: { ...ROLE_MODEL_POLICIES.code_agent },
      });
      members.push({
        role: "tester",
        count: 1,
        policy: { ...ROLE_MODEL_POLICIES.tester },
      });
      if (mode === "self-healing") {
        members.push({
          role: "tester",
          count: 1,
          policy: { ...ROLE_MODEL_POLICIES.tester, thinking: "enabled", reasoningEffort: "high" },
        });
      }
    }

    if (mode === "debate-review" || mode === "self-healing") {
      members.push({
        role: "reviewer",
        count: 1,
        policy: { ...ROLE_MODEL_POLICIES.reviewer },
      });
    }

    return { coordinator, members };
  }

  /**
   * Estimate token cost for a model policy given estimated prompt/completion tokens.
   */
  estimateCost(
    policy: DeepSeekModelPolicy,
    promptTokens: number,
    completionTokens: number,
  ): { promptCost: number; completionCost: number; totalCost: number } {
    // DeepSeek V4 pricing (approximate, subject to change)
    const pricing: Record<DeepSeekModel, { prompt: number; completion: number }> = {
      "deepseek-v4-pro": { prompt: 0.14, completion: 0.42 }, // $/1M tokens
      "deepseek-v4-flash": { prompt: 0.04, completion: 0.12 }, // $/1M tokens
    };

    const rates = pricing[policy.model];
    const promptCost = (promptTokens / 1_000_000) * rates.prompt;
    const completionCost = (completionTokens / 1_000_000) * rates.completion;

    // Thinking tax: reasoning tokens count as completion
    const thinkingMultiplier = policy.thinking === "enabled" && policy.reasoningEffort === "max" ? 1.5 : 1.0;
    const adjustedCompletionCost = completionCost * thinkingMultiplier;

    return {
      promptCost: Math.round(promptCost * 10000) / 10000,
      completionCost: Math.round(adjustedCompletionCost * 10000) / 10000,
      totalCost: Math.round((promptCost + adjustedCompletionCost) * 10000) / 10000,
    };
  }
}

let router: DeepSeekModelRouter | null = null;

export function getDeepSeekModelRouter(): DeepSeekModelRouter {
  if (!router) {
    router = new DeepSeekModelRouter();
  }
  return router;
}

export function createDeepSeekModelRouter(): DeepSeekModelRouter {
  return new DeepSeekModelRouter();
}
