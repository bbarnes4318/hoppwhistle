# SIP Test Harness

Automated SIP tests using SIPp (SIPp is a tool for testing SIP applications) to validate inbound/outbound call flows, IVR functionality, buyer failover, and recording edge cases.

## Prerequisites

- Docker and Docker Compose
- SIPp Docker image (automatically pulled): `sipwise/sipp:latest`
- Running docker-compose stack with Kamailio and FreeSWITCH

## Test Scenarios

### 1. Inbound IVR with DTMF (`inbound_ivr_dtmf.xml`)

Tests:

- Inbound call establishment through Kamailio
- IVR prompt playback
- DTMF digit collection (press "1")
- Call routing based on DTMF input
- Proper call teardown

**Expected Flow:**

1. INVITE sent to IVR endpoint
2. Call answered (200 OK)
3. IVR prompt plays
4. DTMF "1" sent via RFC 2833 (INFO)
5. Call routed based on DTMF
6. BYE sent and acknowledged

### 2. Buyer Failover (`buyer_failover.xml` + `buyer_failover_success.xml`)

Tests:

- First buyer endpoint fails (503 Service Unavailable)
- System automatically fails over to second buyer endpoint
- Second buyer accepts call successfully

**Expected Flow:**

1. INVITE sent to first buyer
2. First buyer responds with 503 (Service Unavailable)
3. System fails over to second buyer
4. Second buyer accepts call (200 OK)
5. Call established successfully
6. Call teardown

### 3. Long Recording Edge Cases (`long_recording.xml`)

Tests:

- Call establishment with recording enabled
- Long-duration call (5+ minutes) to test recording handling
- Proper call teardown after long recording
- Edge cases: recording limits, storage handling

**Expected Flow:**

1. INVITE sent with recording enabled
2. Call answered (200 OK)
3. Call maintained for 5 minutes
4. Recording continues throughout
5. BYE sent and acknowledged
6. Recording finalized and stored

## Running Tests

### Local Development

1. **Start the docker-compose stack:**

   ```bash
   cd infra/docker
   docker-compose up -d
   ```

2. **Wait for services to be ready:**

   ```bash
   docker-compose ps  # Verify all services are "Up"
   ```

3. **Run all SIP tests:**

   ```bash
   pnpm test:sip
   ```

   Or run the test script directly:

   ```bash
   node tests/sip/run-tests.js
   ```

   Or use the bash script (Linux/Mac):

   ```bash
   chmod +x tests/sip/run-tests.sh
   ./tests/sip/run-tests.sh
   ```

### CI/CD

The tests are designed to run in CI environments:

```bash
pnpm test:sip:ci
```

This will:

1. Check that docker-compose services are running
2. Wait for services to be ready
3. Run all test scenarios
4. Report pass/fail status
5. Exit with appropriate code (0 = success, 1 = failure)

## Configuration

Tests can be configured via environment variables:

```bash
export KAMAILIO_HOST=localhost      # Kamailio host (default: localhost)
export KAMAILIO_PORT=5060          # Kamailio port (default: 5060)
export BUYER_HOST=localhost        # Buyer endpoint host (default: localhost)
export BUYER_PORT=5061             # Buyer endpoint port (default: 5061)
```

## Test Output

Tests provide detailed output including:

- Test execution status
- SIP message traces (`-trace_msg`)
- Error traces (`-trace_err`)
- Statistics (`-trace_stat`)

Example output:

```
=== SIP Test Harness ===

Checking docker-compose services...
Waiting for services to be ready...

=== Running SIP Tests ===

Running: IVRTest
Scenario: inbound_ivr_dtmf.xml
Target: localhost:5060
✓ IVRTest PASSED

Running: BuyerFailover
Scenario: buyer_failover.xml
Target: localhost:5061
✓ BuyerFailover PASSED

Running: RecordingTest
Scenario: long_recording.xml
Target: localhost:5060
✓ RecordingTest PASSED

=== Test Summary ===
Passed: 3
Failed: 0

All tests passed!
```

## Troubleshooting

### Services Not Running

```
Error: Services are not running
```

**Solution:** Start docker-compose stack:

```bash
cd infra/docker && docker-compose up -d
```

### SIPp Container Issues

```
Error: Cannot connect to Docker daemon
```

**Solution:** Ensure Docker is running and you have permissions.

### Test Timeouts

If tests timeout, check:

1. Services are healthy: `docker-compose ps`
2. Ports are accessible: `telnet localhost 5060`
3. Firewall rules allow SIP traffic

### Long Recording Test Takes Too Long

The long recording test runs for 5 minutes by default. To reduce duration, modify `long_recording.xml`:

```xml
<pause milliseconds="60000"/>  <!-- 1 minute instead of 5 -->
```

## Adding New Test Scenarios

1. Create a new SIPp XML scenario file in `tests/sip/`
2. Follow the existing XML format (see examples)
3. Add test execution to `run-tests.js`:
   ```javascript
   runSippTest(
     'NewTestName',
     'new_scenario.xml',
     KAMAILIO_HOST,
     KAMAILIO_PORT,
     '-key service NewTest'
   );
   ```

## SIPp Documentation

- [SIPp User Guide](https://sipp.readthedocs.io/)
- [SIPp XML Scenario Reference](https://sipp.readthedocs.io/en/latest/scenarios.html)

## Integration with CI/CD

Example GitHub Actions workflow:

```yaml
name: SIP Tests

on: [push, pull_request]

jobs:
  sip-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start services
        run: |
          cd infra/docker
          docker-compose up -d
      - name: Wait for services
        run: sleep 30
      - name: Run SIP tests
        run: pnpm test:sip:ci
      - name: Cleanup
        if: always()
        run: |
          cd infra/docker
          docker-compose down
```
