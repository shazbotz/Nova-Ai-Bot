import mongoose, { Schema, Document } from "mongoose";

export interface IMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  model?: string;
}

export interface IUser extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isBlocked: boolean;
  isAdmin: boolean;
  preferences: {
    preferredModel?: string | null;
    preferredProvider?: string | null;
    language?: string;
    systemPrompt?: string;
    maxContext?: number;
  };
  stats: {
    totalMessages: number;
    totalTokensUsed: number;
    filesProcessed: number;
    joinedAt: Date;
    lastActiveAt: Date;
  };
  subscription: {
    planId?: mongoose.Types.ObjectId;
    planName: string;
    creditsRemaining: number;
    creditsTotal: number;
    periodStart: Date;
    periodEnd: Date;
    autoRenew: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface IPlan extends Document {
  name: string;
  description: string;
  messagesPerMonth: number;
  price: number;
  currency: string;
  features: string[];
  isDefault: boolean;
  isActive: boolean;
  color: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IConversation extends Document {
  userId: number;
  messages: IMessage[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ISystemLog extends Document {
  level: "info" | "warn" | "error";
  message: string;
  meta?: Record<string, unknown>;
  timestamp: Date;
}

export interface IAIProvider extends Document {
  name: string;
  slug: string;
  enabled: boolean;
  priority: number;
  models: string[];
  defaultModel: string;
  stats: {
    totalRequests: number;
    totalErrors: number;
    lastUsedAt?: Date;
    lastErrorAt?: Date;
    lastError?: string;
  };
  rateLimit: {
    requestsPerMinute: number;
    currentCount: number;
    resetAt: Date;
  };
}

const MessageSchema = new Schema<IMessage>({
  role: { type: String, enum: ["user", "assistant", "system"], required: true },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  model: String,
});

const PlanSchema = new Schema<IPlan>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    messagesPerMonth: { type: Number, required: true },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    features: [String],
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    color: { type: String, default: "#7c3aed" },
  },
  { timestamps: true }
);

const UserSchema = new Schema<IUser>(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,
    isBlocked: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    preferences: {
      preferredModel: { type: String, default: null },
      preferredProvider: { type: String, default: null },
      language: { type: String, default: "en" },
      systemPrompt: String,
      maxContext: { type: Number, default: 20 },
    },
    stats: {
      totalMessages: { type: Number, default: 0 },
      totalTokensUsed: { type: Number, default: 0 },
      filesProcessed: { type: Number, default: 0 },
      joinedAt: { type: Date, default: Date.now },
      lastActiveAt: { type: Date, default: Date.now },
    },
    subscription: {
      planId: { type: Schema.Types.ObjectId, ref: "Plan" },
      planName: { type: String, default: "Free" },
      creditsRemaining: { type: Number, default: 50 },
      creditsTotal: { type: Number, default: 50 },
      periodStart: { type: Date, default: Date.now },
      periodEnd: {
        type: Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      autoRenew: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const ConversationSchema = new Schema<IConversation>(
  {
    userId: { type: Number, required: true, index: true },
    messages: [MessageSchema],
  },
  { timestamps: true }
);

const SystemLogSchema = new Schema<ISystemLog>({
  level: { type: String, enum: ["info", "warn", "error"], required: true },
  message: { type: String, required: true },
  meta: Schema.Types.Mixed,
  timestamp: { type: Date, default: Date.now, index: true },
});

const AIProviderSchema = new Schema<IAIProvider>(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 10 },
    models: [String],
    defaultModel: { type: String, required: true },
    stats: {
      totalRequests: { type: Number, default: 0 },
      totalErrors: { type: Number, default: 0 },
      lastUsedAt: Date,
      lastErrorAt: Date,
      lastError: String,
    },
    rateLimit: {
      requestsPerMinute: { type: Number, default: 60 },
      currentCount: { type: Number, default: 0 },
      resetAt: { type: Date, default: Date.now },
    },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
export const Plan = mongoose.model<IPlan>("Plan", PlanSchema);
export const Conversation = mongoose.model<IConversation>("Conversation", ConversationSchema);
export const SystemLog = mongoose.model<ISystemLog>("SystemLog", SystemLogSchema);
export const AIProvider = mongoose.model<IAIProvider>("AIProvider", AIProviderSchema);
