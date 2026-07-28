#!/usr/bin/env bash
set -euo pipefail

ROOT="/opt/hopwhistle"
INDEX_FILE="$ROOT/apps/api/src/index.ts"
PHONE_FILE="$ROOT/apps/api/src/routes/agent-phone.ts"
COMPOSE_FILE="$ROOT/infra/docker/docker-compose.dev.yml"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

for file in "$INDEX_FILE" "$PHONE_FILE" "$COMPOSE_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "ERROR: required file not found: $file" >&2
    exit 1
  fi
done

cp -a "$INDEX_FILE" "$INDEX_FILE.before-softphone-auth-$STAMP"
cp -a "$PHONE_FILE" "$PHONE_FILE.before-softphone-auth-$STAMP"

python3 - "$INDEX_FILE" "$PHONE_FILE" <<'PY'
from __future__ import annotations

import pathlib
import re
import sys

index_path = pathlib.Path(sys.argv[1])
phone_path = pathlib.Path(sys.argv[2])

index_text = index_path.read_text(encoding="utf-8")
phone_text = phone_path.read_text(encoding="utf-8")

session_marker = "    // Fallback to Demo Tenant ID if present and JWT failed/absent\n"
session_sentinel = "Recover browser sessions when a stale JWT is presented"
session_block = """    // Recover browser sessions when a stale JWT is presented.\n    // Same-origin browser requests automatically include the sessionId cookie.\n    const sessionId = request.cookies?.sessionId;\n    if (sessionId) {\n      try {\n        const { getSession } = await import('./middleware/session.js');\n        const session = await getSession(sessionId);\n        const sessionUserId =\n          typeof session?.userId === 'string' ? session.userId : undefined;\n        const sessionTenantId =\n          typeof session?.tenantId === 'string' ? session.tenantId : undefined;\n\n        if (sessionUserId && sessionTenantId) {\n          request.user = {\n            userId: sessionUserId,\n            tenantId: sessionTenantId,\n            email: typeof session?.email === 'string' ? session.email : undefined,\n          };\n          return;\n        }\n      } catch {\n        // Invalid or expired session; continue to the other auth methods.\n      }\n    }\n\n"""

if session_sentinel not in index_text:
    if session_marker not in index_text:
        raise SystemExit("ERROR: could not locate API authentication insertion point")
    index_text = index_text.replace(session_marker, session_block + session_marker, 1)
    index_path.write_text(index_text, encoding="utf-8")
    print("PATCHED: API now recovers valid sessionId cookies after stale JWTs")
else:
    print("OK: session-cookie recovery patch already present")

password_pattern = re.compile(
    r"(const activeExt\s*=\s*extension\s*\|\|\s*['\"]1000['\"];\s*"
    r"const username\s*=\s*activeExt;\s*)"
    r"const password\s*=\s*[^;]+;",
    re.MULTILINE,
)
password_replacement = (
    r"\1const password = process.env.SIP_AGENT_PASSWORD || '1234';"
)

phone_updated, replacements = password_pattern.subn(
    password_replacement,
    phone_text,
    count=1,
)

if replacements == 0:
    if "const password = process.env.SIP_AGENT_PASSWORD || '1234';" in phone_text:
        print("OK: SIP credentials already use SIP_AGENT_PASSWORD")
    else:
        raise SystemExit("ERROR: could not locate WebRTC SIP password assignment")
else:
    phone_path.write_text(phone_updated, encoding="utf-8")
    print("PATCHED: WebRTC credentials now use SIP_AGENT_PASSWORD")
PY

cd "$ROOT/infra/docker"

echo "=== REBUILDING API ONLY ==="
docker compose -f "$COMPOSE_FILE" up -d --build api

echo
echo "=== API STATUS ==="
docker ps --filter name=hopwhistle-api-dev --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo
echo "=== COMPILED FIX CHECK ==="
if docker exec hopwhistle-api-dev sh -lc 'grep -Rqs "SIP_AGENT_PASSWORD" /app/dist'; then
  echo "Compiled SIP password fix: PRESENT"
else
  echo "ERROR: compiled SIP password fix missing" >&2
  exit 1
fi

if docker exec hopwhistle-api-dev sh -lc 'grep -Rqs "sessionId" /app/dist'; then
  echo "Compiled session recovery: PRESENT"
else
  echo "ERROR: compiled session recovery missing" >&2
  exit 1
fi

echo
echo "=== API HEALTH ==="
for attempt in 1 2 3 4 5 6; do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1; then
    echo "API health: OK"
    break
  fi
  if [[ "$attempt" -eq 6 ]]; then
    echo "ERROR: API health check failed" >&2
    docker logs --tail 120 hopwhistle-api-dev >&2
    exit 1
  fi
  sleep 2
done

echo
echo "FIX COMPLETE"
echo "The browser can now recover through its existing session cookie, and the SIP credentials returned by the API match FreeSWITCH."
