#!/usr/bin/env node
/**
 * SIP Test Runner (Node.js version for cross-platform support)
 * Runs SIPp test scenarios against the docker-compose stack
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;
const COMPOSE_FILE = path.join(TEST_DIR, '../infra/docker/docker-compose.yml');
const SIPP_IMAGE = 'sipwise/sipp:latest';

const KAMAILIO_HOST = process.env.KAMAILIO_HOST || 'localhost';
const KAMAILIO_PORT = process.env.KAMAILIO_PORT || '5060';
const BUYER_HOST = process.env.BUYER_HOST || 'localhost';
const BUYER_PORT = process.env.BUYER_PORT || '5061';

let testsPassed = 0;
let testsFailed = 0;

function log(message, color = '') {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
  };
  console.log(`${colors[color] || ''}${message}${colors.reset}`);
}

function checkServices() {
  log('Checking docker-compose services...', 'yellow');
  try {
    const output = execSync(
      `docker-compose -f "${COMPOSE_FILE}" ps`,
      { encoding: 'utf-8' }
    );
    if (!output.includes('kamailio') || !output.includes('Up')) {
      throw new Error('Kamailio service is not running');
    }
  } catch (error) {
    log('Error: Services are not running', 'red');
    log(`Please start services with: docker-compose -f ${COMPOSE_FILE} up -d`, 'yellow');
    process.exit(1);
  }
}

function runSippTest(testName, scenarioFile, remoteHost, remotePort, extraArgs = '') {
  log(`\nRunning: ${testName}`, 'yellow');
  log(`Scenario: ${scenarioFile}`);
  log(`Target: ${remoteHost}:${remotePort}`);

  // Handle both relative and absolute paths
  const scenarioPath = path.isAbsolute(scenarioFile)
    ? scenarioFile
    : path.join(TEST_DIR, path.basename(scenarioFile));
  
  if (!fs.existsSync(scenarioPath)) {
    log(`✗ Scenario file not found: ${scenarioPath}`, 'red');
    testsFailed++;
    return false;
  }

  try {
    const dockerCmd = [
      'docker run --rm',
      '--network host',
      `-v "${TEST_DIR}:/scenarios"`,
      SIPP_IMAGE,
      `-sf "/scenarios/${path.basename(scenarioFile)}"`,
      `-s ${testName}`,
      '-m 1',  // 1 call
      '-l 1',  // 1 call limit
      '-r 1',  // 1 call per second
      '-d 1000', // 1 second between calls
      `${remoteHost}:${remotePort}`,
      extraArgs,
      '-trace_msg',
      '-trace_err',
      '-trace_stat',
    ].filter(Boolean).join(' ');

    execSync(dockerCmd, {
      stdio: 'inherit',
      encoding: 'utf-8',
    });

    log(`✓ ${testName} PASSED`, 'green');
    testsPassed++;
    return true;
  } catch (error) {
    log(`✗ ${testName} FAILED`, 'red');
    testsFailed++;
    return false;
  }
}

function main() {
  log('=== SIP Test Harness ===\n', 'yellow');

  checkServices();

  log('Waiting for services to be ready...', 'yellow');
  // Wait 5 seconds for services
  const startTime = Date.now();
  while (Date.now() - startTime < 5000) {
    // Busy wait
  }

  log('\n=== Running SIP Tests ===\n', 'yellow');

  // Test 1: Inbound IVR with DTMF
  runSippTest(
    'IVRTest',
    'inbound_ivr_dtmf.xml',
    KAMAILIO_HOST,
    KAMAILIO_PORT,
    '-key service IVRTest'
  );

  // Test 2: Buyer Failover (first buyer fails)
  // This is expected to fail, so we don't count it as a failure
  try {
    runSippTest(
      'BuyerFailover',
      'buyer_failover.xml',
      BUYER_HOST,
      BUYER_PORT,
      '-key service buyer1'
    );
  } catch {
    // Expected failure for failover test
  }

  // Test 3: Long Recording
  runSippTest(
    'RecordingTest',
    'long_recording.xml',
    KAMAILIO_HOST,
    KAMAILIO_PORT,
    '-key service RecordingTest -d 300000' // 5 minute call
  );

  // Summary
  log('\n=== Test Summary ===', 'yellow');
  log(`Passed: ${testsPassed}`, 'green');
  log(`Failed: ${testsFailed}`, 'red');

  if (testsFailed === 0) {
    log('\nAll tests passed!', 'green');
    process.exit(0);
  } else {
    log('\nSome tests failed', 'red');
    process.exit(1);
  }
}

main();

