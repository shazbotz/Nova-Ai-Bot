export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
  };
  colorScheme: "light" | "dark";
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
  };
  ready(): void;
  expand(): void;
  close(): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
  MainButton: {
    text: string;
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
  };
}

declare global {
  interface Window {
    Telegram: { WebApp: TelegramWebApp };
  }
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: Date;
  model?: string;
}

export interface UserData {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  isAdmin: boolean;
  preferences: {
    preferredModel?: string;
    preferredProvider?: string;
    systemPrompt?: string;
    language?: string;
  };
  stats: {
    totalMessages: number;
    filesProcessed: number;
    joinedAt: string;
    lastActiveAt: string;
  };
  subscription: {
    planName: string;
    creditsRemaining: number;
    creditsTotal: number;
    periodEnd: string;
    autoRenew: boolean;
  };
}

export interface CreditInfo {
  allowed: boolean;
  creditsRemaining: number;
  creditsTotal: number;
  planName: string;
  isUnlimited: boolean;
  isLow: boolean;
}

export interface Plan {
  _id: string;
  name: string;
  description: string;
  messagesPerMonth: number;
  price: number;
  currency: string;
  features: string[];
  color: string;
}

export interface Provider {
  slug: string;
  name: string;
  enabled: boolean;
  models: string[];
  defaultModel: string;
}
