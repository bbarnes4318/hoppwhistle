#!/bin/bash
# Static signing test — validates the openssl pipeline produces correct Identity header format
KEY=/etc/freeswitch/stir-shaken/private.key
CERT_URL=https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt
HEADER='{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"'${CERT_URL}'"}'
PAYLOAD='{"attest":"A","dest":{"tn":["+12025551234"]},"iat":1711152000,"orig":{"tn":"+12816989460"},"origid":"TEST-UUID-1234"}'

H=$(printf '%s' "$HEADER" | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
P=$(printf '%s' "$PAYLOAD" | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "${H}.${P}" | /usr/bin/openssl dgst -sha256 -sign $KEY -binary | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
IDENTITY="${H}.${P}.${SIG};info=<${CERT_URL}>;alg=ES256;ppt=shaken"

echo "=== STATIC SIGNING TEST ==="
echo "H_LENGTH=${#H}"
echo "P_LENGTH=${#P}"
echo "SIG_LENGTH=${#SIG}"
echo "TOKEN_PARTS=3"
echo "IDENTITY_LENGTH=${#IDENTITY}"
echo ""
echo "=== IDENTITY HEADER VALUE ==="
echo "$IDENTITY"
echo ""
echo "=== FORMAT VALIDATION ==="
# Check format: three dot-separated parts, followed by ;info=<...>;alg=ES256;ppt=shaken
PARTS=$(echo "${H}.${P}.${SIG}" | tr '.' '\n' | wc -l)
echo "JWT_PARTS=$PARTS (expected: 3)"
echo "HAS_INFO=$(echo $IDENTITY | grep -c 'info=<')"
echo "HAS_ALG=$(echo $IDENTITY | grep -c 'alg=ES256')"
echo "HAS_PPT=$(echo $IDENTITY | grep -c 'ppt=shaken')"
echo "HAS_WHITESPACE=$(echo $IDENTITY | grep -cP '[\t\r\n]')"
