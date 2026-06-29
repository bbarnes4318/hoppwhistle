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
    "docker exec -u root hopwhistle-api-dev npx prisma db push --accept-data-loss"
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
