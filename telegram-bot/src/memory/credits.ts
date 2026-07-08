import { User, Plan, IUser } from "./models";
import { logger } from "../utils/logger";

export interface CreditCheckResult {
  allowed: boolean;
  creditsRemaining: number;
  creditsTotal: number;
  planName: string;
  reason?: "no_credits" | "expired" | "blocked";
  isLow: boolean;
  isUnlimited: boolean;
}

const UNLIMITED = 999999;
const LOW_THRESHOLD = 10;

export async function checkCredits(userId: number): Promise<CreditCheckResult> {
  const user = await User.findOne({ telegramId: userId });
  if (!user) {
    return { allowed: false, creditsRemaining: 0, creditsTotal: 0, planName: "None", reason: "no_credits", isLow: false, isUnlimited: false };
  }

  const sub = user.subscription;

  // Admins and unlimited plans bypass checks
  if (user.isAdmin || sub.creditsTotal >= UNLIMITED) {
    return { allowed: true, creditsRemaining: sub.creditsRemaining, creditsTotal: sub.creditsTotal, planName: sub.planName, isLow: false, isUnlimited: true };
  }

  // Check if period expired — auto-reset if so
  const now = new Date();
  if (now > sub.periodEnd) {
    if (sub.autoRenew && sub.planId) {
      await renewSubscription(user);
      const refreshed = await User.findOne({ telegramId: userId });
      const rsub = refreshed!.subscription;
      return { allowed: rsub.creditsRemaining > 0, creditsRemaining: rsub.creditsRemaining, creditsTotal: rsub.creditsTotal, planName: rsub.planName, isLow: rsub.creditsRemaining <= LOW_THRESHOLD, isUnlimited: false };
    }
    // Expired — drop to free tier (50 msgs) and restart period
    await resetToFree(user);
    const refreshed = await User.findOne({ telegramId: userId });
    const rsub = refreshed!.subscription;
    return { allowed: rsub.creditsRemaining > 0, creditsRemaining: rsub.creditsRemaining, creditsTotal: rsub.creditsTotal, planName: rsub.planName, isLow: rsub.creditsRemaining <= LOW_THRESHOLD, isUnlimited: false };
  }

  if (sub.creditsRemaining <= 0) {
    return { allowed: false, creditsRemaining: 0, creditsTotal: sub.creditsTotal, planName: sub.planName, reason: "no_credits", isLow: false, isUnlimited: false };
  }

  return {
    allowed: true,
    creditsRemaining: sub.creditsRemaining,
    creditsTotal: sub.creditsTotal,
    planName: sub.planName,
    isLow: sub.creditsRemaining <= LOW_THRESHOLD,
    isUnlimited: false,
  };
}

export async function deductCredit(userId: number): Promise<void> {
  const user = await User.findOne({ telegramId: userId });
  if (!user || user.isAdmin || user.subscription.creditsTotal >= UNLIMITED) return;
  await User.updateOne(
    { telegramId: userId, "subscription.creditsRemaining": { $gt: 0 } },
    { $inc: { "subscription.creditsRemaining": -1 } }
  );
}

export async function addCredits(userId: number, amount: number): Promise<number> {
  const user = await User.findOne({ telegramId: userId });
  if (!user) throw new Error("User not found");
  const newTotal = Math.max(0, user.subscription.creditsRemaining + amount);
  await User.updateOne(
    { telegramId: userId },
    { $set: { "subscription.creditsRemaining": newTotal } }
  );
  logger.info("Credits added", { userId, amount, newTotal });
  return newTotal;
}

export async function assignPlan(userId: number, planId: string): Promise<void> {
  const plan = await Plan.findById(planId);
  if (!plan) throw new Error("Plan not found");

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await User.updateOne(
    { telegramId: userId },
    {
      $set: {
        "subscription.planId": plan._id,
        "subscription.planName": plan.name,
        "subscription.creditsRemaining": plan.messagesPerMonth,
        "subscription.creditsTotal": plan.messagesPerMonth,
        "subscription.periodStart": now,
        "subscription.periodEnd": periodEnd,
        "subscription.autoRenew": true,
      },
    }
  );
  logger.info("Plan assigned", { userId, planName: plan.name, credits: plan.messagesPerMonth });
}

async function renewSubscription(user: IUser): Promise<void> {
  const plan = await Plan.findById(user.subscription.planId);
  if (!plan) return;
  const now = new Date();
  await User.updateOne(
    { telegramId: user.telegramId },
    {
      $set: {
        "subscription.creditsRemaining": plan.messagesPerMonth,
        "subscription.creditsTotal": plan.messagesPerMonth,
        "subscription.periodStart": now,
        "subscription.periodEnd": new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    }
  );
  logger.info("Subscription renewed", { userId: user.telegramId, planName: plan.name });
}

async function resetToFree(user: IUser): Promise<void> {
  const freePlan = await Plan.findOne({ isDefault: true });
  const credits = freePlan?.messagesPerMonth ?? 50;
  const now = new Date();
  await User.updateOne(
    { telegramId: user.telegramId },
    {
      $set: {
        "subscription.planId": freePlan?._id,
        "subscription.planName": freePlan?.name ?? "Free",
        "subscription.creditsRemaining": credits,
        "subscription.creditsTotal": credits,
        "subscription.periodStart": now,
        "subscription.periodEnd": new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        "subscription.autoRenew": false,
      },
    }
  );
}

export async function initDefaultPlans(): Promise<void> {
  const count = await Plan.countDocuments();
  if (count > 0) return;

  await Plan.insertMany([
    {
      name: "Free",
      description: "Get started with basic AI access",
      messagesPerMonth: 50,
      price: 0,
      currency: "USD",
      features: ["50 messages/month", "All AI models", "File analysis", "Conversation memory"],
      isDefault: true,
      isActive: true,
      color: "#64748b",
    },
    {
      name: "Basic",
      description: "For regular users",
      messagesPerMonth: 300,
      price: 5,
      currency: "USD",
      features: ["300 messages/month", "All AI models", "File analysis", "Priority support"],
      isDefault: false,
      isActive: true,
      color: "#2563eb",
    },
    {
      name: "Pro",
      description: "For power users",
      messagesPerMonth: 1000,
      price: 15,
      currency: "USD",
      features: ["1000 messages/month", "All AI models", "Unlimited file analysis", "Priority routing", "Custom system prompt"],
      isDefault: false,
      isActive: true,
      color: "#7c3aed",
    },
    {
      name: "Unlimited",
      description: "No limits, ever",
      messagesPerMonth: 999999,
      price: 30,
      currency: "USD",
      features: ["Unlimited messages", "All AI models", "Unlimited files", "Highest priority", "Direct admin support"],
      isDefault: false,
      isActive: true,
      color: "#059669",
    },
  ]);

  logger.info("Default plans created");
}
