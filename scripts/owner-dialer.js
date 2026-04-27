#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports, @typescript-eslint/no-floating-promises, @typescript-eslint/no-var-requires */
/**
 * Owner Dialer — DID Rotation + 10 Concurrent + No Billing
 *
 * Strategy: Fire-and-backoff. For each contact, try to place the call.
 * If Vapi returns "Over Concurrency Limit", wait and retry (up to 5 times).
 * This respects Vapi's internal concurrency tracker without needing to poll.
 *
 * Resume support: Saves progress to .dialer-progress.json so restarts
 * pick up where they left off. Use --fresh to start over.
 *
 * Usage:
 *   node scripts/owner-dialer.js --file contacts.txt
 *   node scripts/owner-dialer.js --file contacts.txt --fresh
 *   node scripts/owner-dialer.js +18653969104
 *   node scripts/owner-dialer.js --provision-only
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ============================================================================
// Load .env
// ============================================================================
function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        process.env[key] = value;
      }
    });
  }
}
loadEnv();

const CONFIG = {
  VAPI_API_TOKEN: process.env.VAPI_API_TOKEN || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2',
  ASSISTANT_ID: '1fc88d85-4c44-4399-9345-f601628e64fb',

  // BulkVS / FreeSWITCH carrier (default)
  FREESWITCH_HOST: '3.214.60.13',
  FREESWITCH_PORT: 5070,
  SIP_USERNAME: 'vapi',
  SIP_PASSWORD: 'VapiFS_5070_StrongPass!9xQ2',

  // Merged DID pool — SignalWire DIDs first, then BulkVS DIDs for rotation
  DIDS: [
    // SignalWire DIDs
    '+18652679650',
    '+17253022220',
    // BulkVS DIDs
    '+12816989460',
    '+12816989461',
    '+14063165877',
    '+14402992856',
    '+14402992860',
    '+16102819660',
    '+16102819662',
    '+17038313168',
    '+17042283589',
    '+17042286088',
    '+18036135410',
    '+18036135412',
    '+19124185540',
    '+19124185542',
    '+19542083921',
    '+19542083922',
  ],

  // SignalWire carrier
  SIGNALWIRE_SIP_DOMAIN: process.env.SIGNALWIRE_OUTBOUND_PROXY || 'pvn-shanevici.sip.signalwire.com',
  SIGNALWIRE_DIDS: (process.env.SIGNALWIRE_DIDS || '+18652679650,+17253022220').split(','),
  SIGNALWIRE_PROJECT_ID: process.env.SIGNALWIRE_PROJECT_ID,
  SIGNALWIRE_API_TOKEN: process.env.SIGNALWIRE_API_TOKEN || process.env.SIGNALWIRE_TOKEN,

  MAX_CONCURRENT: 5,
  DISPATCH_DELAY_MS: 4000, // 4s between dispatches — steady pace for SignalWire
  BACKOFF_MS: 45000, // 45s wait when concurrency-limited
  MAX_RETRIES: 5, // Retry up to 5 times per number
};

// ============================================================================
// State
// ============================================================================

let didPool = [];
let didIndex = 0;
let totalDispatched = 0;
let totalSuccess = 0;
let totalFailed = 0;
let totalSkipped = 0;
const callResults = [];

// Progress tracking file — lives next to the contacts file
const PROGRESS_FILE = path.join(__dirname, '.dialer-progress.json');

function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      return new Set(data.calledNumbers || []);
    }
  } catch {
    // Corrupt file — start fresh
  }
  return new Set();
}

function saveProgress(calledNumbers) {
  const data = {
    calledNumbers: [...calledNumbers],
    lastUpdated: new Date().toISOString(),
    count: calledNumbers.size,
  };
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data, null, 2));
}

// ============================================================================
// Vapi API Helper
// ============================================================================

function vapiRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vapi.ai',
      port: 443,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.VAPI_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(json);
          } else {
            reject(new Error(`API ${res.statusCode}: ${JSON.stringify(json).substring(0, 300)}`));
          }
        } catch {
          reject(new Error(`Parse error: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================================
// Provisioning
// ============================================================================

async function getOrCreateCredential() {
  console.log('\n[PROVISION] Checking BYO SIP trunk credentials...');
  let credentials = [];
  try {
    credentials = await vapiRequest('GET', '/credential');
  } catch (err) {
    console.log('  Could not list credentials:', err.message);
  }

  const existing = Array.isArray(credentials)
    ? credentials.find(c => {
        if (c.provider !== 'byo-sip-trunk') return false;
        if (!c.gateways || !Array.isArray(c.gateways)) return false;
        return c.gateways.some(g => g.ip === CONFIG.FREESWITCH_HOST);
      })
    : null;

  if (existing) {
    console.log(`  ✓ Found existing credential: ${existing.id}`);
    const gw = existing.gateways && existing.gateways.find(g => g.ip === CONFIG.FREESWITCH_HOST);
    if (gw && gw.inboundEnabled === false) {
      console.log('  ⚠ Fixing inboundEnabled=false...');
      await vapiRequest('PATCH', `/credential/${existing.id}`, {
        gateways: [
          {
            ip: CONFIG.FREESWITCH_HOST,
            port: CONFIG.FREESWITCH_PORT,
            netmask: 32,
            inboundEnabled: true,
            outboundEnabled: true,
            outboundProtocol: 'udp',
          },
        ],
      });
      console.log('  ✓ Fixed');
    }
    return existing;
  }

  console.log('  Creating new BYO SIP trunk credential...');
  const result = await vapiRequest('POST', '/credential', {
    provider: 'byo-sip-trunk',
    name: 'FreeSWITCH Vapi Trunk',
    gateways: [
      {
        ip: CONFIG.FREESWITCH_HOST,
        port: CONFIG.FREESWITCH_PORT,
        netmask: 32,
        inboundEnabled: true,
        outboundEnabled: true,
        outboundProtocol: 'udp',
      },
    ],
    outboundAuthenticationPlan: {
      authUsername: CONFIG.SIP_USERNAME,
      authPassword: CONFIG.SIP_PASSWORD,
    },
  });
  console.log(`  ✓ Created credential: ${result.id}`);
  return result;
}

/**
 * Get the existing FreeSWITCH BYO SIP trunk credential for SignalWire routing.
 * Calls go: Vapi → FreeSWITCH:5070 (vapi profile) → sofia/gateway/signalwire → PSTN
 * Uses the same working credential that handles all BYO outbound calls.
 */
