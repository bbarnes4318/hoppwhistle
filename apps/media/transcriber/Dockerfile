FROM node:20-slim

# Install tini for proper signal handling
RUN apt-get update && \
    apt-get install -y tini && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Build
RUN npm run build

# Create non-root user
RUN useradd -m -u 1000 transcriber && \
    chown -R transcriber:transcriber /app

USER transcriber

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]

