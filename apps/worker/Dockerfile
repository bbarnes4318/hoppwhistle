FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
COPY packages/routing-dsl/package.json ./packages/routing-dsl/
COPY packages/sdk/package.json ./packages/sdk/

RUN pnpm install --no-frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# --- FIX: Copy ALL source code ---
COPY . .

RUN pnpm install --no-frozen-lockfile

# Build workspace dependencies
RUN pnpm --filter @hopwhistle/shared build
RUN pnpm --filter @hopwhistle/routing-dsl build
RUN pnpm --filter @hopwhistle/sdk build

WORKDIR /app/apps/worker

RUN pnpm add -D tsup typescript

RUN pnpm build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/worker/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/worker/package.json ./package.json

USER nextjs

CMD ["node", "dist/index.js"]
