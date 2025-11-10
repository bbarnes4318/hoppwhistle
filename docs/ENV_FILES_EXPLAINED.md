# Environment Files Explained

This document explains why there are multiple `.env` files and where each one belongs.

## Why Multiple .env Files?

Different parts of the application run in different contexts and need different environment variables:

1. **Node.js Applications** (API, Web, Worker, Media) - Run as separate processes
2. **Docker Compose Stacks** - Run containers with their own environment

## File Locations and Purposes

### Application-Level .env Files

These are for Node.js applications that run directly (not in Docker):

- **`apps/api/env.example`** → Copy to `apps/api/.env`
  - Used by: API server (runs with `pnpm dev` or `node dist/index.js`)
  - Contains: `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`, `S3_ENDPOINT`, etc.
  - Purpose: Database connections, API keys, service URLs

- **`apps/web/env.example`** → Copy to `apps/web/.env.local`
  - Used by: Next.js web app (runs with `pnpm dev`)
  - Contains: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`
  - Purpose: Client-side API endpoints (must have `NEXT_PUBLIC_` prefix)

- **`apps/worker/env.example`** → Copy to `apps/worker/.env`
  - Used by: Worker service (runs with `pnpm dev` or `node dist/index.js`)
  - Contains: `DATABASE_URL`, `REDIS_URL`, job queue configs
  - Purpose: Background job processing

- **`apps/media/env.example`** → Copy to `apps/media/.env`
  - Used by: Media transcriber service
  - Contains: Transcription API keys, S3 configs
  - Purpose: Audio/video processing

### Docker Compose .env Files

These are for Docker Compose stacks:

- **`infra/docker/env.example`** → Copy to `infra/docker/.env`
  - Used by: Main application stack (`docker-compose.yml`)
  - Contains: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ROOT_PASSWORD`
  - Purpose: Database, Redis, MinIO credentials for containers
  - Used with: `docker compose -f infra/docker/docker-compose.yml up`

- **`infra/docker/env.voice.example`** → Copy to `infra/docker/.env.voice`
  - Used by: Voice stack (`docker-compose.voice.yml`)
  - Contains: `PUBLIC_IP`, `SBC_DOMAIN`, `SIGNALWIRE_SIP_PASSWORD`, etc.
  - Purpose: Kamailio, FreeSWITCH, RTPEngine configuration
  - Used with: `docker compose --env-file infra/docker/.env.voice -f infra/docker/docker-compose.voice.yml up`

## Why Separate Voice Stack .env?

The voice stack (Kamailio, FreeSWITCH, RTPEngine) runs **independently** from the main application:

- It can run on a **different server** (edge location)
- It needs **different credentials** (SIP trunk passwords, public IPs)
- It's deployed **separately** (voice infrastructure vs application infrastructure)

That's why it has its own `.env.voice` file in the same directory as its docker-compose file.

## Quick Setup Guide

### For Local Development (Everything Together)

1. **Main App Stack:**

   ```powershell
   Copy-Item "infra\docker\env.example" "infra\docker\.env"
   # Edit infra/docker/.env with your values
   ```

2. **API Service:**

   ```powershell
   Copy-Item "apps\api\env.example" "apps\api\.env"
   # Edit apps/api/.env with your values
   ```

3. **Web App:**

   ```powershell
   Copy-Item "apps\web\env.example" "apps\web\.env.local"
   # Edit apps/web/.env.local with your values
   ```

4. **Voice Stack (if needed):**
   ```powershell
   Copy-Item "infra\docker\env.voice.example" "infra\docker\.env.voice"
   # Edit infra/docker/.env.voice with your values
   ```

### For Production

- Each service gets its own `.env` file with production values
- Voice stack `.env.voice` goes on the voice server
- Application `.env` files go on the application server(s)
- Never commit `.env` files to git (they're in `.gitignore`)

## Summary

| File                      | Purpose              | Used By                  |
| ------------------------- | -------------------- | ------------------------ |
| `apps/api/.env`           | API server config    | Node.js API process      |
| `apps/web/.env.local`     | Web app config       | Next.js dev server       |
| `apps/worker/.env`        | Worker config        | Node.js worker process   |
| `apps/media/.env`         | Media service config | Node.js media process    |
| `infra/docker/.env`       | Main Docker stack    | docker-compose.yml       |
| `infra/docker/.env.voice` | Voice Docker stack   | docker-compose.voice.yml |

**Rule of thumb:** If it's a Docker Compose file, the `.env` goes in the same directory. If it's a Node.js app, the `.env` goes in the app's directory.
