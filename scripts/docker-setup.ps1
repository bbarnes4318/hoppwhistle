# Docker Setup Verification and Startup Script for Hopwhistle
# This script verifies Docker is ready and helps start the voice/call tracking application

Write-Host "Hopwhistle Docker Setup" -ForegroundColor Cyan
Write-Host ""

# Check Docker
Write-Host "Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version
    Write-Host "[OK] $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker is not installed or not running" -ForegroundColor Red
    Write-Host "   Please install Docker Desktop and ensure it's running" -ForegroundColor Yellow
    exit 1
}

# Check Docker Compose
Write-Host "Checking Docker Compose..." -ForegroundColor Yellow
try {
    $composeVersion = docker-compose --version
    Write-Host "[OK] $composeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker Compose not found" -ForegroundColor Red
    exit 1
}

# Check if Docker daemon is running
Write-Host "Checking Docker daemon..." -ForegroundColor Yellow
try {
    docker ps | Out-Null
    Write-Host "[OK] Docker daemon is running" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Docker daemon is not running" -ForegroundColor Red
    Write-Host "   Please start Docker Desktop" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Environment Files Check..." -ForegroundColor Cyan

# Check for required .env files
$requiredEnvFiles = @(
    "apps/api/.env",
    "apps/web/.env",
    "apps/worker/.env",
    "apps/media/.env",
    "infra/docker/.env"
)

$missingFiles = @()
foreach ($file in $requiredEnvFiles) {
    if (Test-Path $file) {
        Write-Host "[OK] $file exists" -ForegroundColor Green
    } else {
        Write-Host "[WARN] $file is missing" -ForegroundColor Yellow
        $missingFiles += $file
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "[WARN] Some environment files are missing. They may be needed for full functionality." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Ready to start services!" -ForegroundColor Green
Write-Host ""
Write-Host "To start all services, run:" -ForegroundColor Cyan
Write-Host "  cd infra/docker" -ForegroundColor White
Write-Host "  docker-compose -f docker-compose.dev.yml up -d" -ForegroundColor White
Write-Host ""
Write-Host "Or use the Makefile (if you have make installed):" -ForegroundColor Cyan
Write-Host "  make up" -ForegroundColor White
Write-Host ""
Write-Host "To view logs:" -ForegroundColor Cyan
Write-Host "  docker-compose -f infra/docker/docker-compose.dev.yml logs -f" -ForegroundColor White
Write-Host ""
Write-Host "To stop services:" -ForegroundColor Cyan
Write-Host "  docker-compose -f infra/docker/docker-compose.dev.yml down" -ForegroundColor White
Write-Host ""

# Ask if user wants to start services now
$response = Read-Host "Would you like to start the services now? (y/n)"
if ($response -eq "y" -or $response -eq "Y") {
    Write-Host ""
    Write-Host "Starting services..." -ForegroundColor Cyan
    Set-Location infra/docker
    docker-compose -f docker-compose.dev.yml up -d
    Write-Host ""
    Write-Host "[OK] Services started!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Services available at:" -ForegroundColor Cyan
    Write-Host "  - Web UI:      http://localhost:3000" -ForegroundColor White
    Write-Host "  - API:         http://localhost:3001" -ForegroundColor White
    Write-Host "  - Grafana:     http://localhost:3002" -ForegroundColor White
    Write-Host "  - Prometheus:  http://localhost:9090" -ForegroundColor White
    Write-Host "  - MinIO:       http://localhost:9001" -ForegroundColor White
    Write-Host ""
    Write-Host "To check service status:" -ForegroundColor Cyan
    Write-Host "  docker-compose -f docker-compose.dev.yml ps" -ForegroundColor White
    Set-Location ../..
}

