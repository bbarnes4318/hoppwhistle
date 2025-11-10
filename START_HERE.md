# 🚀 Quick Start Guide - Hopwhistle

Follow these steps to get the app running locally.

## Prerequisites

Make sure you have installed:

- **Node.js** >= 18.0.0 ([Download](https://nodejs.org/))
- **pnpm** >= 8.0.0 (install with: `npm install -g pnpm`)
- **PostgreSQL** (or Docker for running PostgreSQL)
- **Redis** (or Docker for running Redis)

## Step 1: Install Dependencies

```powershell
pnpm install
```

## Step 2: Set Up Environment Files

Copy the example environment files:

```powershell
Copy-Item apps/api/env.example apps/api/.env
Copy-Item apps/web/env.example apps/web/.env
```

Or run the setup script:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

## Step 3: Configure Environment Variables

Edit `apps/api/.env` and make sure these are set:

```env
# Required for the app to work
DATABASE_URL=postgresql://hopwhistle:hopwhistle_dev@localhost:5432/hopwhistle
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-change-in-production-use-random-string-here
```

**Important:** Change `JWT_SECRET` to a random string! You can generate one with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 4: Start Database Services

### Option A: Using Docker (Recommended)

If you have Docker installed:

```powershell
# Start PostgreSQL and Redis
docker-compose -f infra/docker/docker-compose.yml up -d postgres redis

# Or start all services
docker-compose -f infra/docker/docker-compose.yml up -d
```

### Option B: Install Locally

- **PostgreSQL**: Install and create database `hopwhistle` with user `hopwhistle`
- **Redis**: Install and start Redis server

## Step 5: Set Up Database

```powershell
# Generate Prisma client
pnpm --filter @hopwhistle/api db:generate

# Run database migrations
pnpm db:migrate

# Seed database with initial data (optional)
pnpm db:seed
```

## Step 6: Start the Application

### Start All Apps (API + Web)

```powershell
pnpm dev
```

This will start:

- **API Server** on http://localhost:3001
- **Web App** on http://localhost:3000

### Or Start Individually

```powershell
# Start API server only
pnpm --filter @hopwhistle/api dev

# Start web app only (in another terminal)
pnpm --filter @hopwhistle/web dev
```

## Step 7: View the Application

Once started, open your browser:

- **Web App**: http://localhost:3000
- **API Docs**: http://localhost:3001/docs
- **API Health**: http://localhost:3001/health

## Troubleshooting

### Database Connection Error

If you see database connection errors:

1. Make sure PostgreSQL is running
2. Check `DATABASE_URL` in `apps/api/.env`
3. Verify database exists: `psql -U hopwhistle -d hopwhistle`

### Redis Connection Error

If you see Redis errors:

1. Make sure Redis is running: `redis-cli ping` (should return `PONG`)
2. Check `REDIS_URL` in `apps/api/.env`

### Port Already in Use

If ports 3000 or 3001 are already in use:

- Change `PORT` in `apps/api/.env` (for API)
- Change port in `apps/web/package.json` dev script (for web)

### Migration Errors

If migrations fail:

```powershell
# Reset database (WARNING: deletes all data)
pnpm --filter @hopwhistle/api db:migrate:reset

# Then run migrations again
pnpm db:migrate
```

## Quick Commands Reference

```powershell
# Install dependencies
pnpm install

# Start all apps
pnpm dev

# Start API only
pnpm --filter @hopwhistle/api dev

# Start web only
pnpm --filter @hopwhistle/web dev

# Run database migrations
pnpm db:migrate

# Seed database
pnpm db:seed

# View database in Prisma Studio
pnpm --filter @hopwhistle/api db:studio

# Build everything
pnpm build

# Run tests
pnpm test
```

## Next Steps

1. **Login**: Navigate to http://localhost:3000/login
2. **Explore**: Check out the dashboard, calls, campaigns, etc.
3. **API Docs**: Visit http://localhost:3001/docs for API documentation

## Need Help?

- Check the [README.md](README.md) for more details
- Review [docs/SECURITY.md](docs/SECURITY.md) for security features
- Check [QUICKSTART.md](QUICKSTART.md) for detailed setup