async function getOrCreateSignalWireCredential() {
  console.log('\n[PROVISION] Checking FreeSWITCH SIP trunk for SignalWire routing...');
  let credentials = [];
  try {
    credentials = await vapiRequest('GET', '/credential');
  } catch (err) {
    console.log('  Could not list credentials:', err.message);
  }

  // Use the existing working FreeSWITCH credential (routes to vapi profile on 5070)
  const existing = Array.isArray(credentials)
    ? credentials.find(c => {
        if (c.provider !== 'byo-sip-trunk') return false;
        // Match the known working FreeSWITCH credential
        if (c.name === 'FreeSWITCH AWS (3.214.60.13)') return true;
        if (c.name === 'FreeSWITCH Vapi Trunk') return true;
        // Fallback: any credential pointing to our FreeSWITCH on port 5070
        return c.gateways && c.gateways.some(g => g.ip === '3.214.60.13' && g.port === 5070 && g.inboundEnabled === true);
      })
    : null;

  if (existing) {
    console.log(`  ✓ Using FreeSWITCH credential: ${existing.id} (${existing.name})`);
    return existing;
  }

  // If somehow missing, create a new one matching the working config
  console.log('  Creating new FreeSWITCH SIP trunk credential...');
  const result = await vapiRequest('POST', '/credential', {
    provider: 'byo-sip-trunk',
    name: 'FreeSWITCH AWS (3.214.60.13)',
    gateways: [
      {
        ip: '3.214.60.13',
        port: 5070,
        netmask: 32,
        inboundEnabled: true,
        outboundEnabled: true,
        outboundProtocol: 'udp',
      },
    ],
    outboundAuthenticationPlan: {
      authUsername: 'vapi',
    },
  });
  console.log(`  ✓ Created FreeSWITCH credential: ${result.id}`);
  return result;
}

