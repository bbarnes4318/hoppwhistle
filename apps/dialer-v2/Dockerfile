FROM node:20-alpine AS base

FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

COPY . .
# --ignore-scripts here too: the workspace packages' "prepare": "tsup" hook
# would build them with type declarations, which the explicit --no-dts build
# below deliberately skips for image size and speed. Keeping the hook out of
# image builds leaves their behaviour exactly as it was.
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Generate the Prisma client BEFORE the build.
#
# `@prisma/client` is a production dependency of this service and is left
# external by tsup, so the artifact loads it from node_modules at runtime rather
# than carrying an inlined copy. That copy has to exist, and it only exists after
# generation: `@prisma/client/default.js` re-exports `.prisma/client/default`,
# which is an output directory rather than a package.
#
# Without this line the build fails with `Could not resolve ".prisma/client/default"`
# — which is exactly how it failed, because nothing here generated it and nothing
# in CI built the package at all.
RUN pnpm --filter @hopwhistle/api exec prisma generate

# Build the one workspace dependency this service uses.
# Globbed, not named: a package added later needs building too, and the failure
# mode for forgetting is a suite or a runtime import that quietly breaks. This
# stage has the source, so it does the real build the deps stage skipped.
RUN pnpm --filter "./packages/*" exec tsup --no-dts
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
# Carries both `@prisma/client` and the generated `.prisma/client` beside it.
# The artifact resolves the client from here at runtime; a runner stage without
# it starts and then fails readiness with "the generated Prisma client is
# missing" rather than crashing on an unresolved import.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/dialer-v2/package.json ./package.json

USER nodeapp

EXPOSE 9092

# Liveness only — readiness is a separate endpoint, because this service must
# stay up while correctly refusing to dial.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9092/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
