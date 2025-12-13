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
RUN pnpm install --no-frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy node_modules from deps
COPY --from=deps /app/node_modules ./node_modules

# Copy ALL source code
COPY . .

WORKDIR /app/apps/web

ENV NEXT_TELEMETRY_DISABLED=1
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
# Install dependencies
RUN pnpm add next @xyflow/react next-themes html2canvas react-markdown @tailwindcss/typography

# Config is now in next.config.js

# Remove test files that might cause issues
RUN rm -f playwright.config.ts
RUN rm -rf e2e

# Build-time environment variables for Next.js
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Run build
RUN pnpm exec next build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

CMD ["node", "apps/web/server.js"]
