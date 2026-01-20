FROM node:20-slim

# Install tini for proper signal handling
RUN apt-get update && \
    apt-get install -y tini && \
    rm -rf /var/lib/apt/lists/*

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/media/transcriber/package.json ./apps/media/transcriber/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @callfabric/transcriber...

# Copy source
COPY apps/media/transcriber ./apps/media/transcriber
COPY packages/shared ./packages/shared

# Build with tsc directly
RUN cd apps/media/transcriber && npx tsc

# Create non-root user
RUN useradd -m -u 1001 transcriber && \
    chown -R transcriber:transcriber /app

USER transcriber

WORKDIR /app/apps/media/transcriber

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
