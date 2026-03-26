#!/bin/bash
# Test the exact PASSporT token generation used by local_shaken.lua
HEADER='{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"}'
PAYLOAD='{"attest":"A","dest":{"tn":["+15513326220"]},"iat":1711234567,"orig":{"tn":"+12816989460"},"origid":"TEST-UUID-1234"}'
KEY=/etc/freeswitch/stir-shaken/private.key

echo "=== HEADER ==="
echo "$HEADER"
echo ""
echo "=== PAYLOAD ==="
echo "$PAYLOAD"
echo ""

H=$(printf '%s' "$HEADER" | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "=")
P=$(printf '%s' "$PAYLOAD" | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "=")
SIG=$(printf '%s' "${H}.${P}" | /usr/bin/openssl dgst -sha256 -sign "$KEY" -binary | /usr/bin/openssl base64 -A | tr "+/" "-_" | tr -d "=")

echo "=== BASE64URL HEADER ==="
echo "$H"
echo ""
echo "=== BASE64URL PAYLOAD ==="
echo "$P"
echo ""
echo "=== SIGNATURE ==="
echo "$SIG"
echo ""

TOKEN="${H}.${P}.${SIG}"
echo "=== FULL TOKEN ==="
echo "$TOKEN"
echo ""
echo "=== TOKEN LENGTH ==="
echo -n "$TOKEN" | wc -c
echo ""

IDENTITY="${TOKEN};info=<https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt>;alg=ES256;ppt=shaken"
echo ""
echo "=== FULL IDENTITY HEADER ==="
echo "$IDENTITY"
echo ""
echo "=== IDENTITY HEADER LENGTH ==="
echo -n "$IDENTITY" | wc -c
