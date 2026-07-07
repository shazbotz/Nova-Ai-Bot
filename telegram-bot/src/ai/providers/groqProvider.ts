import OpenAI from "openai";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { AIResponse, ChatMessage, AIProviderInterface } from "../types";

export class GroqProvider implements AIProviderInterface {
  name = "Groq";
  slug = "groq";
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: config.ai.groq.apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      });
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!config.ai.groq.apiKey;
  }

  async chat(messages: ChatMessage[], model = "llama-3.1-8b-instant"): Promise<AIResponse> {
    const client = this.getClient();
    const start = Date.now();
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
        max_tokens: 4096,
      });
      const content = completion.choices[0]?.message?.content ?? "";
      return {
        content,
        model,
        provider: this.slug,
        tokensUsed: completion.usage?.total_tokens ?? 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      logger.error("Groq chat error", { error: err, model });
      throw err;
    }
  }

  async *stream(messages: ChatMessage[], model = "llama-3.1-8b-instant"): AsyncGenerator<string> {
    const client = this.getClient();
    const streamResponse = await client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.ChatCompletionMessageParam[],
      max_tokens: 4096,
      stream: true,
    });
    for await (const chunk of streamResponse) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) yield delta;
    }
  }

  async chatWithFile(
    messages: ChatMessage[],
    fileContent: string,
    fileName: string,
    model = "llama-3.1-8b-instant"
  ): Promise<AIResponse> {
    const augmented: ChatMessage[] = [
      ...messages.slice(0, -1),
      {
        role: "user",
        content: `[File: ${fileName}]\n\n${fileContent}\n\n${messages[messages.length - 1]?.content ?? ""}`,
      },
    ];
    return this.chat(augmented, model);
  }
}
