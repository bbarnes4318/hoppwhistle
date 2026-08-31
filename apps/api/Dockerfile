FROM node:20-alpine AS base
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN apk add --no-cache python3 py3-pandas py3-openpyxl

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace configs
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./

# Copy package.json for all packages
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/routing-dsl/package.json ./packages/routing-dsl/
COPY packages/sdk/package.json ./packages/sdk/

# Fix: Allow updating lockfile
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# --ignore-scripts: this stage copies package.json files only, no source. The
# workspace packages carry a "prepare": "tsup" hook, which would run here and
# fail with nothing to compile. The builder stage below has the source and
# builds them properly.
RUN pnpm install --no-frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy node_modules from deps
# Copy ALL source code
COPY . .

# Permanently enforce campaign routing that supports Hopwhistle extensions and
# external buyer/cell destinations in the same priority ring step. The script
# is idempotent and fails the image build if the expected source drifts.
RUN node /app/scripts/apply-campaign-mixed-destination-routing.mjs \
  /app/apps/api/src/services/routing.ts \
  /app/apps/api/src/routes/did-routes.ts

# --ignore-scripts here too: the workspace packages' "prepare": "tsup" hook
# would build them with type declarations, which the explicit --no-dts build
# below deliberately skips for image size and speed. Keeping the hook out of
# image builds leaves their behaviour exactly as it was.
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# Build workspace dependencies
# Globbed, not named: a package added later needs building too, and the failure
# mode for forgetting is a suite or a runtime import that quietly breaks. This
# stage has the source, so it does the real build the deps stage skipped.
RUN pnpm --filter "./packages/*" exec tsup --no-dts

# The three workspace packages used to be hand-copied into node_modules here,
# replacing pnpm's symlinks with dist-only directories. That was working around
# their package.json files pointing `main`/`exports` at ./src/index.ts, which
# does not exist in a built package. Those maps now point at ./dist/index.js,
# so pnpm's ordinary symlink resolves correctly and the copies are redundant.
#
# apps/api/tsup.config.ts sets noExternal: [/@hopwhistle\/.*/], so all three are
# inlined into dist/index.js and nothing resolves them at runtime anyway.

WORKDIR /app/apps/api

# --- FIX: Aggressive Patching to Unblock Build ---

# 1. Fix routes/index.ts pointing to wrong audit file location (Dynamic Import)
RUN sed -i "s|'../audit.js'|'../services/audit.js'|g" src/routes/index.ts || true

# 2. Fix other potential path errors
RUN sed -i "s|from '../lib/|from '../../lib/|g" src/services/provisioning/provisioning-service.ts || true
RUN sed -i "s|from '../../lib/|from '../../../lib/|g" src/services/provisioning/adapters/*.ts || true
# -------------------------------------------------

# Generate Prisma Client
RUN pnpm exec prisma generate

# Campaign routing is a production-critical call path. Refuse to build an API
# image unless pure-extension, pure-PSTN, mixed, priority, weight, DID-to-agent,
# and concurrency behavior all pass.
RUN pnpm exec vitest run \
  src/services/__tests__/routing-softphone-ring-group.test.ts \
  src/services/__tests__/routing-agent-did-translation.test.ts

# Install build tools


# Build ignoring type errors
RUN pnpm exec tsup --no-dts

# Production runner
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

# Chromium for the American Amicable carrier-application RPA (Puppeteer).
# The image skips Puppeteer's bundled download, so provide the system browser
# and point Puppeteer at it via PUPPETEER_EXECUTABLE_PATH.
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/package.json ./package.json
COPY --from=builder /app/docs ./docs
COPY --from=builder /app/apps/api/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

USER nextjs

EXPOSE 3001

CMD ["node", "dist/index.js"]
