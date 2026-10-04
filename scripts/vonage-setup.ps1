# Vonage carrier setup for the Hetzner production server.
#
# Run from the repository root on your Windows machine:
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\vonage-setup.ps1
#
# What it does, in order:
#   1. Asks for your Vonage API key and secret (Vonage dashboard -> API Settings).
#   2. Backs up /opt/hopwhistle/.env on the server, then writes the Vonage
#      settings into it. Nothing else in that file is touched.
#   3. Runs deploy.ps1 (rebuilds api, web, freeswitch from main) and then
#      rebuilds the worker, which deploy.ps1 does not.
#   4. Shows the two start-up log lines that prove Vonage is configured.
#   5. Lists your tenants, asks which one, and runs the Vonage diagnostic.
#
# Needs PR #207 merged for step 5 (the diagnostic); steps 1-4 work without it.
#
# It does NOT switch Vonage on for any call. That stays a toggle in
# Settings -> Carrier Routing, so nothing changes for live calls until you
# choose it.

$ErrorActionPreference = "Stop"

$ip = "5.161.16.107"
$keyPath = "C:\Users\jimbo\.ssh\hetzner_pvn"
$sshArgs = @("-T", "-o", "IdentitiesOnly=yes", "-i", $keyPath, "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "root@$ip")

function Invoke-Remote([string]$script) {
    # Sent on stdin rather than as an argument so nothing has to survive
    # PowerShell and ssh quoting; tr strips the CRs Windows adds.
    ($script -replace "`r", "") | ssh @sshArgs "tr -d '\r' | bash -s"
    if ($LASTEXITCODE -ne 0) { throw "Remote step failed (exit $LASTEXITCODE)" }
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Vonage carrier setup (Hetzner $ip)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# -- 1. Credentials ---------------------------------------------------------
$apiKey = (Read-Host "Vonage API key").Trim()
$secure = Read-Host "Vonage API secret" -AsSecureString
$apiSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
if (-not $apiKey -or -not $apiSecret) { throw "Both the API key and the API secret are required." }
# Docker Compose expands $ in .env values and a quote or # would end the value
# early. Vonage keys and secrets are letters and digits, so anything else is
# almost certainly a paste error and is refused rather than written half-broken.
foreach ($v in @($apiKey, $apiSecret)) {
    if ($v -match '[\$''"#\s]') { throw "The key or secret contains a character (`$, quote, # or space) that cannot go in .env. Check what you pasted." }
}

Write-Host ""
Write-Host "Outbound SIP authentication:" -ForegroundColor Yellow
Write-Host "  [1] Use the API key and secret as SIP credentials (default, no dashboard step)"
Write-Host "  [2] IP allow-list: I have authorised $ip in the Vonage dashboard"
$authChoice = Read-Host "Choose 1 or 2 [1]"
if ($authChoice -eq "2") { $sipUser = ""; $sipPass = "" } else { $sipUser = $apiKey; $sipPass = $apiSecret }

# -- 2. Write the settings into /opt/hopwhistle/.env ------------------------
$envBlock = @"
VONAGE_API_KEY=$apiKey
VONAGE_API_SECRET=$apiSecret
VONAGE_NUMBER_ROUTING_MODE=sip
VONAGE_SIP_URI=sip:${ip}:5080
VONAGE_DEFAULT_COUNTRY=US
VONAGE_SIP_PROXY=sip.nexmo.com
VONAGE_SIP_USERNAME=$sipUser
VONAGE_SIP_PASSWORD=$sipPass
"@

$writeEnv = @'
set -e
cd /opt/hopwhistle
cp .env ".env.bak.$(date +%Y%m%d%H%M%S)"
# Drop only the lines this script owns, then append the new values.
# VONAGE_APPLICATION_ID is deliberately left alone: routing mode "sip" ignores it.
sed -i -E '/^(VONAGE_API_KEY|VONAGE_API_SECRET|VONAGE_NUMBER_ROUTING_MODE|VONAGE_SIP_URI|VONAGE_DEFAULT_COUNTRY|VONAGE_SIP_PROXY|VONAGE_SIP_REALM|VONAGE_SIP_USERNAME|VONAGE_SIP_PASSWORD)=/d' .env
# Make sure the file ends in a newline so the first appended line cannot merge.
[ -z "$(tail -c1 .env)" ] || echo >> .env
cat >> .env <<'VONAGE_ENV_EOF'
__ENV_BLOCK__
VONAGE_ENV_EOF
echo ">>> Vonage settings now in /opt/hopwhistle/.env (secrets masked):"
grep -E '^VONAGE_' .env | sed -E 's/^(VONAGE_(API_SECRET|SIP_PASSWORD)=).+/\1********/'
'@
Write-Host ""
Write-Host "2. Writing Vonage settings to /opt/hopwhistle/.env (a timestamped backup is kept)..." -ForegroundColor Yellow
Invoke-Remote ($writeEnv.Replace("__ENV_BLOCK__", ($envBlock -replace "`r", "")))

# -- 3. Deploy --------------------------------------------------------------
Write-Host ""
Write-Host "3. Deploying api, web, freeswitch (deploy.ps1)..." -ForegroundColor Yellow
& (Join-Path $PSScriptRoot "..\deploy.ps1")

Write-Host ""
Write-Host "   Rebuilding the worker (deploy.ps1 does not)..." -ForegroundColor Yellow
Invoke-Remote @'
set -e
cd /opt/hopwhistle
docker compose --env-file .env -f infra/docker/docker-compose.dev.yml build worker
docker compose --env-file .env -f infra/docker/docker-compose.dev.yml up -d --force-recreate worker
sleep 5
docker ps --filter name=hopwhistle-worker --format '{{.Names}} {{.Status}}'
'@

# -- 4. Proof it loaded -----------------------------------------------------
Write-Host ""
Write-Host "4. Start-up checks. Expect 'mode: sip' and 'Vonage SIP trunk: ... auth=...':" -ForegroundColor Yellow
Invoke-Remote @'
sleep 10
echo "--- API:"
docker logs hopwhistle-api-dev 2>&1 | grep -E 'Vonage number (routing|purchases)' | tail -2 || echo "(no Vonage line in API log yet)"
echo "--- FreeSWITCH:"
docker logs hopwhistle-freeswitch-dev 2>&1 | grep -E 'Vonage SIP trunk' | tail -2 || echo "(no Vonage line in FreeSWITCH log)"
echo "--- Gateway as FreeSWITCH sees it:"
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia status gateway vonage' | grep -E 'Name|State|Status|Proxy' || true
'@

# -- 5. Diagnostic ----------------------------------------------------------
Write-Host ""
Write-Host "5. Tenants on this server:" -ForegroundColor Yellow
Invoke-Remote @'
docker exec hopwhistle-postgres-dev sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT id, name FROM tenants ORDER BY name;"'
'@
$tenant = (Read-Host "Paste the tenant id to check").Trim()
if ($tenant) {
    $t = $tenant.Replace("'", "")
    Invoke-Remote ("if docker exec hopwhistle-api-dev test -f dist/cli/vonage-diagnose.js; then " +
        "docker exec hopwhistle-api-dev node dist/cli/vonage-diagnose.js --tenant '$t' --check-numbers || true; " +
        "else echo 'The diagnostic is not in this build yet: merge PR #207, then run deploy.ps1 again.'; fi")
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "Vonage is configured but still switched OFF for every call type." -ForegroundColor Green
Write-Host "Turn it on in the app: Settings -> Carrier Routing." -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
