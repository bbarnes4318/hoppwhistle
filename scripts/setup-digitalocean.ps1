# Setup script for DigitalOcean App Platform deployment (PowerShell)

Write-Host "Setting up Hopwhistle for DigitalOcean App Platform" -ForegroundColor Cyan
Write-Host ""

# Check if git is initialized
if (-not (Test-Path .git)) {
    Write-Host "[ERROR] Git repository not initialized" -ForegroundColor Red
    Write-Host "   Run: git init" -ForegroundColor Yellow
    exit 1
}

# Check if remote is set
try {
    $null = git remote get-url origin 2>$null
} catch {
    Write-Host "Setting up GitHub remote..." -ForegroundColor Yellow
    git remote add origin https://github.com/bbarnes4318/hopwhistle.git
    Write-Host "[OK] Remote added" -ForegroundColor Green
}

# Check if .do/app.yaml exists
if (-not (Test-Path .do/app.yaml)) {
    Write-Host "[WARN] .do/app.yaml not found" -ForegroundColor Yellow
    Write-Host "   Creating from template..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Force -Path .do | Out-Null
    Copy-Item .do/deploy.template.yaml .do/app.yaml -ErrorAction SilentlyContinue
    Write-Host "[OK] Created .do/app.yaml" -ForegroundColor Green
    Write-Host "   [WARN] Please review and customize .do/app.yaml before deploying" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[OK] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review .do/app.yaml configuration" -ForegroundColor White
Write-Host "  2. Commit and push to GitHub:" -ForegroundColor White
Write-Host "     git add ." -ForegroundColor Gray
Write-Host "     git commit -m 'Setup DigitalOcean deployment'" -ForegroundColor Gray
Write-Host "     git push -u origin main" -ForegroundColor Gray
Write-Host "  3. Go to https://cloud.digitalocean.com/apps" -ForegroundColor White
Write-Host "  4. Click 'Create App' and connect your GitHub repo" -ForegroundColor White
Write-Host "  5. DigitalOcean will detect .do/app.yaml automatically" -ForegroundColor White
Write-Host ""
Write-Host "See DEPLOYMENT.md for detailed instructions" -ForegroundColor Cyan

