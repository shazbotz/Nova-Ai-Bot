export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: number;
  latencyMs: number;
}

export interface AIProviderInterface {
  name: string;
  slug: string;
  isAvailable(): boolean;
  chat(messages: ChatMessage[], model?: string): Promise<AIResponse>;
  chatWithFile(
    messages: ChatMessage[],
    fileContent: string,
    fileName: string,
    model?: string
  ): Promise<AIResponse>;
}

export interface RouterConfig {
  providers: ProviderConfig[];
}

export interface ProviderConfig {
  slug: string;
  priority: number;
  enabled: boolean;
  defaultModel: string;
}
