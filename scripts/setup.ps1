# Setup script for CallFabric monorepo (PowerShell)

Write-Host "🚀 Setting up CallFabric monorepo..." -ForegroundColor Cyan

# Check for pnpm
try {
    $pnpmVersion = pnpm --version
    Write-Host "✓ Found pnpm version $pnpmVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ pnpm is not installed. Please install it first:" -ForegroundColor Red
    Write-Host "   npm install -g pnpm" -ForegroundColor Yellow
    exit 1
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Cyan
pnpm install

# Setup Husky
Write-Host "🐕 Setting up Husky..." -ForegroundColor Cyan
pnpm prepare

# Copy env.example files to .env
Write-Host "📝 Setting up environment files..." -ForegroundColor Cyan
Get-ChildItem -Path apps -Directory | ForEach-Object {
    $envExample = Join-Path $_.FullName "env.example"
    $envFile = Join-Path $_.FullName ".env"
    
    if (Test-Path $envExample) {
        if (-not (Test-Path $envFile)) {
            Copy-Item $envExample $envFile
            Write-Host "   Created $envFile" -ForegroundColor Green
        } else {
            Write-Host "   $envFile already exists, skipping" -ForegroundColor Yellow
        }
    }
}

Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review and update .env files in apps/*/"
Write-Host "  2. Start Docker services: make docker-up"
Write-Host "  3. Start development: pnpm dev"

