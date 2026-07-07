import TelegramBot from "node-telegram-bot-api";
import { routeChat } from "../ai/router";
import {
  getOrCreateUser,
  addMessage,
  getConversationHistory,
  isUserBlocked,
} from "../memory/userMemory";
import { checkCredits, deductCredit } from "../memory/credits";
import { downloadTelegramFile, processFile, formatFileSize } from "../files/processor";
import { config } from "../config";
import { logger } from "../utils/logger";
import { User } from "../memory/models";
import { ChatMessage } from "../ai/types";

const TYPING_INTERVAL = 4000;

// ── Deduplication: prevent processing the same message_id twice ───────────────
const processedMessages = new Set<number>();
const DEDUP_MAX = 2000;

function markProcessed(messageId: number): boolean {
  if (processedMessages.has(messageId)) return false; // already handled
  processedMessages.add(messageId);
  // Keep memory bounded
  if (processedMessages.size > DEDUP_MAX) {
    const first = processedMessages.values().next().value;
    processedMessages.delete(first);
  }
  return true;
}

export function registerMessageHandler(bot: TelegramBot): void {
  bot.on("message", async (msg) => {
    // ── Guard: skip commands
    if (msg.text?.startsWith("/")) return;

    // ── Guard: skip empty messages
    if (!msg.text && !msg.document && !msg.photo && !msg.audio && !msg.voice) return;

    // ── Guard: skip messages from bots (prevents relay-bot double responses)
    if (msg.from?.is_bot) return;

    // ── Guard: deduplicate (prevents re-processing after bot restart)
    if (!markProcessed(msg.message_id)) {
      logger.warn("Duplicate message_id skipped", { messageId: msg.message_id });
      return;
    }

    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

    // ── Guard: in groups only respond when @mentioned or replied to
    if (isGroup) {
      const botInfo = await bot.getMe().catch(() => null);
      const botUsername = botInfo?.username;
      const mentionedBot = botUsername && msg.text?.includes(`@${botUsername}`);
      const repliedToBot = msg.reply_to_message?.from?.is_bot;
      if (!mentionedBot && !repliedToBot) return;
      // Strip the @mention from the text so the AI doesn't see it
      if (msg.text && botUsername) {
        msg.text = msg.text.replace(`@${botUsername}`, "").trim();
      }
    }

    // ── Guard: blocked users
    if (await isUserBlocked(userId)) {
      logger.warn("Blocked user attempted to send message", { userId });
      return;
    }

    // ── Ensure user record exists
    const user = await getOrCreateUser(userId, {
      username: msg.from!.username,
      firstName: msg.from!.first_name,
      lastName: msg.from!.last_name,
    });

    // ── Credit check ─────────────────────────────────────────────────────────
    const credit = await checkCredits(userId);
    if (!credit.allowed) {
      const resetDate = new Date(user.subscription.periodEnd).toLocaleDateString("en-US", {
        month: "short", day: "numeric", year: "numeric",
      });
      bot.sendMessage(
        chatId,
        `🚫 *No credits remaining*\n\n` +
          `📋 Plan: *${credit.planName}*\n` +
          `💬 Quota: ${credit.creditsTotal >= 999999 ? "Unlimited" : credit.creditsTotal + " messages/month"}\n` +
          `🔄 Resets: ${resetDate}\n\n` +
          `Contact the admin to upgrade your plan or add credits.\n` +
          `Use /plan to view your subscription.`,
        { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
      );
      return;
    }

    // ── Start typing indicator ────────────────────────────────────────────────
    const typingInterval = setInterval(() => {
      bot.sendChatAction(chatId, "typing").catch(() => {});
    }, TYPING_INTERVAL);
    bot.sendChatAction(chatId, "typing").catch(() => {});

    try {
      // ── File messages
      if (msg.document || msg.photo || msg.audio || msg.voice) {
        clearInterval(typingInterval);
        await handleFileMessage(bot, msg, userId, chatId, credit.isUnlimited);
        return;
      }

      const userText = msg.text || "";
      if (!userText) { clearInterval(typingInterval); return; }

      // ── Build conversation context
      const history = await getConversationHistory(userId);
      const messages: ChatMessage[] = [];

      const systemPrompt =
        user.preferences?.systemPrompt ||
        "You are a helpful, knowledgeable, and friendly AI assistant. " +
          "Provide clear, accurate, and concise responses. " +
          "When helping with code, provide working examples with explanations. " +
          "Format responses with markdown when appropriate for Telegram.";

      messages.push({ role: "system", content: systemPrompt });
      for (const m of history) {
        messages.push({ role: m.role as "user" | "assistant" | "system", content: m.content });
      }
      messages.push({ role: "user", content: userText });

      await addMessage(userId, "user", userText);

      const preferredProvider = (user.preferences as Record<string, unknown>)?.preferredProvider as string | undefined;
      const preferredModel = user.preferences?.preferredModel;

      // ── Route to AI
      const response = await routeChat(messages, preferredProvider, preferredModel);

      // ── Deduct credit ONLY after a successful response
      await deductCredit(userId);
      await addMessage(userId, "assistant", response.content, response.model);

      clearInterval(typingInterval);

      // ── Send response (split if >4096 chars)
      const maxLen = 4096;
      const chunks = response.content.length <= maxLen
        ? [response.content]
        : splitMessage(response.content, maxLen);

      for (let i = 0; i < chunks.length; i++) {
        await bot
          .sendMessage(chatId, chunks[i], {
            parse_mode: "Markdown",
            reply_to_message_id: i === 0 ? msg.message_id : undefined,
          })
          .catch(() =>
            bot.sendMessage(chatId, chunks[i], {
              reply_to_message_id: i === 0 ? msg.message_id : undefined,
            })
          );
      }

      // ── Low credit warning (show after sending response)
      if (credit.isLow && !credit.isUnlimited) {
        const remaining = credit.creditsRemaining - 1;
        if (remaining > 0) {
          bot.sendMessage(
            chatId,
            `⚠️ *Low credits:* Only ${remaining} message${remaining === 1 ? "" : "s"} left this month.\nUse /plan to check your subscription.`,
            { parse_mode: "Markdown" }
          ).catch(() => {});
        }
      }

      logger.info("Message handled", {
        userId,
        provider: response.provider,
        model: response.model,
        latencyMs: response.latencyMs,
        creditsLeft: credit.creditsRemaining - 1,
      });
    } catch (err) {
      clearInterval(typingInterval);
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("Message handler error", { userId, error: errMsg });

      const isNoKeys = errMsg.includes("NO_API_KEYS");
      const userMsg = isNoKeys
        ? `⚙️ *Bot not configured yet*\n\nNo AI provider API keys have been set up.\n\nPlease ask the admin to add an API key (e.g. GROQ\\_API\\_KEY from groq.com).`
        : `❌ Something went wrong. Please try again or use /clear to reset your conversation.`;

      bot
        .sendMessage(chatId, userMsg, {
          parse_mode: "Markdown",
          reply_to_message_id: msg.message_id,
        })
        .catch(() => {});
    }
  });
}

// ── File processing ───────────────────────────────────────────────────────────
async function handleFileMessage(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  userId: number,
  chatId: number,
  isUnlimited: boolean
): Promise<void> {
  const fileId =
    msg.document?.file_id ||
    msg.audio?.file_id ||
    (msg.photo ? msg.photo[msg.photo.length - 1]?.file_id : undefined);

  if (!fileId) {
    bot.sendMessage(chatId, "❌ Could not access this file type.");
    return;
  }

  const statusMsg = await bot.sendMessage(chatId, "📥 Downloading and processing your file...");

  try {
    const { buffer, fileName } = await downloadTelegramFile(fileId, config.telegram.token);

    if (buffer.length > config.limits.maxFileSize) {
      await bot.editMessageText(
        `❌ File too large. Maximum size is ${formatFileSize(config.limits.maxFileSize)}.`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
      return;
    }

    await bot.editMessageText("🔍 Analyzing file content...", {
      chat_id: chatId,
      message_id: statusMsg.message_id,
    });

    const result = await processFile(buffer, fileName);

    await User.updateOne(
      { telegramId: userId },
      { $inc: { "stats.filesProcessed": 1 } }
    );

    const caption = msg.caption || msg.text || "Please analyze this file and provide a summary.";
    const user = await User.findOne({ telegramId: userId });
    const history = await getConversationHistory(userId);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          user?.preferences?.systemPrompt ||
          "You are a helpful AI assistant specialized in document analysis. Provide clear summaries and answer questions about file content.",
      },
      ...history.map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content,
      })),
    ];

    await addMessage(userId, "user", `[Uploaded file: ${fileName}] ${caption}`);
    messages.push({ role: "user", content: caption });

    await bot.editMessageText(
      `📄 *File processed:* ${fileName}\n📊 Size: ${formatFileSize(result.size)}${result.pages ? ` | Pages: ${result.pages}` : ""}\n\n⏳ Generating analysis...`,
      { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: "Markdown" }
    );

    const response = await routeChat(messages, undefined, undefined, result.text, result.fileName);
    await deductCredit(userId);
    await addMessage(userId, "assistant", response.content, response.model);

    await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
    await bot
      .sendMessage(chatId, response.content, { parse_mode: "Markdown" })
      .catch(() => bot.sendMessage(chatId, response.content));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await bot
      .editMessageText(`❌ Error processing file: ${errMsg.slice(0, 200)}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
      })
      .catch(() => {});
  }
}

// ── Utility: split long messages ──────────────────────────────────────────────
function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < maxLength / 2) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
