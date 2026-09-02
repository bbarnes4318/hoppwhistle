# Hopwhistle — Dograh AI Voice Recordings
#
# Pulls every AI voice call recording in a date window off the production box
# and drops the archive in your Downloads folder. One command, no arguments
# needed for 8/25/2026 through 9/1/2026.
#
#   .\get-dograh-recordings.ps1                            # 8/25 - 9/1/2026
#   .\get-dograh-recordings.ps1 2026-09-02 2026-09-08      # any other window
#   .\get-dograh-recordings.ps1 -Tz utc                    # read dates as UTC
#
# Both dates are inclusive and are read as US Eastern unless -Tz says otherwise.
#
# The AI voice calls belong to the self-hosted Dograh stack (/opt/dograh), which
# has its own database and its own recording storage — none of it is in the
# Hopwhistle DB. So the export runs inside the Dograh api container, where the
# database URL and the recording bucket credentials already are, and this copies
# the result back.
#
# Read-only. It reads Dograh's database and downloads the audio it points at; it
# writes nothing back to Dograh.

param(
    [string]$From = "2026-08-25",
    [string]$To = "2026-09-01",
    [string]$Tz = "-04:00",
    [string]$Container = "dograh-api-1"
)

$ErrorActionPreference = "Stop"

$ip = "178.156.223.97"
$keyPath = "C:\Users\jimbo\.ssh\hetzner_pvn"
$downloads = "$env:USERPROFILE\Downloads"

# Matches the slug the server script builds, so the archive we copy back is the
# one it actually wrote.
$slug = ("${From}_to_${To}" -replace '[^a-zA-Z0-9._-]', '_')
$tarball = "/root/dograh-recordings-$slug.tar.gz"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "Dograh AI Voice Recordings - $From through $To" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Only the exporter is pulled onto the server, and it is removed again at the
# end. Nothing checks out a branch: the box carries uncommitted work, and a
# checkout here would be a good way to lose it.
$remote = @(
    "cd /opt/hopwhistle",
    "git fetch origin main",
    "git checkout origin/main -- deploy/dograh/export_recordings.py",
    "docker exec $Container rm -rf /tmp/dograh-rec",
    "docker exec $Container mkdir -p /tmp/dograh-rec",
    "docker cp deploy/dograh/export_recordings.py ${Container}:/tmp/dograh-rec/export_recordings.py",
    "docker exec $Container python /tmp/dograh-rec/export_recordings.py --from '$From' --to '$To' --tz '$Tz' --out /tmp/dograh-rec/out",
    "rm -rf /root/dograh-recordings-$slug",
    "mkdir -p /root/dograh-recordings-$slug",
    "docker cp ${Container}:/tmp/dograh-rec/out/. /root/dograh-recordings-$slug/",
    "tar -czf $tarball -C /root dograh-recordings-$slug",
    # Leave the tree as we found it. An untracked file left behind here blocks
    # the next git checkout on the server.
    "git reset -q HEAD -- deploy/dograh/export_recordings.py",
    "rm -f deploy/dograh/export_recordings.py"
) -join " && "

# -T stops ssh allocating a pseudo-terminal. Without it the remote output is
# echoed back into PowerShell and each line is run as a command.
ssh -T -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no -o ConnectTimeout=15 root@${ip} $remote

if ($LASTEXITCODE -eq 2) {
    Write-Host ""
    Write-Host "Dograh recorded no calls in that window." -ForegroundColor Yellow
    Write-Host "The dates it does have runs for are listed above." -ForegroundColor Yellow
    exit 2
}

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "The export did not finish. Nothing was copied." -ForegroundColor Red
    Write-Host "If it failed on the container name, check it with:" -ForegroundColor Yellow
    Write-Host "  ssh root@$ip 'cd /opt/dograh && docker compose ps'" -ForegroundColor Yellow
    Write-Host "then re-run with -Container <name>." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "Copying to $downloads ..." -ForegroundColor Yellow

scp -o IdentitiesOnly=yes -i $keyPath -o StrictHostKeyChecking=no `
    "root@${ip}:$tarball" $downloads

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "The recordings were exported on the server but could not be copied down." -ForegroundColor Red
    Write-Host "They are in $tarball on ${ip}." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "DONE - archive is in your Downloads folder" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  dograh-recordings-$slug.tar.gz" -ForegroundColor Gray
Write-Host ""
Write-Host "Inside it:" -ForegroundColor Gray
Write-Host "  manifest.csv   one row per call: time, numbers, duration, outcome," -ForegroundColor Gray
Write-Host "                 and the audio file it maps to" -ForegroundColor Gray
Write-Host "  audio\         the recordings, named <date>_<time>_run<id>_<number>" -ForegroundColor Gray
Write-Host ""
Write-Host "A row whose status is 'no-recording' is a call Dograh never recorded" -ForegroundColor Yellow
Write-Host "(recording off for that agent, or the call never connected). A row" -ForegroundColor Yellow
Write-Host "whose status is 'failed' has the reason in its note column." -ForegroundColor Yellow
