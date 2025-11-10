FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy package files
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/routing-dsl/package.json ./packages/routing-dsl/
COPY packages/sdk/package.json ./packages/sdk/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build application
FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma client
WORKDIR /app/apps/api
RUN pnpm exec prisma generate

# Build API
RUN pnpm build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 api

# Copy built application
COPY --from=builder --chown=api:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=api:nodejs /app/apps/api/node_modules ./node_modules
COPY --from=builder --chown=api:nodejs /app/apps/api/package.json ./
COPY --from=builder --chown=api:nodejs /app/apps/api/prisma ./prisma
COPY --from=builder --chown=api:nodejs /app/node_modules ./node_modules

USER api

EXPOSE 3001

ENV PORT=3001
ENV HOST=0.0.0.0

CMD ["node", "dist/index.js"]

