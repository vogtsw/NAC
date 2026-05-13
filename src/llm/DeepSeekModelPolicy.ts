/**
 * DeepSeek Model Policy
 * Defines model routing, thinking mode, and reasoning effort for the DeepSeek V4 cluster agent.
 */

export type DeepSeekModel = "deepseek-v4-pro" | "deepseek-v4-flash";

export interface DeepSeekModelPolicy {
  model: DeepSeekModel;
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  maxTokens?: number;
  temperature?: number;
}

export interface DeepSeekCacheInfo {
  hit: boolean;
  hitTokens?: number;
  missTokens?: number;
}

export interface DeepSeekTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

export interface DeepSeekResponseMetadata {
  model: DeepSeekModel;
  thinking: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
  usage: DeepSeekTokenUsage;
  cache?: DeepSeekCacheInfo;
  reasoningContent?: string;
  finishReason: string;
  duration: number;
}

/**
 * Default model policies by agent role
 */
export const ROLE_MODEL_POLICIES: Record<string, DeepSeekModelPolicy> = {
  coordinator: {
    model: "deepseek-v4-pro",
    thinking: "enabled",
    reasoningEffort: "high",
  },
  planner: {
    model: "deepseek-v4-pro",
    thinking: "enabled",
    reasoningEffort: "high",
  },
  researcher: {
    model: "deepseek-v4-flash",
    thinking: "enabled",
    reasoningEffort: "high",
  },
  code_agent: {
    model: "deepseek-v4-pro",
    thinking: "enabled",
    reasoningEffort: "high",
  },
  tester: {
    model: "deepseek-v4-flash",
    thinking: "enabled",
    reasoningEffort: "high",
  },
  reviewer: {
    model: "deepseek-v4-pro",
    thinking: "enabled",
    reasoningEffort: "max",
  },
  summarizer: {
    model: "deepseek-v4-flash",
    thinking: "disabled",
  },
  default: {
    model: "deepseek-v4-pro",
    thinking: "enabled",
    reasoningEffort: "high",
  },
};
