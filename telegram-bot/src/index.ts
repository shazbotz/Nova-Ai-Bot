import dotenv from "dotenv";
dotenv.config();

import TelegramBot from "node-telegram-bot-api";
import { config, validateConfig } from "./config";
import { connectDatabase } from "./memory/database";
import { initProviders } from "./ai/router";
import { initDefaultPlans } from "./memory/credits";
import { registerCommands } from "./bot/commands";
import { registerMessageHandler } from "./bot/messageHandler";
import { createAdminServer } from "./admin/server";
import { logger } from "./utils/logger";

async function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    errors.forEach((e) => logger.error(e));
    process.exit(1);
  }

  logger.info("Connecting to MongoDB...");
  await connectDatabase();

  await initProviders();
  await initDefaultPlans();

  logger.info("Starting Telegram bot...");
  const bot = new TelegramBot(config.telegram.token, { polling: true });

  registerCommands(bot);
  registerMessageHandler(bot);

  bot.on("polling_error", (error) => {
    logger.error("Telegram polling error", { error: error.message });
  });

  bot.on("error", (error) => {
    logger.error("Telegram bot error", { error: error.message });
  });

  const app = createAdminServer();
  app.listen(config.admin.port, "0.0.0.0", () => {
    logger.info(`Admin dashboard running on port ${config.admin.port}`);
    logger.info(`Visit: http://localhost:${config.admin.port}/admin`);
  });

  logger.info("AI Assistant Telegram Bot is running!");

  process.on("SIGTERM", () => { bot.stopPolling(); process.exit(0); });
  process.on("SIGINT", () => { bot.stopPolling(); process.exit(0); });
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err });
  process.exit(1);
});
