import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../../config";
import { logger } from "../../utils/logger";
import { AIResponse, ChatMessage, AIProviderInterface } from "../types";

export class GeminiProvider implements AIProviderInterface {
  name = "Gemini";
  slug = "gemini";
  private client: GoogleGenerativeAI | null = null;

  private getClient(): GoogleGenerativeAI {
    if (!this.client) {
      this.client = new GoogleGenerativeAI(config.ai.gemini.apiKey);
    }
    return this.client;
  }

  isAvailable(): boolean {
    return !!config.ai.gemini.apiKey;
  }

  async chat(messages: ChatMessage[], model = "gemini-1.5-flash"): Promise<AIResponse> {
    const client = this.getClient();
    const start = Date.now();
    try {
      const genModel = client.getGenerativeModel({ model });
      const systemMsg = messages.find((m) => m.role === "system");
      const history = messages
        .filter((m) => m.role !== "system")
        .slice(0, -1)
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const lastMsg = messages.filter((m) => m.role !== "system").pop();
      const chat = genModel.startChat({
        history,
        systemInstruction: systemMsg?.content,
      });

      const result = await chat.sendMessage(lastMsg?.content ?? "");
      const content = result.response.text();

      return {
        content,
        model,
        provider: this.slug,
        tokensUsed: result.response.usageMetadata?.totalTokenCount ?? 0,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      logger.error("Gemini chat error", { error: err, model });
      throw err;
    }
  }

  async chatWithFile(
    messages: ChatMessage[],
    fileContent: string,
    fileName: string,
    model = "gemini-1.5-flash"
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
