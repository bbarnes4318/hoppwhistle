#!/bin/bash
# ============================================================================
# Wrapper for Canonical FreeSWITCH Recording Upload Hook
# ============================================================================
# This script corrects the argument order and delegates to the canonical script:
# apps/freeswitch/scripts/upload-recording.sh
#
# Arguments expected here:
#   $1 = Hopwhistle Call.id
#   $2 = Recording file path
#
# Delegates to canonical script expecting:
#   $1 = Recording file path
#   $2 = Hopwhistle Call.id
# ============================================================================

CANONICAL_SCRIPT="$(dirname "$0")/../../freeswitch/scripts/upload-recording.sh"
if [ ! -f "$CANONICAL_SCRIPT" ]; then
  CANONICAL_SCRIPT="/usr/share/freeswitch/scripts/upload-recording.sh"
fi

exec "$CANONICAL_SCRIPT" "$2" "$1"

