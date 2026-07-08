import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { AIResponse, ChatMessage, AIProviderInterface } from "../types";

export class AnthropicProvider implements AIProviderInterface {
  name = "Anthropic";
  slug = "anthropic";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.ai.anthropic.apiKey });
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!config.ai.anthropic.apiKey;
  }

  async chat(messages: ChatMessage[], model = "claude-3-5-haiku-20241022"): Promise<AIResponse> {
    const client = this.getClient();
    const start = Date.now();
    try {
      const systemMsg = messages.find((m) => m.role === "system");
      const userMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const completion = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemMsg?.content,
        messages: userMessages,
      });

      const content =
        completion.content[0]?.type === "text" ? completion.content[0].text : "";

      return {
        content,
        model,
        provider: this.slug,
        tokensUsed: completion.usage.input_tokens + completion.usage.output_tokens,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      logger.error("Anthropic chat error", { error: err, model });
      throw err;
    }
  }

  async chatWithFile(
    messages: ChatMessage[],
    fileContent: string,
    fileName: string,
    model = "claude-3-5-haiku-20241022"
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