async function provisionDIDs(credentialId, dids) {
  console.log('\n[PROVISION] Registering DID pool in Vapi...');
  let existingNumbers = [];
  try {
    existingNumbers = await vapiRequest('GET', '/phone-number');
    if (!Array.isArray(existingNumbers)) existingNumbers = [];
  } catch {
    existingNumbers = [];
  }

  const pool = [];
  for (const did of dids) {
    const existing = existingNumbers.find(n => n.number === did);
    if (existing) {
      if (existing.credentialId !== credentialId) {
        console.log(`  ⚠ ${did} bound to wrong credential, rebinding...`);
        await vapiRequest('PATCH', `/phone-number/${existing.id}`, { credentialId });
        console.log(`  ✓ ${did} rebound → ${existing.id}`);
      } else {
        console.log(`  ✓ ${did} already provisioned → ${existing.id}`);
      }
      pool.push({ did, vapiPhoneId: existing.id });
    } else {
      try {
        const result = await vapiRequest('POST', '/phone-number', {
          provider: 'byo-phone-number',
          number: did,
          credentialId,
          name: `Owner DID ${did}`,
        });
        console.log(`  ✓ ${did} created → ${result.id}`);
        pool.push({ did, vapiPhoneId: result.id });
      } catch (err) {
        console.error(`  ✗ ${did} FAILED: ${err.message}`);
      }
    }
  }
  return pool;
}

// ============================================================================
// Dialer Engine — Fire & Backoff
// ============================================================================

function getNextDID() {
  const entry = didPool[didIndex % didPool.length];
  didIndex++;
  return entry;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function placeCall(destinationNumber, didEntry) {
  try {
    const result = await vapiRequest('POST', '/call', {
      assistantId: CONFIG.ASSISTANT_ID,
      phoneNumberId: didEntry.vapiPhoneId,
      customer: { number: destinationNumber },
    });
    return {
      success: true,
      destination: destinationNumber,
      did: didEntry.did,
      callId: result.id,
      status: result.status,
    };
  } catch (err) {
    const msg = err.message || '';
    const retryable =
      msg.includes('Concurrency') ||
      msg.includes('concurrency') ||
      msg.includes('Over Concurrency');
    return {
      success: false,
      destination: destinationNumber,
      did: didEntry.did,
      error: msg,
      retryable,
    };
  }
}

async function dialWithRetry(number, callNum, didEntry) {
  for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
    if (attempt === 1) {
      console.log(`  [${callNum}] 📞 ${number} via ${didEntry.did}`);
    } else {
      // On retry, rotate to a different DID
      didEntry = didPool[(didPool.indexOf(didEntry) + attempt) % didPool.length];
      console.log(
        `  [${callNum}] 🔄 Retry ${attempt}/${CONFIG.MAX_RETRIES} — ${number} via ${didEntry.did}`
      );
    }

    const result = await placeCall(number, didEntry);

    if (result.success) {
      console.log(`  [${callNum}] ✓ ${result.callId} → ${result.status}`);
      return result;
    }

    if (result.retryable && attempt < CONFIG.MAX_RETRIES) {
      console.log(`  [${callNum}] ⏳ At capacity — waiting ${CONFIG.BACKOFF_MS / 1000}s...`);
      await sleep(CONFIG.BACKOFF_MS);
      continue;
    }

    console.log(`  [${callNum}] ✗ FAILED: ${result.error}`);
    return result;
  }
}

