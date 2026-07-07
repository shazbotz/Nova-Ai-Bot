import { User, Conversation, IMessage, IUser } from "./models";
import { config } from "../config";
import { logger } from "../utils/logger";

export async function getOrCreateUser(
  telegramId: number,
  data?: { username?: string; firstName?: string; lastName?: string }
): Promise<IUser> {
  let user = await User.findOne({ telegramId });
  if (!user) {
    user = new User({
      telegramId,
      username: data?.username,
      firstName: data?.firstName,
      lastName: data?.lastName,
      isAdmin: telegramId === config.telegram.adminId,
    });
    await user.save();
    logger.info("New user created", { telegramId, username: data?.username });
  } else {
    user.stats.lastActiveAt = new Date();
    if (data?.username) user.username = data.username;
    if (data?.firstName) user.firstName = data.firstName;
    if (data?.lastName) user.lastName = data.lastName;
    await user.save();
  }
  return user;
}

export async function addMessage(
  userId: number,
  role: "user" | "assistant" | "system",
  content: string,
  model?: string
): Promise<void> {
  let conv = await Conversation.findOne({ userId });
  if (!conv) {
    conv = new Conversation({ userId, messages: [] });
  }

  const maxContext = config.limits.maxContextMessages * 2;
  conv.messages.push({ role, content, timestamp: new Date(), model });

  if (conv.messages.length > maxContext) {
    conv.messages = conv.messages.slice(-maxContext);
  }
  await conv.save();

  await User.updateOne(
    { telegramId: userId },
    { $inc: { "stats.totalMessages": 1 }, $set: { "stats.lastActiveAt": new Date() } }
  );
}

export async function getConversationHistory(userId: number): Promise<IMessage[]> {
  const user = await User.findOne({ telegramId: userId });
  const maxCtx = user?.preferences?.maxContext ?? config.limits.maxContextMessages;
  const conv = await Conversation.findOne({ userId });
  if (!conv) return [];
  return conv.messages.slice(-maxCtx * 2);
}

export async function clearUserMemory(userId: number): Promise<void> {
  await Conversation.deleteOne({ userId });
  logger.info("User memory cleared", { userId });
}

export async function getUserStats(userId: number) {
  const user = await User.findOne({ telegramId: userId });
  const conv = await Conversation.findOne({ userId });
  return {
    totalMessages: user?.stats.totalMessages ?? 0,
    totalTokensUsed: user?.stats.totalTokensUsed ?? 0,
    filesProcessed: user?.stats.filesProcessed ?? 0,
    joinedAt: user?.stats.joinedAt,
    lastActiveAt: user?.stats.lastActiveAt,
    messagesInMemory: conv?.messages.length ?? 0,
    preferredModel: user?.preferences.preferredModel ?? "auto",
  };
}

export async function setUserPreference(
  userId: number,
  key: string,
  value: unknown
): Promise<void> {
  await User.updateOne(
    { telegramId: userId },
    { $set: { [`preferences.${key}`]: value } }
  );
}

export async function isUserBlocked(userId: number): Promise<boolean> {
  const user = await User.findOne({ telegramId: userId });
  return user?.isBlocked ?? false;
}
