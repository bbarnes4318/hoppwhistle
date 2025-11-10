# PowerShell script to run all k6 performance tests sequentially

$ErrorActionPreference = "Stop"

$env:API_URL = if ($env:API_URL) { $env:API_URL } else { "http://localhost:3001" }
$env:WS_URL = if ($env:WS_URL) { $env:WS_URL } else { "ws://localhost:3001" }
$env:API_KEY = if ($env:API_KEY) { $env:API_KEY } else { "test-api-key" }
$env:TENANT_ID = if ($env:TENANT_ID) { $env:TENANT_ID } else { "00000000-0000-0000-0000-000000000000" }

Write-Host "🚀 Starting k6 Performance Test Suite" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host "API URL: $env:API_URL"
Write-Host "WS URL: $env:WS_URL"
Write-Host ""

# Create results directory
New-Item -ItemType Directory -Force -Path "results" | Out-Null

Write-Host "📞 Test 1/3: Call State Updates" -ForegroundColor Cyan
Write-Host "--------------------------------"
k6 run `
  --env "API_URL=$env:API_URL" `
  --env "API_KEY=$env:API_KEY" `
  --env "TENANT_ID=$env:TENANT_ID" `
  --out "json=results/call-state-updates.json" `
  call-state-updates.js

Write-Host ""
Write-Host "📊 Test 2/3: Reporting Endpoints" -ForegroundColor Cyan
Write-Host "----------------------------------"
k6 run `
  --env "API_URL=$env:API_URL" `
  --env "API_KEY=$env:API_KEY" `
  --env "TENANT_ID=$env:TENANT_ID" `
  --out "json=results/reporting-endpoints.json" `
  reporting-endpoints.js

Write-Host ""
Write-Host "📡 Test 3/3: Redis Pub/Sub" -ForegroundColor Cyan
Write-Host "---------------------------"
k6 run `
  --env "WS_URL=$env:WS_URL" `
  --env "API_URL=$env:API_URL" `
  --env "API_KEY=$env:API_KEY" `
  --env "TENANT_ID=$env:TENANT_ID" `
  --env "PUBLISHER_VUS=10" `
  --env "MESSAGES_PER_SECOND=500" `
  --out "json=results/redis-pubsub.json" `
  redis-pubsub.js

Write-Host ""
Write-Host "✅ All tests completed!" -ForegroundColor Green
Write-Host "Results saved to tests/k6/results/"

