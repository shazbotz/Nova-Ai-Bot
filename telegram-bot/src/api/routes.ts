import { Router, Request, Response } from "express";
import { verifyTelegramInitData, createSessionToken, requireAuth } from "./auth";
import { getOrCreateUser, getConversationHistory, addMessage, clearUserMemory } from "../memory/userMemory";
import { checkCredits, deductCredit } from "../memory/credits";
import { streamChat } from "../ai/streamRouter";
import { getProviderStatus } from "../ai/router";
import { User, Plan, Conversation, IUser } from "../memory/models";
import { ChatMessage } from "../ai/types";
import { logger } from "../utils/logger";

export const apiRouter = Router();

type AuthRequest = Request & { userId: number };

// ── POST /api/auth ─────────────────────────────────────────────────────────────
// Verifies Telegram WebApp initData, returns a session token
apiRouter.post("/auth", async (req: Request, res: Response) => {
  const { initData } = req.body;
  if (!initData) {
    res.status(400).json({ error: "initData required" });
    return;
  }

  const telegramUser = verifyTelegramInitData(initData);
  if (!telegramUser) {
    // In development (no valid initData), allow a dev bypass via userId query param
    const devUserId = parseInt(req.query.dev_user as string || "0");
    if (process.env.NODE_ENV !== "production" && devUserId > 0) {
      const user = await getOrCreateUser(devUserId, { firstName: "Dev", username: "devuser" });
      const token = createSessionToken(devUserId);
      res.json({ token, user: sanitizeUser(user) });
      return;
    }
    res.status(401).json({ error: "Invalid Telegram initData" });
    return;
  }

  const user = await getOrCreateUser(telegramUser.userId, {
    username: telegramUser.username,
    firstName: telegramUser.firstName,
  });
  const token = createSessionToken(telegramUser.userId);
  res.json({ token, user: sanitizeUser(user) });
});

// ── GET /api/user/me ───────────────────────────────────────────────────────────
apiRouter.get("/user/me", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const user = await User.findOne({ telegramId: userId });
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const credit = await checkCredits(userId);
  const conv = await Conversation.findOne({ userId });
  res.json({
    user: sanitizeUser(user),
    credits: credit,
    messagesInMemory: conv?.messages.length ?? 0,
  });
});

// ── PATCH /api/user/preferences ────────────────────────────────────────────────
apiRouter.patch("/user/preferences", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const { preferredModel, preferredProvider, systemPrompt, language } = req.body;
  const update: Record<string, unknown> = {};
  if (preferredModel !== undefined) update["preferences.preferredModel"] = preferredModel;
  if (preferredProvider !== undefined) update["preferences.preferredProvider"] = preferredProvider;
  if (systemPrompt !== undefined) update["preferences.systemPrompt"] = systemPrompt;
  if (language !== undefined) update["preferences.language"] = language;
  await User.updateOne({ telegramId: userId }, { $set: update });
  res.json({ ok: true });
});

// ── GET /api/user/history ──────────────────────────────────────────────────────
apiRouter.get("/user/history", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const messages = await getConversationHistory(userId);
  res.json({ messages });
});

// ── DELETE /api/user/history ───────────────────────────────────────────────────
apiRouter.delete("/user/history", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  await clearUserMemory(userId);
  res.json({ ok: true });
});

// ── GET /api/providers ─────────────────────────────────────────────────────────
apiRouter.get("/providers", requireAuth, async (_req: Request, res: Response) => {
  const providers = await getProviderStatus();
  res.json({
    providers: providers.map((p) => ({
      slug: p.slug,
      name: p.name,
      enabled: p.enabled,
      models: p.models,
      defaultModel: p.defaultModel,
    })),
  });
});

// ── GET /api/plans ─────────────────────────────────────────────────────────────
apiRouter.get("/plans", requireAuth, async (_req: Request, res: Response) => {
  const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
  res.json({ plans });
});

// ── POST /api/chat/stream (SSE) ────────────────────────────────────────────────
// Streams AI response as Server-Sent Events
apiRouter.post("/chat/stream", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const { message, preferredProvider, preferredModel } = req.body;

  if (!message?.trim()) {
    res.status(400).json({ error: "message required" });
    return;
  }

  // Credit check
  const credit = await checkCredits(userId);
  if (!credit.allowed) {
    res.status(402).json({
      error: "NO_CREDITS",
      message: `No credits remaining. Plan: ${credit.planName}`,
      creditsRemaining: credit.creditsRemaining,
    });
    return;
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const user = await User.findOne({ telegramId: userId });
    const history = await getConversationHistory(userId);

    const systemPrompt =
      user?.preferences?.systemPrompt ||
      "You are a helpful, knowledgeable, and friendly AI assistant. Provide clear, accurate, and concise responses. Format responses with markdown when appropriate.";

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role as "user" | "assistant" | "system", content: m.content })),
      { role: "user", content: message.trim() },
    ];

    await addMessage(userId, "user", message.trim());

    const provider = preferredProvider || user?.preferences?.preferredProvider || undefined;
    const model = preferredModel || user?.preferences?.preferredModel || undefined;

    let fullContent = "";

    for await (const event of streamChat(messages, provider, model)) {
      if (event.type === "chunk") {
        fullContent += event.content;
        send(event);
      } else if (event.type === "done") {
        await deductCredit(userId);
        await addMessage(userId, "assistant", fullContent, event.model);
        const updatedCredit = await checkCredits(userId);
        send({ ...event, creditsRemaining: updatedCredit.creditsRemaining });
        break;
      } else if (event.type === "error") {
        send(event);
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("Stream chat error", { userId, error: msg });
    send({ type: "error", message: msg });
  } finally {
    res.end();
  }
});

function sanitizeUser(user: IUser) {
  return {
    telegramId: user.telegramId,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isAdmin: user.isAdmin,
    preferences: user.preferences,
    stats: user.stats,
    subscription: user.subscription,
  };
}
