#!/bin/bash
# Fix the Vapi SignalWire credential:
# - Gateway points to SignalWire directly for outbound customer calls
# - Auth uses the SIP endpoint credentials (fe / Thunder3560)
curl -s -X PATCH \
  -H "Authorization: Bearer b8c9e434-32ca-4cbc-ae39-b6c4583622c2" \
  -H "Content-Type: application/json" \
  "https://api.vapi.ai/credential/0d2c6892-fc34-44e4-9db6-11b6daae8eec" \
  -d '{
    "gateways": [{
      "ip": "pvn-shanevici.sip.signalwire.com",
      "port": 5060,
      "netmask": 32,
      "inboundEnabled": false,
      "outboundEnabled": true,
      "outboundProtocol": "udp"
    }],
    "outboundAuthenticationPlan": {
      "authUsername": "fe",
      "authPassword": "Thunder3560"
    }
  }'
echo ""
echo "DONE"
