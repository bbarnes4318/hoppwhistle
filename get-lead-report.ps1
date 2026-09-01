# Hopwhistle — Buyer Disposition Report
#
# Builds the four disposition CSVs on the production box and drops them in your
# Downloads folder. One command, no arguments needed.
#
#   .\get-lead-report.ps1                     # defaults to fe-august-2026
#   .\get-lead-report.ps1 fe-september-2026   # any other list
#   .\get-lead-report.ps1 -All                # every list in the tenant
#
# The lead data lives in Postgres on the server, so the report has to be built
# there, inside the API container where DATABASE_URL and the Prisma client are.
# This does that and copies the results back.
#
# Read-only. It runs findMany and writes CSVs; it never touches lead state and
# never posts anything to the buyer.

param(
    [string]$ListName = "fe-august-2026",
    [switch]$All
)

$ErrorActionPreference = "Stop"

$ip = "178.156.223.97"
$keyPath = "C:\Users\jimbo\.ssh\hetzner_pvn"
$downloads = "$env:USERPROFILE\Downloads"

# Matches the slug the script itself builds from the list name, so the filenames
# we copy back are the ones it actually wrote.
if ($All) {
    $slug = "all-leads"
    $listArg = ""
    $label = "every list"
} else {
    $slug = ($ListName -replace '[^a-zA-Z0-9-]', '_')
    # Quoted for the remote bash, so a list name containing a space stays one
    # argument instead of becoming two.
    $listArg = " '$ListName'"
    $label = "list '$ListName'"
}

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Buyer Disposition Report - $label" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Only this one file is pulled onto the server, and it is removed again at the
# end. Nothing checks out a branch: the box carries uncommitted work, and a
# checkout here would be a good way to lose it.
$remote = @(
    "cd /opt/hopwhistle",
    "git fetch origin main",
    "git checkout origin/main -- scripts/export-buyer-disposition.mjs",
    "docker cp scripts/export-buyer-disposition.mjs hopwhistle-api-dev:/app/disposition.mjs",
    "docker exec -u root hopwhistle-api-dev node /app/disposition.mjs$listArg",
    "docker cp hopwhistle-api-dev:/app/$slug-all.csv /root/",
    "docker cp hopwhistle-api-dev:/app/$slug-accepted.csv /root/",
    "docker cp hopwhistle-api-dev:/app/$slug-rejected.csv /root/",
    "docker cp hopwhistle-api-dev:/app/$slug-never-sent.csv /root/",
    # Leave the tree as we found it. An untracked file left behind here blocks
    # the next git checkout on the server.
    "git reset -q HEAD -- scripts/export-buyer-disposition.mjs",
    "rm -f scripts/export-buyer-disposition.mjs"
) -join " && "

# -T stops ssh allocating a pseudo-terminal. Without it the remote output is
# echoed back into PowerShell and each line is run as a command.
ssh -T -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no -o ConnectTimeout=15 root@${ip} $remote

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "The report did not finish. Nothing was copied." -ForegroundColor Red
    Write-Host "If it failed on the list name, check the spelling against" -ForegroundColor Yellow
    Write-Host "the Lead Lists page." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Copying to $downloads ..." -ForegroundColor Yellow

scp -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no `
    "root@${ip}:/root/$slug-*.csv" $downloads

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "The CSVs were built on the server but could not be copied down." -ForegroundColor Red
    Write-Host "They are in /root/ on ${ip}." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "DONE - files are in your Downloads folder" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  $slug-accepted.csv    the buyer took these" -ForegroundColor Gray
Write-Host "  $slug-rejected.csv    reached the buyer, came back" -ForegroundColor Gray
Write-Host "  $slug-never-sent.csv  never left the building - fixable" -ForegroundColor Gray
Write-Host "  $slug-all.csv         everything, filter on the Outcome column" -ForegroundColor Gray
Write-Host ""
Write-Host "Do NOT re-send anything in the rejected file. Those have already" -ForegroundColor Yellow
Write-Host "spent their 90-day duplicate window; posting them again makes them" -ForegroundColor Yellow
Write-Host "permanently unsellable. Only never-sent is safe to fix and re-import." -ForegroundColor Yellow
