# Nova AI Bot

An advanced AI assistant Telegram bot with multi-provider AI routing, MongoDB memory, file processing, an admin dashboard, and a companion Telegram Mini App frontend.

## Structure

This is a monorepo, but it deploys as a **single service**: `telegram-bot` serves the bot, the API, the admin dashboard, *and* the built Mini App (at `/app`) all from one Node process.

```
.
├── Dockerfile          # multi-stage build: builds mini-app, then telegram-bot, into one image
├── docker-compose.yml  # local single-service testing
├── koyeb.yaml          # single Koyeb service config
├── telegram-bot/       # Node.js/TypeScript backend (bot + API + admin dashboard)
└── mini-app/           # React/Vite Telegram Mini App frontend (served at /app in production)
```

## Projects

### [`telegram-bot/`](./telegram-bot)
The core bot service — multi-provider AI router (OpenAI, Anthropic, Gemini, Groq), MongoDB-backed conversation memory, file processing, and an admin dashboard. In production, it also serves the built Mini App as static files at `/app`.
See [`telegram-bot/README.md`](./telegram-bot/README.md) for backend-specific setup details.

### [`mini-app/`](./mini-app)
The Telegram Mini App frontend — chat interface, plans, and settings pages built with React + Vite. Built with `base: "/app/"` so it works correctly when served from the bot's `/app` route rather than a domain root.

## Local Development

In dev, the two run as separate processes (Vite's dev server + the bot's API), wired together by Vite's `/api` proxy:

```bash
# Bot backend
cd telegram-bot
pnpm install
cp .env.example .env   # fill in your keys
pnpm dev

# Mini app frontend (separate terminal)
cd mini-app
npm install
npm run dev
```

## Production Deployment (single Koyeb service)

Everything ships as one Docker image built from the **root** `Dockerfile`, which builds the Mini App first, then the bot, and combines them so the bot serves both.

1. On Koyeb, create a Web Service from this GitHub repo.
2. **Do not set a Work directory** — leave it at the repo root, so the build can see both `telegram-bot/` and `mini-app/`.
3. Choose the **Dockerfile** builder; Dockerfile location: `Dockerfile` (repo root).
4. Set the environment variables from `telegram-bot/.env.example`.
5. Deploy. Once you have your Koyeb service URL, set `MINI_APP_URL` to `https://<your-service>.koyeb.app/app` and redeploy so Telegram's "Open AI Chat" buttons point at the Mini App.

To test the exact same build locally:
```bash
docker compose up --build
```

## License

Apache-2.0 — see [LICENSE](./LICENSE)

