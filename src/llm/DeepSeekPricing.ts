/**
 * DeepSeek V4 Pricing — single source of truth.
 * All cost calculations across router, team builder, and reporter MUST use these rates.
 */

import type { DeepSeekModel } from "./DeepSeekModelPolicy.js";

export interface ModelPricing {
  prompt: number;     // USD per 1M tokens
  completion: number; // USD per 1M tokens
}

export const DEEPSEEK_V4_PRICING: Record<DeepSeekModel, ModelPricing> = {
  "deepseek-v4-pro": { prompt: 0.14, completion: 0.42 },
  "deepseek-v4-flash": { prompt: 0.04, completion: 0.12 },
};

export const THINKING_PREMIUM: Record<string, number> = {
  max: 1.5,  // max reasoning = 50% thinking premium
  high: 1.2,  // high reasoning = 20% thinking premium
};

/**
 * Calculate cost for a model + thinking configuration.
 */
export function calculateCost(
  model: DeepSeekModel,
  promptTokens: number,
  completionTokens: number,
  reasoningEffort?: "high" | "max",
): { promptCost: number; completionCost: number; totalCost: number } {
  const rates = DEEPSEEK_V4_PRICING[model];
  const promptCost = (promptTokens / 1_000_000) * rates.prompt;
  const completionCost = (completionTokens / 1_000_000) * rates.completion;

  const premium = reasoningEffort ? (THINKING_PREMIUM[reasoningEffort] || 1.0) : 1.0;
  const adjustedCompletion = completionCost * premium;

  return {
    promptCost: round4(promptCost),
    completionCost: round4(adjustedCompletion),
    totalCost: round4(promptCost + adjustedCompletion),
  };
}

/**
 * Estimate cost for a split between prompt and completion tokens.
 * Uses 60/40 split for Pro, 70/30 for Flash as defaults.
 */
export function estimateCost(
  model: DeepSeekModel,
  totalTokens: number,
  reasoningEffort?: "high" | "max",
): { totalCost: number; breakdown: { prompt: number; completion: number } } {
  const split = model === "deepseek-v4-flash" ? { prompt: 0.7, completion: 0.3 } : { prompt: 0.6, completion: 0.4 };
  const promptTokens = Math.round(totalTokens * split.prompt);
  const completionTokens = Math.round(totalTokens * split.completion);

  const result = calculateCost(model, promptTokens, completionTokens, reasoningEffort);
  return { totalCost: result.totalCost, breakdown: { prompt: promptTokens, completion: completionTokens } };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
