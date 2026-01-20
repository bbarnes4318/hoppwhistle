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

# Install all dependencies
RUN pnpm install --filter @callfabric/transcriber...

# Install tsx globally so it's always available
RUN npm install -g tsx

# Copy source
COPY apps/media/transcriber ./apps/media/transcriber
COPY packages/shared ./packages/shared

# Create non-root user
RUN useradd -m -u 1001 transcriber && \
    chown -R transcriber:transcriber /app

USER transcriber

# Stay in /app where node_modules exists, run tsx with full path
WORKDIR /app

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["tsx", "apps/media/transcriber/src/index.ts"]
