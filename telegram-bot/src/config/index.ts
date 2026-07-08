import dotenv from "dotenv";
dotenv.config();

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    adminId: parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10),
    miniAppUrl: process.env.MINI_APP_URL || "",
  },
  mongodb: {
    uri: process.env.MONGODB_URI || "mongodb://localhost:27017/aibot",
  },
  ai: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || "",
      baseUrl: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || "",
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || "",
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY || "",
    },
    defaultModel: process.env.DEFAULT_AI_MODEL || "openai/gpt-4o-mini",
  },
  admin: {
    port: parseInt(process.env.ADMIN_PORT || process.env.PORT || "5000", 10),
    sessionSecret: process.env.SESSION_SECRET || "changeme-super-secret",
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin123",
  },
  limits: {
    // Telegram's standard cloud Bot API refuses to serve file downloads over
    // 20MB regardless of this setting (only a self-hosted local Bot API
    // server can raise that). Keep this aligned so the "file too large"
    // message users see is actually accurate.
    maxFileSize: 20 * 1024 * 1024,
    maxContextMessages: 20,
    maxMemoryPerUser: 100,
    rateLimitPerMinute: 30,
  },
};

export function validateConfig(): string[] {
  const errors: string[] = [];
  if (!config.telegram.token) errors.push("TELEGRAM_BOT_TOKEN is required");
  if (!config.mongodb.uri) errors.push("MONGODB_URI is required");
  if (!config.telegram.adminId) errors.push("ADMIN_TELEGRAM_ID is required");
  return errors;
}
