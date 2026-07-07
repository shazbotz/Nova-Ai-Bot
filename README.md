# Nova AI Bot

An advanced AI assistant Telegram bot with multi-provider AI routing, MongoDB memory, file processing, an admin dashboard, and a companion Telegram Mini App frontend.

## Structure

This is a monorepo with two independently deployable projects:

```
.
├── telegram-bot/    # Node.js/TypeScript bot backend (deploy to Koyeb/Docker)
└── mini-app/        # React/Vite Telegram Mini App frontend
```

## Projects

### [`telegram-bot/`](./telegram-bot)
The core bot service — multi-provider AI router (OpenAI, Anthropic, Gemini, Groq), MongoDB-backed conversation memory, file processing, and an admin dashboard.
See [`telegram-bot/README.md`](./telegram-bot/README.md) for setup and deployment instructions.

### [`mini-app/`](./mini-app)
The Telegram Mini App frontend — chat interface, plans, and settings pages built with React + Vite.

## Quick Start

```bash
# Bot backend
cd telegram-bot
pnpm install
cp .env.example .env   # fill in your keys
pnpm dev

# Mini app frontend
cd mini-app
npm install
npm run dev
```

## License

Apache-2.0 — see [LICENSE](./LICENSE)
