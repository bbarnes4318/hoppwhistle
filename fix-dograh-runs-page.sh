#!/usr/bin/env bash
#
# Dograh results pages (Voice Agents -> runs, campaign runs, Agent Runs) taking
# minutes or failing to load — run this ON THE SERVER, as root.
#
#   cd /opt/hopwhistle && git pull
#   ./fix-dograh-runs-page.sh                 # indexes now, asks before the API restart
#   ./fix-dograh-runs-page.sh --indexes-only  # just the no-restart part
#   ./fix-dograh-runs-page.sh --no-restart    # stage the code patch for the next restart
#   ./fix-dograh-runs-page.sh --restart       # don't ask (between campaigns)
#
# What and why: deploy/dograh/runs-page-speedup/README.md

set -euo pipefail
cd "$(dirname "$0")"
exec python3 deploy/dograh/runs-page-speedup/fix_runs_page.py "$@"
