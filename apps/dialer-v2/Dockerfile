FROM node:20-alpine AS base

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

COPY . .
RUN pnpm install --no-frozen-lockfile

# Build the one workspace dependency this service uses.
RUN pnpm --filter @hopwhistle/shared exec tsup --no-dts
RUN rm -rf node_modules/@hopwhistle/shared && \
    mkdir -p node_modules/@hopwhistle/shared && \
    cp -r packages/shared/dist node_modules/@hopwhistle/shared/ && \
    cp packages/shared/package.json node_modules/@hopwhistle/shared/

WORKDIR /app/apps/dialer-v2
RUN pnpm build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nodeapp

COPY --from=builder /app/apps/dialer-v2/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/dialer-v2/package.json ./package.json

USER nodeapp

EXPOSE 9092

# Liveness only — readiness is a separate endpoint, because this service must
# stay up while correctly refusing to dial.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9092/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
