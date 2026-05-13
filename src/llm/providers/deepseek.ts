import { LLMAdapter, type LLMConfig } from "../adapter.js";
import type { DeepSeekModel } from "../DeepSeekModelPolicy.js";

export interface DeepSeekAdapterConfig extends Partial<LLMConfig> {
  model?: DeepSeekModel | (string & {});
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

export class DeepSeekAdapter extends LLMAdapter {
  private modelPolicy: DeepSeekAdapterConfig;

  constructor(config?: DeepSeekAdapterConfig) {
    const baseConfig: LLMConfig = {
      apiKey: config?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: config?.baseURL ?? "https://api.deepseek.com/v1",
      model: config?.model ?? "deepseek-v4-pro",
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 4096,
    };
    super(baseConfig);
    this.modelPolicy = config || {};
  }

  get thinking(): "enabled" | "disabled" | undefined {
    return this.modelPolicy.thinking;
  }

  get reasoningEffort(): "high" | "max" | undefined {
    return this.modelPolicy.reasoningEffort;
  }
}
