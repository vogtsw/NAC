import { LLMAdapter, type LLMConfig } from "../adapter.js";

export class DeepSeekAdapter extends LLMAdapter {
  constructor(config?: Partial<LLMConfig>) {
    super({
      apiKey: config?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "",
      baseURL: config?.baseURL ?? "https://api.deepseek.com/v1",
      model: config?.model ?? "deepseek-chat",
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 4096,
    });
  }
}
