# Hopwhistle Hetzner Deployment Script
# Execute this to pull changes, rebuild containers, and apply database scripts

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Hopwhistle Production Deployer (Hetzner)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

$ip = "178.156.223.97"
$keyPath = "C:\Users\jimbo\.ssh\hetzner_pvn"

# The branch production actually runs. This has now gone stale twice — it said
# edit-campaign-buyer-fix until 2026-08-27, then deploy-sip-fix until that
# branch was merged into main and auto-deleted on 2026-08-31, at which point
# `git pull origin deploy-sip-fix` below would have failed outright.
#
# Pointing at the default branch is what stops this recurring: main cannot be
# deleted out from under the script.
$branch = "main"

$remoteCommands = @(
    "cd /opt/hopwhistle",
    "echo '>>> Pulling latest code...'",
    "git fetch origin",
    "git checkout $branch",
    "git pull origin $branch",
    "git rev-parse --short HEAD",
    "echo '>>> Rebuilding containers...'",
    "docker compose --env-file .env -f infra/docker/docker-compose.dev.yml build api web freeswitch",
    "echo '>>> Starting stack...'",
    # --force-recreate because compose will happily leave the old container
    # running against a freshly built image, and a deploy that builds but does
    # not swap looks identical to one that worked.
    "docker compose --env-file .env -f infra/docker/docker-compose.dev.yml up -d --force-recreate api web freeswitch",
    "sleep 8",
    "docker ps --filter name=hopwhistle-api --format '{{.Names}} {{.Status}}'"
) -join " && "

Write-Host "1. Connecting to root@$ip using key $keyPath..." -ForegroundColor Yellow
# -T stops ssh allocating a pseudo-terminal. Without it a long build's output
# gets echoed back into PowerShell and each line is run as a command.
ssh -T -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@${ip} $remoteCommands

Write-Host ""
Write-Host "Check the Status line above reads 'Up N seconds', not hours." -ForegroundColor Yellow
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "DEPLOYMENT SUCCESSFUL!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""

# Schema changes are NOT applied here on purpose.
#
# This database has no Prisma migration history — it was built with db push, so
# `prisma migrate deploy` fails with P3005 on a non-empty schema. The previous
# answer was `db push --accept-data-loss` on every deploy, which is a standing
# invitation to drop a column on a production database that holds sold leads.
#
# Apply a schema change deliberately instead, by piping its migration SQL:
#
#   cat apps/api/prisma/migrations/<name>/migration.sql `
#     | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
#
# Baselining the database against prisma/migrations would remove the need for
# this, and is worth doing on its own.
Write-Host "No schema changes were applied. See the note at the bottom of this" -ForegroundColor DarkGray
Write-Host "script if this deploy includes a migration." -ForegroundColor DarkGray
