FROM node:20-alpine AS base
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace configs
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml .npmrc ./

# Copy package.json for all packages
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/routing-dsl/package.json ./packages/routing-dsl/

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
COPY --from=deps /app/node_modules ./node_modules

# Copy ALL source code
COPY . .

# Permanently apply the shared browser-phone ringback and RFC2833 DTMF repair.
# The script is idempotent and fails the image build if expected source blocks drift.
RUN node /app/scripts/apply-softphone-ringback-dtmf-source.mjs \
  /app/apps/web/src/components/phone/phone-provider.tsx

# Permanently expose the actual campaign routing contract in the UI: an external
# cell number or a registered four-digit Hopwhistle extension, with same-priority
# destinations ringing together and lower priorities acting as failover steps.
RUN node /app/scripts/apply-campaign-routing-ui-source.mjs \
  '/app/apps/web/src/app/(dashboard)/campaigns/[id]/page.tsx'

# Build the workspace packages the web build resolves at bundle time.
#
# apps/web has no tsup config, so unlike api/worker/dialer-v2 it gets no
# `noExternal` bundling of @hopwhistle/*: Next resolves those imports through
# node_modules like any other dependency. `@hopwhistle/shared` used to export
# ./src/index.ts — checked-in source, always on disk — so nothing had to be
# built first. It now exports ./dist/index.js, which exists only after a build,
# and `dist` is gitignored, so a clean checkout has none.
#
# Without this step `next build` fails with
# `Module not found: Can't resolve '@hopwhistle/shared'` across every consumer.
# It survived locally only on machines that happened to have built the packages
# already, and `COPY . .` above carried that stale dist into the image.
#
# `shared` is the only one built here, deliberately. It is the sole package web
# imports for values (25 call sites). `@hopwhistle/sdk` is declared in
# apps/web/package.json but imported nowhere in src, and the single
# `@hopwhistle/routing-dsl` reference is an erased `import type` with no
# node_modules link to resolve through — building either would be inert.
# See the PR for both, they want fixing on their own terms, not here.
# Globbed, not named: a package added later needs building too, and the failure
# mode for forgetting is a suite or a runtime import that quietly breaks. This
# stage has the source, so it does the real build the deps stage skipped.
RUN pnpm --filter "./packages/*" exec tsup --no-dts

WORKDIR /app/apps/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Install dependencies
# --ignore-scripts for the same reason as the deps stage above: this must not
# trigger the workspace packages' prepare hook mid-build.
RUN pnpm add --ignore-scripts next @xyflow/react next-themes html2canvas react-markdown @tailwindcss/typography

# Config is now in next.config.js

# Remove test files that might cause issues
RUN rm -f playwright.config.ts
RUN rm -rf e2e

# Build-time environment variables for Next.js
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ARG NEXT_PUBLIC_API_KEY=demo-key
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
ENV NEXT_PUBLIC_API_KEY=${NEXT_PUBLIC_API_KEY}

# Run build
RUN pnpm exec next build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "apps/web/server.js"]
