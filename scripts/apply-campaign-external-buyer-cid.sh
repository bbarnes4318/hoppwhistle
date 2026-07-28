#!/bin/sh
set -eu

TARGET="${1:-apps/freeswitch/scripts/inbound_route.lua}"
MARKER="campaign_external_cid_fix_v1"

if [ ! -f "$TARGET" ]; then
  echo "ERROR: inbound routing script not found: $TARGET" >&2
  exit 1
fi

if grep -q "$MARKER" "$TARGET"; then
  echo "Campaign external-buyer caller-ID fix already present: $TARGET"
  exit 0
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

awk '
BEGIN {
  replacing = 0
  replaced = 0
}
{
  if (!replacing && $0 ~ /^[[:space:]]*local cid = caller_number[[:space:]]*$/) {
    indent = substr($0, 1, index($0, "local") - 1)

    print indent "-- campaign_external_cid_fix_v1: PSTN buyer legs must present a"
    print indent "-- Hopwhistle/FracTEL DID as caller ID. Forwarding the original callers ANI"
    print indent "-- can be rejected or silently time out even while local ringback continues."
    print indent "local outbound_cid = session:getVariable(\"destination_number\") or \"\""
    print indent "outbound_cid = string.gsub(tostring(outbound_cid), \"%D\", \"\")"
    print indent "if string.len(outbound_cid) == 10 then"
    print indent "    outbound_cid = \"1\" .. outbound_cid"
    print indent "end"
    print indent "if string.len(outbound_cid) ~= 11 or string.sub(outbound_cid, 1, 1) ~= \"1\" then"
    print indent "    outbound_cid = os.getenv(\"FRACTEL_DEFAULT_CALLER_ID\") or \"12294222208\""
    print indent "    outbound_cid = string.gsub(tostring(outbound_cid), \"%D\", \"\")"
    print indent "    if string.len(outbound_cid) == 10 then"
    print indent "        outbound_cid = \"1\" .. outbound_cid"
    print indent "    end"
    print indent "end"
    print indent "log(\"INFO\", \"External buyer leg using verified FracTEL caller ID \" .. outbound_cid .. \"; original caller=\" .. tostring(caller_number))"
    print indent "local bridge_vars = string.format("
    print indent "    \"{sip_cid_type=pid,sip_from_user=%s,origination_caller_id_number=%s,origination_caller_id_name=Hopwhistle,effective_caller_id_number=%s,effective_caller_id_name=Hopwhistle}\","
    print indent "    outbound_cid, outbound_cid, outbound_cid"
    print indent ")"

    replacing = 1
    replaced = 1
    next
  }

  if (replacing) {
    if ($0 ~ /^[[:space:]]*\)[[:space:]]*$/) {
      replacing = 0
    }
    next
  }

  print
}
END {
  if (replacing || !replaced) {
    exit 42
  }
}
' "$TARGET" > "$TMP" || {
  echo "ERROR: expected campaign buyer bridge caller-ID block was not found" >&2
  exit 1
}

cat "$TMP" > "$TARGET"

for expected in \
  "$MARKER" \
  'sip_cid_type=pid,sip_from_user=%s' \
  'External buyer leg using verified FracTEL caller ID'
do
  if ! grep -q "$expected" "$TARGET"; then
    echo "ERROR: patch verification failed: $expected" >&2
    exit 1
  fi
done

echo "Campaign external-buyer caller-ID fix applied: $TARGET"
