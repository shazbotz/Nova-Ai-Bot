import { AIProvider } from "../memory/models";
import { logger } from "../utils/logger";
import { AIResponse, ChatMessage, AIProviderInterface } from "./types";
import { OpenAIProvider } from "./providers/openaiProvider";
import { AnthropicProvider } from "./providers/anthropicProvider";
import { GeminiProvider } from "./providers/geminiProvider";
import { GroqProvider } from "./providers/groqProvider";

const PROVIDER_INSTANCES: Record<string, AIProviderInterface> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
  groq: new GroqProvider(),
};

const DEFAULT_PROVIDERS = [
  {
    name: "OpenAI",
    slug: "openai",
    priority: 1,
    enabled: true,
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
    defaultModel: "gpt-4o-mini",
    rateLimit: { requestsPerMinute: 60, currentCount: 0, resetAt: new Date() },
  },
  {
    name: "Anthropic",
    slug: "anthropic",
    priority: 2,
    enabled: true,
    models: ["claude-3-5-haiku-20241022", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
    defaultModel: "claude-3-5-haiku-20241022",
    rateLimit: { requestsPerMinute: 50, currentCount: 0, resetAt: new Date() },
  },
  {
    name: "Gemini",
    slug: "gemini",
    priority: 3,
    enabled: true,
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"],
    defaultModel: "gemini-1.5-flash",
    rateLimit: { requestsPerMinute: 60, currentCount: 0, resetAt: new Date() },
  },
  {
    name: "Groq",
    slug: "groq",
    priority: 4,
    enabled: true,
    models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    defaultModel: "llama-3.1-8b-instant",
    rateLimit: { requestsPerMinute: 30, currentCount: 0, resetAt: new Date() },
  },
];

export async function initProviders(): Promise<void> {
  for (const p of DEFAULT_PROVIDERS) {
    const existing = await AIProvider.findOne({ slug: p.slug });
    if (!existing) {
      await new AIProvider({ ...p, stats: { totalRequests: 0, totalErrors: 0 } }).save();
    }
  }
  logger.info("AI providers initialized");
}

async function getOrderedProviders() {
  return AIProvider.find({ enabled: true }).sort({ priority: 1 });
}

function isRateLimited(provider: InstanceType<typeof AIProvider>): boolean {
  const now = new Date();
  if (now > provider.rateLimit.resetAt) {
    provider.rateLimit.currentCount = 0;
    provider.rateLimit.resetAt = new Date(now.getTime() + 60000);
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

export async function routeChat(
  messages: ChatMessage[],
  preferredProvider?: string,
  preferredModel?: string,
  fileContent?: string,
  fileName?: string
): Promise<AIResponse> {
  const providers = await getOrderedProviders();

  // If preferred provider specified, try it first
  const ordered =
    preferredProvider
      ? [
          ...providers.filter((p) => p.slug === preferredProvider),
          ...providers.filter((p) => p.slug !== preferredProvider),
        ]
      : providers;

  const errors: string[] = [];

  for (const providerDoc of ordered) {
    const instance = PROVIDER_INSTANCES[providerDoc.slug];
    if (!instance) continue;
    if (!instance.isAvailable()) {
      logger.debug(`Provider ${providerDoc.slug} not available (no API key)`);
      continue;
    }
    if (isRateLimited(providerDoc)) {
      logger.warn(`Provider ${providerDoc.slug} is rate limited, skipping`);
      continue;
    }

    const model =
      preferredModel && providerDoc.slug === preferredProvider
        ? preferredModel
        : providerDoc.defaultModel;

    try {
      logger.info(`Routing to ${providerDoc.slug}/${model}`);
      let response: AIResponse;
      if (fileContent && fileName) {
        response = await instance.chatWithFile(messages, fileContent, fileName, model);
      } else {
        response = await instance.chat(messages, model);
      }
      await recordSuccess(providerDoc.slug);
      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${providerDoc.slug}: ${errMsg}`);
      await recordError(providerDoc.slug, errMsg);
      logger.warn(`Provider ${providerDoc.slug} failed, trying next`, { error: errMsg });
    }
  }

  if (errors.length === 0) {
    throw new Error("NO_API_KEYS");
  }
  throw new Error(`All AI providers failed. Errors: ${errors.join("; ")}`);
}

export async function getProviderStatus() {
  return AIProvider.find().sort({ priority: 1 });
}

export async function updateProviderPriority(slug: string, priority: number): Promise<void> {
  await AIProvider.updateOne({ slug }, { $set: { priority } });
}

export async function toggleProvider(slug: string, enabled: boolean): Promise<void> {
  await AIProvider.updateOne({ slug }, { $set: { enabled } });
}
