# 🤖 AI Assistant Telegram Bot

An advanced AI assistant Telegram bot with multi-provider AI routing, MongoDB memory, file processing, and an admin dashboard.

## Features

- **Multi-provider AI Router** — OpenAI, Anthropic, Gemini, Groq with automatic fallback
- **Conversation Memory** — MongoDB-backed per-user history
- **File Processing** — PDF, DOCX, TXT, code files (up to 50MB)
- **Admin Dashboard** — Web UI for managing users, providers, and logs
- **Rate Limit Handling** — Auto-switches providers when limits hit
- **User Preferences** — Custom system prompts, preferred models

## Quick Start

### 1. Clone & install
```bash
git clone <your-repo>
cd telegram-bot
npm install -g pnpm
pnpm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your keys
```

### 3. Run in development
```bash
pnpm dev
```

### 4. Build & run in production
```bash
pnpm build
pnpm start
```

## Deployment

This backend is deployed together with `mini-app/` as a **single service** — see the root [README.md](../README.md#production-deployment-single-koyeb-service) for the actual Docker/Koyeb instructions (build context is the repo root, not this folder).

### Local Docker testing
From the **repo root** (not this folder):
```bash
cp telegram-bot/.env.example telegram-bot/.env
# Fill in your .env values, then:
docker compose up --build
```

### Heroku / other Node hosts
If deploying this backend alone (without the Mini App), it still works standalone as an API-less Telegram bot + admin dashboard:
```bash
heroku create your-bot-name
heroku config:set TELEGRAM_BOT_TOKEN=... MONGODB_URI=... ADMIN_TELEGRAM_ID=...
git push heroku main
```

### Replit
1. Import repo into Replit
2. Add secrets in the Secrets panel
3. Run `pnpm dev`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | ✅ | From @BotFather |
| `MONGODB_URI` | ✅ | MongoDB connection string |
| `ADMIN_TELEGRAM_ID` | ✅ | Your Telegram numeric ID |
| `MINI_APP_URL` | Recommended | Set to `https://<your-service>.koyeb.app/app` once deployed (same service serves both) |
| `OPENAI_API_KEY` | ⚡ | OpenAI API key |
| `ANTHROPIC_API_KEY` | ⚡ | Anthropic API key |
| `GEMINI_API_KEY` | ⚡ | Google Gemini API key |
| `GROQ_API_KEY` | ⚡ | Groq API key (free tier) |
| `ADMIN_USERNAME` | Optional | Dashboard username (default: admin) |
| `ADMIN_PASSWORD` | Optional | Dashboard password (default: admin123 — change this) |
| `SESSION_SECRET` | Optional | Session secret for dashboard (change from the default) |
| `ADMIN_PORT` | Optional | Dashboard port (default: 5000) |

⚡ = At least one AI provider key required

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/help` | All commands |
| `/clear` | Clear conversation memory |
| `/stats` | Your usage statistics |
| `/model` | Choose preferred AI model |
| `/prompt [text]` | Set custom system prompt |
| `/status` | AI provider health status |
| `/about` | About the bot |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin` | Admin panel info |
| `/broadcast [msg]` | Send to all users |
| `/block [user_id]` | Block a user |
| `/unblock [user_id]` | Unblock a user |
| `/setpriority [provider] [n]` | Set provider priority |

## Admin Dashboard

Access at `http://localhost:5000/admin`

Default credentials: `admin` / `admin123` (change in .env!)

## Supported File Types

- 📄 PDF documents
- 📝 Word documents (.docx, .doc)
- 📋 Text files (.txt, .md, .csv, .json, .yaml)
- 💻 Code files (.js, .ts, .py, .java, .cpp, .go, .rs, .php, and more)
- 🌐 Web files (.html, .css)

Max file size: 20MB (Telegram's cloud Bot API doesn't serve larger file downloads regardless of app-side config).

## Adding a New AI Provider

1. Create `src/ai/providers/yourProvider.ts` implementing `AIProviderInterface`
2. Register it in `src/ai/router.ts` in `PROVIDER_INSTANCES`
3. Add default config to `DEFAULT_PROVIDERS`
4. Add API key to `.env.example` and `config/index.ts`

## Architecture

```
src/
├── config/         # Configuration & env vars
├── ai/
│   ├── types.ts    # Shared interfaces
│   ├── router.ts   # AI routing & fallback logic
│   └── providers/  # One file per AI provider
├── bot/
│   ├── commands.ts      # Telegram command handlers
│   └── messageHandler.ts # Message & file routing
├── memory/
│   ├── database.ts  # MongoDB connection
│   ├── models.ts    # Mongoose schemas
│   └── userMemory.ts # Memory read/write helpers
├── files/
│   └── processor.ts  # File download & parsing
├── admin/
│   ├── server.ts    # Express app setup — also serves the built Mini App at /app
│   └── routes.ts    # Dashboard routes & HTML
├── utils/
│   └── logger.ts    # Winston logger
└── index.ts         # Entry point
```
