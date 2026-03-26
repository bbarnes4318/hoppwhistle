#!/bin/sh
# test_signed_call.sh — Originates a signed call through BulkVS
# Runs inside the FreeSWITCH container

DEST="15513326220"
ORIG="12816989460"
KEY="/etc/freeswitch/stir-shaken/private.key"
CERT_URL="https://hopwhistle.com/.well-known/stir-shaken/252L-20250710.crt"
IAT=$(date +%s)
ORIGID="TEST-$(date +%s)"

HEADER="{\"alg\":\"ES256\",\"ppt\":\"shaken\",\"typ\":\"passport\",\"x5u\":\"${CERT_URL}\"}"
PAYLOAD="{\"attest\":\"A\",\"dest\":{\"tn\":[\"+${DEST}\"]},\"iat\":${IAT},\"orig\":{\"tn\":\"+${ORIG}\"},\"origid\":\"${ORIGID}\"}"

H=$(printf '%s' "$HEADER" | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
P=$(printf '%s' "$PAYLOAD" | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "${H}.${P}" | /usr/bin/openssl dgst -sha256 -sign $KEY -binary | /usr/bin/openssl base64 -A | tr '+/' '-_' | tr -d '=')
IDENTITY="${H}.${P}.${SIG};info=<${CERT_URL}>;alg=ES256;ppt=shaken"

echo "=== IDENTITY HEADER COMPUTED ==="
echo "LENGTH: ${#IDENTITY}"
echo "PREVIEW: ${IDENTITY}" | head -c 120
echo "..."
echo ""

# Originate with the Identity header set as a channel variable
fs_cli -x "bgapi originate {origination_caller_id_number=${ORIG},origination_caller_id_name=PVN LLC,sip_h_Identity=${IDENTITY},absolute_codec_string=PCMU,originate_timeout=15}sofia/gateway/bulkvs/${DEST} &park"

echo ""
echo "Call originated — check SIP trace for Identity header"
