# Quick Start Guide

## Prerequisites Installation

### Install pnpm

```bash
npm install -g pnpm
```

### Verify Versions

```bash
node --version  # Should be >= 18.0.0
pnpm --version   # Should be >= 8.0.0
```

## Initial Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Setup Environment Files

Copy the example environment files:

```bash
# On Linux/Mac
cp apps/api/env.example apps/api/.env
cp apps/worker/env.example apps/worker/.env
cp apps/web/env.example apps/web/.env
cp apps/media/env.example apps/media/.env

# On Windows (PowerShell)
Copy-Item apps/api/env.example apps/api/.env
Copy-Item apps/worker/env.example apps/worker/.env
Copy-Item apps/web/env.example apps/web/.env
Copy-Item apps/media/env.example apps/media/.env
```

Or use the setup script:

```bash
# Linux/Mac
bash scripts/setup.sh

# Windows
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

### 3. Review Environment Variables

Edit the `.env` files in each app directory and update with your configuration.

### 4. Start Docker Services (Optional)

```bash
make docker-up
# or
docker-compose -f infra/docker/docker-compose.yml up -d
```

## Development Commands

### Start All Apps

```bash
pnpm dev
```

### Start Individual Apps

```bash
# API server (port 3001)
pnpm --filter @callfabric/api dev

# Web app (port 3000)
pnpm --filter @callfabric/web dev

# Worker
pnpm --filter @callfabric/worker dev
```

### Build Everything

```bash
pnpm build
```

### Run Tests

```bash
# All tests
pnpm test

# Specific package/app
pnpm --filter @callfabric/api test
pnpm --filter @callfabric/web test
```

### Linting & Formatting

```bash
# Lint all
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format code
pnpm format
```

## Verify Installation

### 1. Check Workspace Structure

```bash
pnpm list --depth=0
```

### 2. Build All Packages

```bash
pnpm build
```

### 3. Run Type Checking

```bash
pnpm typecheck
```

### 4. Test API Health Endpoint

After starting the API:

```bash
curl http://localhost:3001/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "callfabric-api"
}
```

## Common Issues

### pnpm not found

Install pnpm globally:

```bash
npm install -g pnpm
```

### Port already in use

Change ports in `.env` files or stop conflicting services.

### Docker services not starting

Ensure Docker is running and ports are available.

### TypeScript errors

Run `pnpm install` again to ensure all dependencies are linked correctly.

## Next Steps

1. Review the [README.md](./README.md) for detailed documentation
2. Check [FILE_TREE.md](./FILE_TREE.md) for project structure
3. Explore the `apps/` and `packages/` directories
4. Customize configuration files for your needs
5. Start building your features!
