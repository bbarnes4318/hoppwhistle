#!/bin/sh
# Generate uppercase UUID
UUID=$(cat /proc/sys/kernel/random/uuid | tr '[a-z]' '[A-Z]')
IAT=$(date +%s)

echo "TESTING UPPERCASE UUID: $UUID"
echo "TIMESTAMP: $IAT"

curl -s -v -X POST "https://stir.bulkvs.com/stir/v1/signing?id=1ec857c693e7890f223a74a8a902fb48&key=807aad51f99255c416e18e07beae64b7" \
  -H "Content-Type: application/json" \
  -H "X-RequestID: $UUID" \
  -d "{\"signingRequest\":{\"attest\":\"A\",\"dest\":{\"tn\":[\"+18655991182\"]},\"orig\":{\"tn\":\"+12816989460\"},\"iat\":$IAT,\"origid\":\"$UUID\"}}"
