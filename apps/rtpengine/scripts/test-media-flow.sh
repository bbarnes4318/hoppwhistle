#!/bin/bash
# Test script for media flow verification

set -e

RTPENGINE_HOST="${RTPENGINE_HOST:-localhost}"
RTPENGINE_PORT="${RTPENGINE_PORT:-9900}"

echo "Testing RTPEngine media flow..."
echo "================================"

# Test 1: Ping RTPEngine
echo "1. Testing RTPEngine connectivity..."
if rtpengine-ctl -t ${RTPENGINE_HOST}:${RTPENGINE_PORT} ping 2>/dev/null; then
    echo "   ✓ RTPEngine is responding"
else
    echo "   ✗ RTPEngine is not responding"
    exit 1
fi

# Test 2: List sessions
echo "2. Checking active sessions..."
SESSION_COUNT=$(rtpengine-ctl -t ${RTPENGINE_HOST}:${RTPENGINE_PORT} list 2>/dev/null | wc -l || echo "0")
echo "   Active sessions: $SESSION_COUNT"

# Test 3: Show statistics
echo "3. RTPEngine statistics:"
rtpengine-ctl -t ${RTPENGINE_HOST}:${RTPENGINE_PORT} stats 2>/dev/null || echo "   Statistics not available"

# Test 4: Check port availability
echo "4. Checking RTP port ranges..."
if netstat -ulnp 2>/dev/null | grep -q "10000"; then
    echo "   ✓ RTP ports are listening"
else
    echo "   ⚠ RTP ports may not be listening (this is normal if no active calls)"
fi

# Test 5: Check kernel parameters
echo "5. Checking kernel parameters..."
if [ -f /proc/sys/net/core/rmem_max ]; then
    RMEM_MAX=$(cat /proc/sys/net/core/rmem_max)
    if [ "$RMEM_MAX" -ge 16777216 ]; then
        echo "   ✓ net.core.rmem_max = $RMEM_MAX"
    else
        echo "   ⚠ net.core.rmem_max = $RMEM_MAX (recommended: >= 16777216)"
    fi
else
    echo "   ⚠ Cannot check kernel parameters (may need host system access)"
fi

echo ""
echo "Test complete!"

