#!/bin/bash
# Generate a real signed call example using PVN LLC's actual STIR/SHAKEN keys
# Same exact logic as local_shaken.lua

CALLER="+12816989460"
DEST="+19379775624"
IAT=$(date +%s)
ORIGID=$(cat /proc/sys/kernel/random/uuid | tr a-z A-Z)
CERT_URL="https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"
KEY="/etc/freeswitch/stir-shaken/private.key"

HEADER="{\"alg\":\"ES256\",\"ppt\":\"shaken\",\"typ\":\"passport\",\"x5u\":\"${CERT_URL}\"}"
PAYLOAD="{\"attest\":\"A\",\"dest\":{\"tn\":[\"${DEST}\"]},\"iat\":${IAT},\"orig\":{\"tn\":\"${CALLER}\"},\"origid\":\"${ORIGID}\"}"

H=$(printf '%s' "$HEADER" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
P=$(printf '%s' "$PAYLOAD" | openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "${H}.${P}" | openssl dgst -sha256 -sign $KEY -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')

IDENTITY="${H}.${P}.${SIG};info=<${CERT_URL}>;alg=ES256;ppt=shaken"

echo "=== DECODED HEADER (JSON) ==="
echo "$HEADER"
echo ""
echo "=== DECODED PAYLOAD (JSON) ==="
echo "$PAYLOAD"
echo ""
echo "=== FULL SIP IDENTITY HEADER (exactly as injected on the wire) ==="
echo "Identity: $IDENTITY"
echo ""
echo "=== CALL DETAILS ==="
echo "From: $CALLER (PVN LLC DID on BulkVS)"
echo "To: $DEST"
echo "Timestamp (iat): $IAT"
echo "OrigID: $ORIGID"
echo "Attestation: A (Full)"
echo "Certificate: $CERT_URL"
echo "Key: $KEY (ES256/P-256)"
echo ""
echo "=== KEY AND CERT FILES ON DISK ==="
ls -la /etc/freeswitch/stir-shaken/
