#!/bin/bash
# SIP Test Runner
# Runs SIPp test scenarios against the docker-compose stack

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
SIPP_IMAGE="sipwise/sipp:latest"
TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${TEST_DIR}/../infra/docker/docker-compose.yml"
KAMAILIO_HOST="${KAMAILIO_HOST:-localhost}"
KAMAILIO_PORT="${KAMAILIO_PORT:-5060}"
BUYER_HOST="${BUYER_HOST:-localhost}"
BUYER_PORT="${BUYER_PORT:-5061}"

# Test results
TESTS_PASSED=0
TESTS_FAILED=0

echo -e "${YELLOW}=== SIP Test Harness ===${NC}\n"

# Check if docker-compose services are running
echo "Checking docker-compose services..."
if ! docker-compose -f "$COMPOSE_FILE" ps | grep -q "kamailio.*Up"; then
    echo -e "${RED}Error: Kamailio service is not running${NC}"
    echo "Please start services with: docker-compose -f $COMPOSE_FILE up -d"
    exit 1
fi

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 5

# Function to run a SIPp test
run_sipp_test() {
    local test_name=$1
    local scenario_file=$2
    local remote_host=$3
    local remote_port=$4
    local extra_args="${5:-}"

    echo -e "\n${YELLOW}Running: $test_name${NC}"
    echo "Scenario: $scenario_file"
    echo "Target: $remote_host:$remote_port"

    # Run SIPp in docker container
    if docker run --rm \
        --network host \
        -v "${TEST_DIR}:/scenarios" \
        "$SIPP_IMAGE" \
        -sf "/scenarios/$(basename "$scenario_file")" \
        -s "$test_name" \
        -m 1 \
        -l 1 \
        -r 1 \
        -d 1000 \
        "$remote_host:$remote_port" \
        $extra_args \
        -trace_msg \
        -trace_err \
        -trace_stat; then
        echo -e "${GREEN}✓ $test_name PASSED${NC}"
        ((TESTS_PASSED++))
        return 0
    else
        echo -e "${RED}✗ $test_name FAILED${NC}"
        ((TESTS_FAILED++))
        return 1
    fi
}

# Run tests
echo -e "\n${YELLOW}=== Running SIP Tests ===${NC}\n"

# Test 1: Inbound IVR with DTMF
run_sipp_test \
    "IVRTest" \
    "${TEST_DIR}/inbound_ivr_dtmf.xml" \
    "$KAMAILIO_HOST" \
    "$KAMAILIO_PORT" \
    "-key service IVRTest"

# Test 2: Buyer Failover (first buyer fails)
# This test simulates a buyer endpoint that fails
run_sipp_test \
    "BuyerFailover" \
    "${TEST_DIR}/buyer_failover.xml" \
    "$BUYER_HOST" \
    "$BUYER_PORT" \
    "-key service buyer1" || true  # Expected to fail

# Test 3: Long Recording
run_sipp_test \
    "RecordingTest" \
    "${TEST_DIR}/long_recording.xml" \
    "$KAMAILIO_HOST" \
    "$KAMAILIO_PORT" \
    "-key service RecordingTest -d 300000"  # 5 minute call

# Summary
echo -e "\n${YELLOW}=== Test Summary ===${NC}"
echo -e "${GREEN}Passed: $TESTS_PASSED${NC}"
echo -e "${RED}Failed: $TESTS_FAILED${NC}"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}Some tests failed${NC}"
    exit 1
fi