async function runDialer(contacts, calledNumbers) {
  console.log(`\n[DIALER] Starting — ${contacts.length} contacts, ${didPool.length} DIDs`);
  if (totalSkipped > 0) {
    console.log(`  Resumed — ${totalSkipped} already called, ${contacts.length} remaining`);
  }
  console.log(`  Concurrency: ${CONFIG.MAX_CONCURRENT} (TRUE PARALLEL)`);
  console.log(`  Dispatch delay: ${CONFIG.DISPATCH_DELAY_MS / 1000}s between launches`);
  console.log(
    `  Backoff: ${CONFIG.BACKOFF_MS / 1000}s on limit, up to ${CONFIG.MAX_RETRIES} retries`
  );
  console.log('─'.repeat(60));

  // ── True concurrent worker pool ──
  let activeCount = 0;
  let contactIdx = 0;
  let resolveSlot = null; // resolver for waiting on a free slot

  function onSlotFreed() {
    if (resolveSlot) {
      const r = resolveSlot;
      resolveSlot = null;
      r();
    }
  }

  function waitForSlot() {
    if (activeCount < CONFIG.MAX_CONCURRENT) return Promise.resolve();
    return new Promise(resolve => { resolveSlot = resolve; });
  }

  async function processContact(contact, idx, didEntry) {
    const callNum = totalSkipped + idx + 1;
    totalDispatched++;

    const result = await dialWithRetry(contact, callNum, didEntry);

    if (result && result.success) {
      totalSuccess++;
    } else {
      totalFailed++;
    }

    // Track progress
    calledNumbers.add(contact);
    saveProgress(calledNumbers);

    callResults.push({
      ...(result || { destination: contact, error: 'max retries' }),
      callNum,
      timestamp: new Date().toISOString(),
    });

    // Progress update every 50 calls
    const totalProcessed = totalSuccess + totalFailed;
    if (totalProcessed % 50 === 0) {
      console.log(
        `\n  ── Progress: ${totalProcessed}/${contacts.length} (${totalSuccess} ok, ${totalFailed} failed, ${activeCount} in-flight) ──\n`
      );
    }

    // Free the slot
    activeCount--;
    onSlotFreed();
  }

  // Launch calls with staggered dispatch, up to MAX_CONCURRENT in parallel
  const inflight = [];

  while (contactIdx < contacts.length) {
    // Wait until there's a free concurrency slot
    await waitForSlot();

    // Stagger launches so we don't hammer the API all at once
    if (contactIdx > 0) {
      await sleep(CONFIG.DISPATCH_DELAY_MS);
    }

    // Grab next contact and assign a DID (round-robin across pool)
    const contact = contacts[contactIdx];
    const idx = contactIdx;
    const didEntry = didPool[contactIdx % didPool.length];
    contactIdx++;
    activeCount++;

    // Fire-and-forget into the pool (don't await here — that's the whole point)
    const task = processContact(contact, idx, didEntry);
    inflight.push(task);
  }

  // Wait for all remaining in-flight calls to finish
  await Promise.all(inflight);
}

// ============================================================================
// Contact Parsing
// ============================================================================

