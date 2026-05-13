export { LLMAdapter, type LLMConfig, type LLMCallOptions, type LLMResponse, type LLMStreamChunk } from "./adapter.js";
export { LLMClient, getLLMClient, createLLMClient, type CompleteOptions, type CompleteResult, type ChatMessage } from "./LLMClient.js";
export { PromptBuilder, getPromptBuilder, createPromptBuilder } from "./PromptBuilder.js";
export { IntentAnalysisPrompt, TaskPlanningPrompt, CodeReviewPrompt, CodeGenerationPrompt, SystemPrompts } from "./prompts.js";
export { DeepSeekAdapter, type DeepSeekAdapterConfig } from "./providers/deepseek.js";
export { OpenAIAdapter } from "./providers/openai.js";
export {
  type DeepSeekModel,
  type DeepSeekModelPolicy,
  type DeepSeekTokenUsage,
  type DeepSeekCacheInfo,
  type DeepSeekResponseMetadata,
  ROLE_MODEL_POLICIES,
} from "./DeepSeekModelPolicy.js";
export {
  DeepSeekModelRouter,
  getDeepSeekModelRouter,
  createDeepSeekModelRouter,
  type ClusterRole,
  type ClusterTask,
  type RoutingDecision,
} from "./DeepSeekModelRouter.js";

import { DeepSeekAdapter } from "./providers/deepseek.js";
import { type LLMAdapter } from "./adapter.js";

let defaultAdapter: LLMAdapter | null = null;

export function getDefaultAdapter(): LLMAdapter {
  if (!defaultAdapter) {
    defaultAdapter = new DeepSeekAdapter();
  }
  return defaultAdapter;
}

export function setDefaultAdapter(adapter: LLMAdapter): void {
  defaultAdapter = adapter;
}
