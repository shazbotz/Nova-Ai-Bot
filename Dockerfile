# ──────────────────────────────────────────────────────────────────────────
# Single-service build: Telegram Bot + API + Admin Dashboard + Mini App
#
# This Dockerfile must be built with the REPO ROOT as its build context
# (not a subdirectory), since it needs to see both telegram-bot/ and
# mini-app/. On Koyeb: do NOT set a "Work directory" for this service —
# leave it at the repo root, and set the Dockerfile location to
# "Dockerfile" (this file).
# ──────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the Mini App (static React/Vite build) ──────────────────
FROM node:20-alpine AS miniapp-build
WORKDIR /build/mini-app
COPY mini-app/package.json ./
RUN npm install
COPY mini-app/ ./
RUN npm run build
# Produces /build/mini-app/dist


# ── Stage 2: build the Telegram Bot (TypeScript -> JS) ──────────────────────
FROM node:20-alpine AS bot-build
# Native module build deps (kept from the original bot Dockerfile so any
# native dependency in package.json still compiles cleanly)
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev
WORKDIR /build/telegram-bot
RUN npm install -g pnpm
COPY telegram-bot/package.json ./
COPY telegram-bot/tsconfig.json ./
RUN pnpm install --no-frozen-lockfile
COPY telegram-bot/src ./src
RUN pnpm build
# Produces /build/telegram-bot/dist


# ── Stage 3: runtime image ──────────────────────────────────────────────────
FROM node:20-alpine AS runtime
RUN npm install -g pnpm

# Install only production dependencies for the bot
WORKDIR /app/telegram-bot
COPY telegram-bot/package.json ./
RUN pnpm install --prod --no-frozen-lockfile

# Compiled bot code
COPY --from=bot-build /build/telegram-bot/dist ./dist

# Built Mini App static files — must land at /app/mini-app/dist so that
# telegram-bot/src/admin/server.ts's relative path
# (path.join(__dirname, "../../../mini-app/dist")) resolves correctly from
# /app/telegram-bot/dist/admin/server.js.
WORKDIR /app
COPY --from=miniapp-build /build/mini-app/dist ./mini-app/dist

WORKDIR /app/telegram-bot
RUN mkdir -p logs uploads

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["node", "dist/index.js"]