function parseContacts(args) {
  const contacts = [];
  const fileIdx = args.indexOf('--file');

  if (fileIdx !== -1 && args[fileIdx + 1]) {
    const filePath = path.resolve(args[fileIdx + 1]);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(1);
    }
    const lines = fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    for (const line of lines) {
      const phone = line
        .split(',')[0]
        .trim()
        .replace(/[^\d+]/g, '');
      if (phone.length >= 10) contacts.push(phone.startsWith('+') ? phone : `+1${phone}`);
    }
  } else {
    for (const arg of args) {
      if (arg.startsWith('--')) continue;
      const phone = arg.trim().replace(/[^\d+]/g, '');
      if (phone.length >= 10) contacts.push(phone.startsWith('+') ? phone : `+1${phone}`);
    }
  }

  return [...new Set(contacts)];
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const provisionOnly = args.includes('--provision-only');
  const freshStart = args.includes('--fresh');

  if (args.length === 0) {
    console.log(`
Owner Dialer — DID Rotation + Resume Support

Usage:
  node scripts/owner-dialer.js --file contacts.txt
  node scripts/owner-dialer.js --file contacts.txt --fresh   (start over)
  node scripts/owner-dialer.js --file contacts.txt --carrier signalwire
  node scripts/owner-dialer.js <number> [number2] ...
  node scripts/owner-dialer.js --provision-only

DID Pool: ${CONFIG.DIDS.join(', ')}
Assistant: ${CONFIG.ASSISTANT_ID}
    `);
    process.exit(0);
  }

  console.log('═'.repeat(60));
  console.log('  OWNER DIALER');
  console.log('  DID Rotation • Resume Support • No Billing');
  console.log('═'.repeat(60));
  console.log(`  Assistant:  ${CONFIG.ASSISTANT_ID}`);
  console.log(`  DIDs:       ${CONFIG.DIDS.join(', ')}`);
  console.log(`  Concurrent: ${CONFIG.MAX_CONCURRENT}`);
  console.log(`  FreeSWITCH: ${CONFIG.FREESWITCH_HOST}:${CONFIG.FREESWITCH_PORT}`);
  console.log('═'.repeat(60));

  // Determine carrier
  const carrierIdx = args.indexOf('--carrier');
  const carrier = carrierIdx !== -1 && args[carrierIdx + 1] ? args[carrierIdx + 1].toLowerCase() : 'signalwire';
  const isSignalWire = carrier === 'signalwire';

  if (isSignalWire) {
    console.log('\n  🔀 CARRIER: SignalWire (no STIR/SHAKEN signing)');
  } else {
    console.log('\n  🔀 CARRIER: BulkVS / FreeSWITCH (with STIR/SHAKEN signing)');
  }

  // Phase 1: Provision
  let credential;
  if (isSignalWire) {
    credential = await getOrCreateSignalWireCredential();
  } else {
    credential = await getOrCreateCredential();
  }

  const activeDIDs = isSignalWire ? CONFIG.SIGNALWIRE_DIDS : CONFIG.DIDS;
  didPool = await provisionDIDs(credential.id, activeDIDs);

  if (didPool.length === 0) {
    console.error('\n✗ No DIDs provisioned. Aborting.');
    process.exit(1);
  }

  console.log(`\n[PROVISION] ✓ ${didPool.length} DIDs ready:`);
  didPool.forEach(e => console.log(`  • ${e.did} → ${e.vapiPhoneId}`));

  if (provisionOnly) {
    console.log('\n[DONE] Provision-only mode — no calls placed.');
    process.exit(0);
  }

  // Phase 2: Parse contacts
  let allContacts = parseContacts(args);
  if (allContacts.length === 0) {
    console.error('\n✗ No valid contacts found.');
    process.exit(1);
  }

  // Phase 2.5: Resume — filter out already-called numbers
  let calledNumbers;
  if (freshStart) {
    calledNumbers = new Set();
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
    console.log(`\n[CONTACTS] ${allContacts.length} total — FRESH START (progress cleared)`);
  } else {
    calledNumbers = loadProgress();
    if (calledNumbers.size > 0) {
      const before = allContacts.length;
      allContacts = allContacts.filter(n => !calledNumbers.has(n));
      totalSkipped = before - allContacts.length;
      console.log(`\n[RESUME] Found ${calledNumbers.size} already called`);
      console.log(`  Skipping ${totalSkipped}, ${allContacts.length} remaining`);
    } else {
      console.log(`\n[CONTACTS] ${allContacts.length} unique number(s) to dial`);
    }
  }

  if (allContacts.length === 0) {
    console.log('\n✓ All contacts have already been called! Use --fresh to start over.');
    process.exit(0);
  }

  // Phase 3: Dial
  const startTime = Date.now();
  await runDialer(allContacts, calledNumbers);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Phase 4: Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  SUMMARY');
  console.log('═'.repeat(60));
  if (totalSkipped > 0) console.log(`  Resumed from: ${totalSkipped} (previously called)`);
  console.log(`  Dispatched:   ${totalDispatched}`);
  console.log(`  Success:      ${totalSuccess}`);
  console.log(`  Failed:       ${totalFailed}`);
  console.log(`  Total called: ${calledNumbers.size}`);
  console.log(`  Elapsed:      ${elapsed}s`);
  console.log('═'.repeat(60));

  const resultsPath = path.join(__dirname, `dialer-results-${Date.now()}.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(callResults, null, 2));
  console.log(`\n  Results saved to: ${resultsPath}`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err.message);
  process.exit(1);
});
