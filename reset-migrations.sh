#!/bin/bash
set -e

echo "=== Resetting Database Migrations ==="

# 1. Pull latest code
echo "1. Pulling latest code..."
git pull origin master

# 2. Stop API
echo "2. Stopping API..."
docker stop hopwhistle-api || true
docker rm hopwhistle-api || true

# 3. Reset the database migration state
echo "3. Resetting database migration state..."
docker run --rm \
  --network docker_default \
  --env-file .env \
  -v $(pwd)/apps/api/prisma:/app/prisma \
  -w /app \
  node:20-alpine \
  sh -c "npm install -g prisma@6.19.0 && prisma migrate resolve --rolled-back 20240101000000_add_transcripts || true && prisma migrate resolve --rolled-back 20240102000000_add_accrual_ledger || true && prisma migrate resolve --rolled-back 20240103000000_add_compliance || true && prisma migrate resolve --rolled-back 20240104000000_add_stir_shaken_cnam_carrier || true"

# 4. Drop and recreate the database schema (WARNING: THIS WILL DELETE ALL DATA)
echo "4. Resetting database schema..."
docker run --rm \
  --network docker_default \
  --env-file .env \
  -v $(pwd)/apps/api/prisma:/app/prisma \
  -w /app \
  node:20-alpine \
  sh -c "npm install -g prisma@6.19.0 && prisma migrate reset --force --skip-seed"

# 5. Rebuild API
echo "5. Rebuilding API..."
docker-compose --env-file .env \
  -f infra/docker/docker-compose.yml \
  -f infra/docker/docker-compose.prod.yml \
  -f infra/docker/docker-compose.voice.yml \
  build --no-cache api

# 6. Start API
echo "6. Starting API..."
docker run -d \
  --name hopwhistle-api \
  --network docker_default \
  --env-file .env \
  -p 3001:3001 \
  docker_api:latest

# 7. Wait for API to be ready
echo "7. Waiting for API to start..."
sleep 5

# 8. Check API logs
echo "8. Checking API logs..."
docker logs hopwhistle-api --tail 30

# 9. Restart worker
echo "9. Restarting worker..."
docker restart hopwhistle-worker
sleep 3
docker logs hopwhistle-worker --tail 30

echo "=== Migration Reset Complete ==="
