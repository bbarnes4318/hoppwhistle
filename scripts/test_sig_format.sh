#!/bin/sh
# Check if the signature is DER-encoded (wrong) or raw R||S (correct)
KEY=/etc/freeswitch/stir-shaken/private.key
H=$(printf '%s' '{"alg":"ES256","ppt":"shaken","typ":"passport","x5u":"https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"}' | openssl base64 -A | tr "+/" "-_" | tr -d "=")
P=$(printf '%s' '{"attest":"A","dest":{"tn":["+15513326220"]},"iat":1711234567,"orig":{"tn":"+12816989460"},"origid":"TEST-UUID"}' | openssl base64 -A | tr "+/" "-_" | tr -d "=")

# Get raw DER signature
DER_SIG=$(printf '%s' "${H}.${P}" | openssl dgst -sha256 -sign "$KEY" -binary)
DER_LEN=$(printf '%s' "$DER_SIG" | wc -c)

# Get base64url of DER
SIG_B64=$(printf '%s' "${H}.${P}" | openssl dgst -sha256 -sign "$KEY" -binary | openssl base64 -A | tr "+/" "-_" | tr -d "=")
SIG_B64_LEN=$(printf '%s' "$SIG_B64" | wc -c)

echo "DER signature raw bytes: $DER_LEN"
echo "Base64url signature chars: $SIG_B64_LEN"
echo ""
echo "If DER bytes ~70-72 and base64 chars ~96: WRONG (DER format)"
echo "If DER bytes = 64 and base64 chars = 86: CORRECT (raw R||S format)"
echo ""
echo "Sig base64url: $SIG_B64"
