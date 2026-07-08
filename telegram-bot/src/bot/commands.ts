import TelegramBot from "node-telegram-bot-api";
import { config } from "../config";
import { getOrCreateUser, clearUserMemory, getUserStats, setUserPreference } from "../memory/userMemory";
import { checkCredits, addCredits, assignPlan } from "../memory/credits";
import { getProviderStatus } from "../ai/router";
import { formatFileSize } from "../files/processor";
import { generateImage } from "../ai/imageGenerator";
import { logger } from "../utils/logger";
import { User, Plan } from "../memory/models";

export function registerCommands(bot: TelegramBot): void {
  const commands: TelegramBot.BotCommand[] = [
    { command: "start", description: "Start the bot & open AI Chat" },
    { command: "chat", description: "Open AI Chat Mini App" },
    { command: "help", description: "Show all available commands" },
    { command: "clear", description: "Clear your conversation memory" },
    { command: "stats", description: "View your usage statistics and credits" },
    { command: "plan", description: "View your current plan and quota" },
    { command: "model", description: "Set your preferred AI model" },
    { command: "status", description: "Check AI provider status" },
    { command: "imagine", description: "Generate an image with DALL-E 3" },
    { command: "about", description: "About this bot" },
  ];

  bot.setMyCommands(commands);

  // ── /start ────────────────────────────────────────────────────────────────
  bot.onText(/^\/start/, async (msg) => {
    const { id, username, first_name, last_name } = msg.from!;
    await getOrCreateUser(id, { username, firstName: first_name, lastName: last_name });
    const name = first_name || username || "there";
    const credit = await checkCredits(id);

    const miniAppUrl = config.telegram.miniAppUrl;
    const hasMiniApp = !!miniAppUrl;

    const text =
      `👋 Hello, *${name}*! Welcome to the AI Assistant.\n\n` +
      (hasMiniApp
        ? `💬 *Chat with AI* — tap the button below to open the full chat experience with streaming responses.\n\n`
        : `💬 Just type a message here to chat with AI.\n\n`) +
      `*Also available in chat:*\n` +
      `• 📄 Send PDF, DOCX, TXT or code files for analysis\n` +
      `• 🤖 Switch AI models with /model\n` +
      `• 🗑️ Clear memory with /clear\n\n` +
      `📋 *Plan:* ${credit.planName}  |  💬 *Credits:* ${credit.isUnlimited ? "Unlimited ♾️" : `${credit.creditsRemaining}/${credit.creditsTotal}`}\n\n` +
      `Use /help to see all commands.`;

    const opts: TelegramBot.SendMessageOptions = {
      parse_mode: "Markdown",
    };

    if (hasMiniApp) {
      opts.reply_markup = {
        inline_keyboard: [
          [{ text: "💬 Open AI Chat", web_app: { url: miniAppUrl } }],
          [{ text: "📊 My Stats", callback_data: "show_stats" }, { text: "💎 My Plan", callback_data: "show_plan" }],
        ],
      };
    } else {
      opts.reply_markup = {
        inline_keyboard: [
          [{ text: "📊 My Stats", callback_data: "show_stats" }, { text: "💎 My Plan", callback_data: "show_plan" }],
        ],
      };
    }

    bot.sendMessage(msg.chat.id, text, opts);
  });

  // ── /chat ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/chat/, async (msg) => {
    const miniAppUrl = config.telegram.miniAppUrl;
    if (miniAppUrl) {
      bot.sendMessage(msg.chat.id, "💬 *Open AI Chat*\n\nTap below to start chatting with full streaming responses:", {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[{ text: "💬 Open AI Chat", web_app: { url: miniAppUrl } }]],
        },
      });
    } else {
      bot.sendMessage(msg.chat.id, "💬 Just type your message here to chat with AI.\n\n_Mini App not configured. Set MINI\\_APP\\_URL to enable._", {
        parse_mode: "Markdown",
      });
    }
  });

  // ── /help ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/help/, async (msg) => {
    const user = await User.findOne({ telegramId: msg.from!.id });
    const isAdmin = user?.isAdmin || msg.from!.id === config.telegram.adminId;
    const hasMiniApp = !!config.telegram.miniAppUrl;

    let helpText =
      `*AI Assistant Bot — Commands*\n\n` +
      (hasMiniApp ? `💬 /chat — Open full AI Chat (Mini App)\n\n` : "") +
      `*General:*\n` +
      `/start — Welcome & quick access\n` +
      `/help — This help message\n` +
      `/about — About this bot\n\n` +
      `*Usage & Plan:*\n` +
      `/stats — Your usage statistics\n` +
      `/plan — Current plan & credits\n` +
      `/clear — Clear conversation history\n\n` +
      `*Preferences:*\n` +
      `/model — Set preferred AI model\n` +
      `/prompt [text] — Set custom system prompt\n\n` +
      `*AI Status:*\n` +
      `/status — Check AI provider status\n\n` +
      `*Files:*\n` +
      `📎 Send PDF, DOCX, TXT, code, or ZIP files!\n\n` +
      `*Image Generation:*\n` +
      `/imagine [description] — Generate image with DALL-E 3\n`;

    if (isAdmin) {
      helpText +=
        `\n*Admin Commands:*\n` +
        `/broadcast [msg] — Send to all users\n` +
        `/addcredits [user_id] [amount] — Add credits\n` +
        `/setplan [user_id] [plan_name] — Assign plan\n` +
        `/block [user_id] — Block a user\n` +
        `/unblock [user_id] — Unblock a user\n`;
    }

    bot.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
  });

  // ── /plan ─────────────────────────────────────────────────────────────────
  bot.onText(/^\/plan/, async (msg) => {
    const userId = msg.from!.id;
    const user = await User.findOne({ telegramId: userId });
    const credit = await checkCredits(userId);
    if (!user) return;

    const sub = user.subscription;
    const used = sub.creditsTotal - sub.creditsRemaining;
    const pct =
      sub.creditsTotal > 0 && sub.creditsTotal < 999999
        ? Math.round((used / sub.creditsTotal) * 100)
        : 0;
    const bar = buildProgressBar(pct);
    const resetDate = new Date(sub.periodEnd).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });

    const opts: TelegramBot.SendMessageOptions = {
      parse_mode: "Markdown",
    };

    if (config.telegram.miniAppUrl) {
      opts.reply_markup = {
        inline_keyboard: [[{ text: "💎 Manage Plan", web_app: { url: `${config.telegram.miniAppUrl}#plans` } }]],
      };
    }

    bot.sendMessage(
      msg.chat.id,
      `📋 *Your Subscription Plan*\n\n` +
        `🏷️ Plan: *${sub.planName}*\n` +
        `💬 Messages: ${credit.isUnlimited ? "Unlimited ♾️" : `${sub.creditsRemaining} remaining`}\n` +
        `${credit.isUnlimited ? "" : `${bar} ${pct}% used\n`}` +
        `📅 Resets: ${resetDate}\n\n` +
        `_Contact admin or use the button below to manage._`,
      opts
    );
  });

  // ── /stats ────────────────────────────────────────────────────────────────
  bot.onText(/^\/stats/, async (msg) => {
    const userId = msg.from!.id;
    const stats = await getUserStats(userId);
    const credit = await checkCredits(userId);

    bot.sendMessage(
      msg.chat.id,
      `📊 *Your Statistics*\n\n` +
        `📋 Plan: *${credit.planName}*\n` +
        `💬 Credits Left: *${credit.isUnlimited ? "Unlimited ♾️" : credit.creditsRemaining}*\n\n` +
        `📨 Total Messages: ${stats.totalMessages}\n` +
        `🧠 Messages in Memory: ${stats.messagesInMemory}\n` +
        `📄 Files Processed: ${stats.filesProcessed}\n` +
        `🤖 Preferred Model: ${stats.preferredModel}\n` +
        `📅 Member Since: ${stats.joinedAt ? new Date(stats.joinedAt).toLocaleDateString() : "N/A"}\n` +
        `⏰ Last Active: ${stats.lastActiveAt ? new Date(stats.lastActiveAt).toLocaleString() : "N/A"}`,
      { parse_mode: "Markdown" }
    );
  });

  // ── /clear ────────────────────────────────────────────────────────────────
  bot.onText(/^\/clear/, async (msg) => {
    await clearUserMemory(msg.from!.id);
    bot.sendMessage(msg.chat.id, "🗑️ Conversation memory cleared. Starting fresh!");
  });

  // ── /status ───────────────────────────────────────────────────────────────
  bot.onText(/^\/status/, async (msg) => {
    const providers = await getProviderStatus();
    let text = `🤖 *AI Provider Status*\n\n`;
    for (const p of providers) {
      const icon = p.enabled ? "✅" : "❌";
      const reqs = p.stats.totalRequests;
      const errs = p.stats.totalErrors;
      const pct = reqs > 0 ? Math.round(((reqs - errs) / reqs) * 100) : 100;
      text += `${icon} *${p.name}* (Priority: ${p.priority})\n   Model: \`${p.defaultModel}\` | Success: ${pct}%\n\n`;
    }
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  });

  // ── /model ────────────────────────────────────────────────────────────────
  bot.onText(/^\/model/, async (msg) => {
    const providers = await getProviderStatus();
    const keyboard: TelegramBot.InlineKeyboardButton[][] = [];
    for (const p of providers.filter((p) => p.enabled)) {
      for (const model of p.models) {
        keyboard.push([{ text: `${p.name}: ${model}`, callback_data: `setmodel:${p.slug}:${model}` }]);
      }
    }
    keyboard.push([{ text: "🔄 Auto (Best Available)", callback_data: "setmodel:auto:auto" }]);
    bot.sendMessage(msg.chat.id, "🤖 *Select your preferred AI model:*", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: keyboard },
    });
  });

  // ── /prompt ───────────────────────────────────────────────────────────────
  bot.onText(/^\/prompt(.*)/, async (msg, match) => {
    const promptText = match?.[1]?.trim();
    if (!promptText) {
      bot.sendMessage(
        msg.chat.id,
        "📝 *Set Custom System Prompt*\n\nUsage: `/prompt You are a helpful coding assistant`",
        { parse_mode: "Markdown" }
      );
      return;
    }
    await setUserPreference(msg.from!.id, "systemPrompt", promptText);
    bot.sendMessage(msg.chat.id, `✅ System prompt set!\n\n_"${promptText.slice(0, 100)}..."_`, {
      parse_mode: "Markdown",
    });
  });

  // ── /imagine ──────────────────────────────────────────────────────────────
  bot.onText(/^\/imagine(.*)/, async (msg, match) => {
    const prompt = match?.[1]?.trim();
    const chatId = msg.chat.id;

    if (!prompt) {
      bot.sendMessage(
        chatId,
        "🎨 *Generate an Image*\n\nUsage: `/imagine a futuristic city at sunset`\n\n_Powered by DALL-E 3_",
        { parse_mode: "Markdown" }
      );
      return;
    }

    const userId = msg.from!.id;
    const credit = await checkCredits(userId);
    if (!credit.allowed) {
      bot.sendMessage(
        chatId,
        `❌ No credits remaining. Your plan: *${credit.planName}*.\nContact admin to get more credits.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const statusMsg = await bot.sendMessage(chatId, "🎨 Generating your image… this takes 10-20 seconds.");
    try {
      const result = await generateImage(prompt);
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

      const caption =
        `🎨 *Image generated!*\n\n` +
        `📝 Prompt: _${prompt.slice(0, 200)}_` +
        (result.revisedPrompt && result.revisedPrompt !== prompt
          ? `\n\n🔧 _DALL-E refined: ${result.revisedPrompt.slice(0, 200)}_`
          : "");

      await bot.sendPhoto(chatId, result.buffer, {
        caption,
        parse_mode: "Markdown",
      });

      logger.info("Image generated", { userId, prompt: prompt.slice(0, 80) });
    } catch (err) {
      await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
      const errMsg = err instanceof Error ? err.message : String(err);
      bot.sendMessage(chatId, `❌ Image generation failed:\n_${errMsg}_`, { parse_mode: "Markdown" });
      logger.error("Image generation error", { userId, error: errMsg });
    }
  });

  // ── /about ────────────────────────────────────────────────────────────────
  bot.onText(/^\/about/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      `*Nova AI Bot v6*\n\nMulti-provider AI with streaming Mini App.\n\n` +
        `*Providers:* OpenAI • Anthropic • Gemini • Groq\n` +
        `*Features:* Streaming chat • Memory • Files • ZIP support • Image generation\n\n` +
        `Built with TypeScript + Node.js`,
      { parse_mode: "Markdown" }
    );
  });

  // ── Admin: /addcredits ────────────────────────────────────────────────────
  bot.onText(/^\/addcredits (\d+) (\d+)/, async (msg, match) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    const targetId = parseInt(match?.[1] || "0");
    const amount = parseInt(match?.[2] || "0");
    try {
      const newTotal = await addCredits(targetId, amount);
      bot.sendMessage(
        msg.chat.id,
        `✅ Added *${amount}* credits to user \`${targetId}\`.\nNew balance: *${newTotal}* credits.`,
        { parse_mode: "Markdown" }
      );
      bot.sendMessage(
        targetId,
        `🎁 *${amount} credits* added to your account!\nNew balance: *${newTotal}* messages.`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err instanceof Error ? err.message : err}`);
    }
  });

  // ── Admin: /setplan ───────────────────────────────────────────────────────
  bot.onText(/^\/setplan (\d+) (.+)/, async (msg, match) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    const targetId = parseInt(match?.[1] || "0");
    const planName = match?.[2]?.trim() || "";
    try {
      const escaped = planName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const plan = await Plan.findOne({ name: new RegExp(`^${escaped}$`, "i") });
      if (!plan) {
        bot.sendMessage(msg.chat.id, `❌ Plan "${planName}" not found.`);
        return;
      }
      await assignPlan(targetId, String(plan._id));
      bot.sendMessage(
        msg.chat.id,
        `✅ User \`${targetId}\` assigned to *${plan.name}* plan.`,
        { parse_mode: "Markdown" }
      );
      bot
        .sendMessage(
          targetId,
          `🎉 Your plan has been upgraded to *${plan.name}*!\n💬 *${plan.messagesPerMonth >= 999999 ? "Unlimited" : plan.messagesPerMonth}* messages/month.\n\nUse /plan to see details.`,
          { parse_mode: "Markdown" }
        )
        .catch(() => {});
    } catch (err) {
      bot.sendMessage(msg.chat.id, `❌ Error: ${err instanceof Error ? err.message : err}`);
    }
  });

  // ── Admin: /broadcast ─────────────────────────────────────────────────────
  bot.onText(/^\/broadcast (.+)/, async (msg, match) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    const message = match?.[1];
    if (!message) return;
    const users = await User.find({ isBlocked: false });
    let sent = 0;
    for (const user of users) {
      try {
        await bot.sendMessage(user.telegramId, `📢 *Broadcast*\n\n${message}`, { parse_mode: "Markdown" });
        sent++;
      } catch {}
    }
    bot.sendMessage(msg.chat.id, `✅ Sent to ${sent}/${users.length} users.`);
  });

  // ── Admin: /block /unblock ────────────────────────────────────────────────
  bot.onText(/^\/block (\d+)/, async (msg, match) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    await User.updateOne({ telegramId: parseInt(match?.[1] || "0") }, { $set: { isBlocked: true } });
    bot.sendMessage(msg.chat.id, `✅ User ${match?.[1]} blocked.`);
  });

  bot.onText(/^\/unblock (\d+)/, async (msg, match) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    await User.updateOne({ telegramId: parseInt(match?.[1] || "0") }, { $set: { isBlocked: false } });
    bot.sendMessage(msg.chat.id, `✅ User ${match?.[1]} unblocked.`);
  });

  // ── Admin: /admin ─────────────────────────────────────────────────────────
  bot.onText(/^\/admin/, async (msg) => {
    if (msg.from!.id !== config.telegram.adminId) return;
    bot.sendMessage(
      msg.chat.id,
      `🔐 *Admin Commands*\n\n` +
        `/addcredits [user_id] [amount]\n` +
        `/setplan [user_id] [plan_name]\n` +
        `/broadcast [msg]\n` +
        `/block [user_id]\n` +
        `/unblock [user_id]\n\n` +
        `_Full dashboard at /admin on the web panel._`,
      { parse_mode: "Markdown" }
    );
  });

  // ── Callbacks ─────────────────────────────────────────────────────────────
  bot.on("callback_query", async (query) => {
    if (!query.data) return;

    // Model selection
    if (query.data.startsWith("setmodel:")) {
      const parts = query.data.split(":");
      const providerSlug = parts[1];
      const model = parts[2];
      const userId = query.from.id;
      if (providerSlug === "auto") {
        await setUserPreference(userId, "preferredModel", null);
        await setUserPreference(userId, "preferredProvider", null);
        bot.answerCallbackQuery(query.id, { text: "✅ Set to Auto mode" });
        bot.editMessageText("✅ Model set to *Auto* (best available)", {
          chat_id: query.message!.chat.id,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
        });
      } else {
        await setUserPreference(userId, "preferredModel", model);
        await setUserPreference(userId, "preferredProvider", providerSlug);
        bot.answerCallbackQuery(query.id, { text: `✅ Set to ${model}` });
        bot.editMessageText(`✅ Model set to \`${model}\``, {
          chat_id: query.message!.chat.id,
          message_id: query.message!.message_id,
          parse_mode: "Markdown",
        });
      }
    }

    // Quick stats
    if (query.data === "show_stats") {
      const userId = query.from.id;
      const stats = await getUserStats(userId);
      const credit = await checkCredits(userId);
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(
        query.message!.chat.id,
        `📊 *Stats*\n\n📋 Plan: *${credit.planName}*\n💬 Credits: *${credit.isUnlimited ? "Unlimited ♾️" : credit.creditsRemaining}*\n📨 Total msgs: ${stats.totalMessages}\n📄 Files: ${stats.filesProcessed}`,
        { parse_mode: "Markdown" }
      );
    }

    // Quick plan
    if (query.data === "show_plan") {
      const userId = query.from.id;
      const credit = await checkCredits(userId);
      bot.answerCallbackQuery(query.id);
      const opts: TelegramBot.SendMessageOptions = {
        parse_mode: "Markdown",
      };
      if (config.telegram.miniAppUrl) {
        opts.reply_markup = {
          inline_keyboard: [[{ text: "💎 Manage Plan", web_app: { url: `${config.telegram.miniAppUrl}#plans` } }]],
        };
      }
      bot.sendMessage(
        query.message!.chat.id,
        `💎 *Plan:* ${credit.planName}\n💬 *Credits:* ${credit.isUnlimited ? "Unlimited ♾️" : `${credit.creditsRemaining} left`}`,
        opts
      );
    }
  });

  logger.info("Bot commands registered");
}

function buildProgressBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}
