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
RUN pnpm --filter @hopwhistle/shared exec tsup --no-dts
RUN pnpm --filter @hopwhistle/routing-dsl exec tsup --no-dts
RUN pnpm --filter @hopwhistle/sdk exec tsup --no-dts

# FIX: Ensure built artifacts are in node_modules
RUN rm -rf node_modules/@hopwhistle/shared && \
    mkdir -p node_modules/@hopwhistle/shared && \
    cp -r packages/shared/dist node_modules/@hopwhistle/shared/ && \
    cp packages/shared/package.json node_modules/@hopwhistle/shared/

RUN rm -rf node_modules/@hopwhistle/routing-dsl && \
    mkdir -p node_modules/@hopwhistle/routing-dsl && \
    cp -r packages/routing-dsl/dist node_modules/@hopwhistle/routing-dsl/ && \
    cp packages/routing-dsl/package.json node_modules/@hopwhistle/routing-dsl/

RUN rm -rf node_modules/@hopwhistle/sdk && \
    mkdir -p node_modules/@hopwhistle/sdk && \
    cp -r packages/sdk/dist node_modules/@hopwhistle/sdk/ && \
    cp packages/sdk/package.json node_modules/@hopwhistle/sdk/

WORKDIR /app/apps/worker



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
