FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build application
FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

WORKDIR /app/apps/worker

# Build worker
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

# Copy built application
COPY --from=builder --chown=worker:nodejs /app/apps/worker/dist ./dist
COPY --from=builder --chown=worker:nodejs /app/apps/worker/node_modules ./node_modules
COPY --from=builder --chown=worker:nodejs /app/apps/worker/package.json ./
COPY --from=builder --chown=worker:nodejs /app/node_modules ./node_modules

USER worker

EXPOSE 9091

ENV PORT=9091

CMD ["node", "dist/index.js"]

