FROM node:20-alpine

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json ./
COPY tsconfig.json ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY src ./src

# Build TypeScript
RUN pnpm build

# Create required directories
RUN mkdir -p logs uploads

# Expose admin panel port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:5000/health || exit 1

# Start the bot
CMD ["node", "dist/index.js"]
