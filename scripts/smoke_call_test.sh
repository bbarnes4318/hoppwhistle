#!/usr/bin/env bash
set -e

echo "=== Voice Stack Smoke Test ==="
echo ""

# Check if running in Docker environment
if command -v docker &> /dev/null; then
    echo "Checking Docker containers..."
    
    # Check Kamailio
    if docker ps | grep -q sbc-kamailio; then
        echo "✓ Kamailio container is running"
    else
        echo "✗ Kamailio container is not running"
        exit 1
    fi
    
    # Check RTPEngine
    if docker ps | grep -q rtpengine; then
        echo "✓ RTPEngine container is running"
    else
        echo "✗ RTPEngine container is not running"
        exit 1
    fi
    
    # Check FreeSWITCH
    if docker ps | grep -q freeswitch; then
        echo "✓ FreeSWITCH container is running"
    else
        echo "✗ FreeSWITCH container is not running"
        exit 1
    fi
    
    echo ""
    echo "Checking service health..."
    
    # Check Kamailio process
    if docker exec sbc-kamailio pgrep -f kamailio > /dev/null 2>&1; then
        echo "✓ Kamailio process is running"
    else
        echo "✗ Kamailio process is not running"
        exit 1
    fi
    
    # Check RTPEngine process
    if docker exec rtpengine pgrep -f rtpengine > /dev/null 2>&1; then
        echo "✓ RTPEngine process is running"
    else
        echo "✗ RTPEngine process is not running"
        exit 1
    fi
    
    # Check FreeSWITCH process
    if docker exec freeswitch pgrep -f freeswitch > /dev/null 2>&1; then
        echo "✓ FreeSWITCH process is running"
    else
        echo "✗ FreeSWITCH process is not running"
        exit 1
    fi
    
    echo ""
    echo "Checking network ports..."
    
    # Check SIP ports (requires netstat or ss)
    if docker exec sbc-kamailio sh -c "netstat -tuln 2>/dev/null | grep -q ':5060' || ss -tuln 2>/dev/null | grep -q ':5060'"; then
        echo "✓ Kamailio listening on port 5060"
    else
        echo "⚠ Kamailio port 5060 check failed (may need netstat/ss)"
    fi
    
    if docker exec freeswitch sh -c "netstat -tuln 2>/dev/null | grep -q ':5080' || ss -tuln 2>/dev/null | grep -q ':5080'"; then
        echo "✓ FreeSWITCH listening on port 5080"
    else
        echo "⚠ FreeSWITCH port 5080 check failed (may need netstat/ss)"
    fi
    
    echo ""
    echo "Checking FreeSWITCH gateway registration..."
    if docker exec freeswitch fs_cli -x "sofia status gateway signalwire" 2>/dev/null | grep -q "REGED\|REGISTER"; then
        echo "✓ FreeSWITCH gateway registered to SignalWire"
    else
        echo "⚠ FreeSWITCH gateway registration check failed (may not be registered yet)"
    fi
    
    echo ""
    echo "=== Smoke Test Complete ==="
    echo ""
    echo "Next steps:"
    echo "1. Place a test call to your SignalWire DID"
    echo "2. Watch logs: docker logs -f sbc-kamailio freeswitch rtpengine"
    echo "3. Verify recording created in RECORDINGS_PATH"
    echo "4. Check API logs for recording.ready webhook"
    
else
    # Native installation check
    echo "Checking native processes..."
    
    if pgrep -f kamailio > /dev/null; then
        echo "✓ Kamailio process is running"
    else
        echo "✗ Kamailio process is not running"
        exit 1
    fi
    
    if pgrep -f rtpengine > /dev/null; then
        echo "✓ RTPEngine process is running"
    else
        echo "✗ RTPEngine process is not running"
        exit 1
    fi
    
    if pgrep -f freeswitch > /dev/null; then
        echo "✓ FreeSWITCH process is running"
    else
        echo "✗ FreeSWITCH process is not running"
        exit 1
    fi
    
    echo ""
    echo "=== Smoke Test Complete ==="
    echo ""
    echo "Next steps:"
    echo "1. Place a test call to your SignalWire DID"
    echo "2. Watch logs for all three services"
    echo "3. Verify recording created"
fi

