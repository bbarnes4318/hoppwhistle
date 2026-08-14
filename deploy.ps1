# Hopwhistle Hetzner Deployment Script
# Execute this to pull changes, rebuild containers, and apply database scripts

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Hopwhistle Production Deployer (Hetzner)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$ip = "178.156.223.97"
$keyPath = "C:\Users\jimbo\.ssh\hetzner_pvn"

$remoteCommands = @(
    "cd /opt/hopwhistle",
    "echo '>>> Pulling latest code...'",
    "git fetch origin",
    "git checkout edit-campaign-buyer-fix",
    "git pull origin edit-campaign-buyer-fix",
    "echo '>>> Rebuilding containers...'",
    "docker compose --env-file .env -f infra/docker/docker-compose.dev.yml build api web freeswitch --no-cache",
    "echo '>>> Starting stack...'",
    "docker compose --env-file .env -f infra/docker/docker-compose.dev.yml up -d api web freeswitch",
    "echo '>>> Aligning database schema...'",
    # --accept-data-loss was removed here deliberately.
    #
    # This runs on EVERY deploy against live production. With the flag, Prisma
    # applies whatever diff it computes -- including dropping columns, tables and
    # indexes -- with no prompt, no reviewable artifact and no record of what it
    # did. Without it, db push REFUSES a destructive change and stops.
    #
    # The commands are joined with && , so a refusal halts the deploy. That is
    # the intended behaviour: a stopped deploy is recoverable, dropped call
    # records are not. If this step refuses, find out what it wants to drop
    # before doing anything else. Do not add the flag back.
    "docker exec -u root hopwhistle-api-dev npx prisma db push",
    "echo '>>> Verifying readiness...'",
    # /health/ready, NOT /health. /health returns {"status":"ok"} unconditionally
    # -- it never touches the database, so it cannot fail and verifies nothing.
    # An API with an unusable DATABASE_URL answers it perfectly while failing
    # every request that reads data. /health/ready queries PostgreSQL, Redis and
    # ClickHouse and returns a non-200 when a dependency is down, so --fail makes
    # a broken deploy exit non-zero here instead of looking successful.
    "curl -sS --fail-with-body http://localhost:3001/health/ready"
) -join " && "

Write-Host "1. Connecting to root@$ip using key $keyPath..." -ForegroundColor Yellow
ssh -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@${ip} $remoteCommands

Write-Host "2. Copying admin restriction script to server..." -ForegroundColor Yellow
scp -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no C:\Users\jimbo\OneDrive\Documents\hopbot\scratch\restrict-admins.cjs "root@${ip}:/tmp/restrict-admins.cjs"

Write-Host "3. Executing admin restriction script in api container..." -ForegroundColor Yellow
ssh -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no "root@${ip}" "docker cp /tmp/restrict-admins.cjs hopwhistle-api-dev:/app/restrict-admins.cjs && docker exec -u root hopwhistle-api-dev node /app/restrict-admins.cjs"

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "DEPLOYMENT AND ADMIN RESTRICTIONS SUCCESSFUL!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
