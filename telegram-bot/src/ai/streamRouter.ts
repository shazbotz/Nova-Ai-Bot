import { AIProvider } from "../memory/models";
import { logger } from "../utils/logger";
import { ChatMessage } from "./types";
import { GroqProvider } from "./providers/groqProvider";
import { OpenAIProvider } from "./providers/openaiProvider";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { GeminiProvider } from "./providers/geminiProvider";

export type StreamEvent =
  | { type: "chunk"; content: string }
  | { type: "done"; model: string; provider: string }
  | { type: "error"; message: string };

const STREAMABLE_PROVIDERS: Record<string, GroqProvider | OpenAIProvider | AnthropicProvider | GeminiProvider> = {
  groq: new GroqProvider(),
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
};

async function isRateLimited(provider: InstanceType<typeof AIProvider>): Promise<boolean> {
  const now = new Date();
  if (now > provider.rateLimit.resetAt) {
    const newResetAt = new Date(now.getTime() + 60000);
    await AIProvider.updateOne(
      { slug: provider.slug },
      { $set: { "rateLimit.currentCount": 0, "rateLimit.resetAt": newResetAt } }
    );
    provider.rateLimit.currentCount = 0;
    provider.rateLimit.resetAt = newResetAt;
    return false;
  }
  return provider.rateLimit.currentCount >= provider.rateLimit.requestsPerMinute;
}

async function recordSuccess(slug: string): Promise<void> {
  await AIProvider.updateOne(
    { slug },
    {
      $inc: { "stats.totalRequests": 1, "rateLimit.currentCount": 1 },
      $set: { "stats.lastUsedAt": new Date() },
    }
  );
}

async function recordError(slug: string, error: string): Promise<void> {
  await AIProvider.updateOne(
    { slug },
    {
      $inc: { "stats.totalErrors": 1 },
      $set: { "stats.lastErrorAt": new Date(), "stats.lastError": error },
    }
  );
}

export async function* streamChat(
  messages: ChatMessage[],
  preferredProvider?: string,
  preferredModel?: string
): AsyncGenerator<StreamEvent> {
  const providers = await AIProvider.find({ enabled: true }).sort({ priority: 1 });

  const ordered = preferredProvider
    ? [
        ...providers.filter((p) => p.slug === preferredProvider),
        ...providers.filter((p) => p.slug !== preferredProvider),
      ]
    : providers;

  let sawRateLimited = false;
  for (const providerDoc of ordered) {
    const instance = STREAMABLE_PROVIDERS[providerDoc.slug];
    if (!instance || !instance.isAvailable()) continue;
    if (await isRateLimited(providerDoc)) {
      sawRateLimited = true;
      continue;
    }

    const model =
      preferredModel && providerDoc.slug === preferredProvider
        ? preferredModel
        : providerDoc.defaultModel;

    try {
      logger.info(`Streaming via ${providerDoc.slug}/${model}`);

      // Providers with native streaming support
      if ((providerDoc.slug === "groq" || providerDoc.slug === "openai") &&
          typeof (instance as GroqProvider).stream === "function") {
        const provider = instance as GroqProvider | OpenAIProvider;
        let totalContent = "";
        for await (const chunk of provider.stream(messages, model)) {
          totalContent += chunk;
          yield { type: "chunk", content: chunk };
        }
        await recordSuccess(providerDoc.slug);
        yield { type: "done", model, provider: providerDoc.slug };
        return;
      }

      // Fallback: full response → simulate streaming word-by-word
      const response = await instance.chat(messages, model);
      await recordSuccess(providerDoc.slug);

      const words = response.content.split(/(\s+)/);
      for (let i = 0; i < words.length; i++) {
        if (words[i]) {
          yield { type: "chunk", content: words[i] };
          // Small delay to make it feel real
          await new Promise((r) => setTimeout(r, 8));
        }
      }
      yield { type: "done", model: response.model, provider: response.provider };
      return;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await recordError(providerDoc.slug, errMsg);
      logger.warn(`Stream provider ${providerDoc.slug} failed, trying next`, { error: errMsg });
    }
  }

  yield {
    type: "error",
    message: sawRateLimited
      ? "All AI providers are busy right now. Please wait a minute and try again."
      : "No AI providers available. Please check your API keys.",
  };
}
