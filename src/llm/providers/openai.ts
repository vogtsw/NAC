import { LLMAdapter, type LLMConfig } from "../adapter.js";

export class OpenAIAdapter extends LLMAdapter {
  constructor(config?: Partial<LLMConfig>) {
    super({
      apiKey: config?.apiKey ?? process.env.OPENAI_API_KEY ?? "",
      baseURL: config?.baseURL ?? "https://api.openai.com/v1",
      model: config?.model ?? "gpt-4o",
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens ?? 4096,
    });
  }
}
