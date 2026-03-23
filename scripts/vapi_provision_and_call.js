#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports, @typescript-eslint/no-floating-promises, @typescript-eslint/no-var-requires */
/**
 * Vapi Provisioning and Call Script
 *
 * Creates BYO SIP trunk credential, BYO phone number, and places outbound call.
 *
 * Usage:
 *   VAPI_API_TOKEN=xxx node vapi_provision_and_call.js +18653969104
 *
 * Environment Variables:
 *   VAPI_API_TOKEN - Vapi private API key (required)
 *
 * The script will:
 *   1. Create BYO SIP trunk credential (or reuse existing)
 *   2. Create BYO phone number +18652809894 (or reuse existing)
 *   3. Place outbound call to the destination number
 */

const https = require('https');

// Configuration
const CONFIG = {
  VAPI_API_TOKEN: process.env.VAPI_API_TOKEN || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2',
  VAPI_ASSISTANT_ID: 'f6bcf4b4-8323-4bf8-a87d-a57d8dd9cd39',
  VAPI_PHONE_NUMBER_ID: '2a20e3b4-651e-4c8e-bcc8-9d9dd884785f', // Pre-provisioned phone number ID
  VAPI_FROM_NUMBER: '+18652809894',
  FREESWITCH_HOST: '45.32.213.201',
  FREESWITCH_PORT: 5070,
  SIP_USERNAME: 'vapi',
  SIP_PASSWORD: 'VapiFS_5070_StrongPass!9xQ2',
};

/**
 * Make HTTPS request to Vapi API
 */
function vapiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vapi.ai',
      port: 443,
      path: path,
      method: method,
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
            reject(new Error(`API Error ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * List existing credentials
 */
async function listCredentials() {
  console.log('\n[1] Checking existing credentials...');
  try {
    const credentials = await vapiRequest('GET', '/credential');
    return credentials;
  } catch (err) {
    console.log('  No existing credentials or error fetching:', err.message);
    return [];
  }
}

/**
 * Create BYO SIP Trunk Credential
 */
async function createSipTrunkCredential() {
  console.log('\n[2] Creating BYO SIP Trunk Credential...');

  const payload = {
    provider: 'byo-sip-trunk',
    name: 'FreeSWITCH Vapi Trunk',
    gateways: [
      {
        ip: CONFIG.FREESWITCH_HOST,
        port: CONFIG.FREESWITCH_PORT,
        netmask: 32,
        inboundEnabled: true, // Vapi sends calls TO our FreeSWITCH
        outboundEnabled: true,
        outboundProtocol: 'udp',
      },
    ],
    outboundAuthenticationPlan: {
      authUsername: CONFIG.SIP_USERNAME,
      authPassword: CONFIG.SIP_PASSWORD,
    },
  };

  console.log('  Payload:', JSON.stringify(payload, null, 2));

  try {
    const result = await vapiRequest('POST', '/credential', payload);
    console.log('  ✓ Credential created:', result.id);
    return result;
  } catch (err) {
    console.error('  ✗ Failed to create credential:', err.message);
    throw err;
  }
}

/**
 * List existing phone numbers
 */
async function listPhoneNumbers() {
  console.log('\n[3] Checking existing phone numbers...');
  try {
    const numbers = await vapiRequest('GET', '/phone-number');
    return numbers;
  } catch (err) {
    console.log('  No existing numbers or error fetching:', err.message);
    return [];
  }
}

/**
 * Create BYO Phone Number
 */
async function createPhoneNumber(credentialId) {
  console.log('\n[4] Creating BYO Phone Number...');

  const payload = {
    provider: 'byo-phone-number',
    number: CONFIG.VAPI_FROM_NUMBER,
    credentialId: credentialId,
    name: 'Hopwhistle Anveo DID',
  };

  console.log('  Payload:', JSON.stringify(payload, null, 2));

  try {
    const result = await vapiRequest('POST', '/phone-number', payload);
    console.log('  ✓ Phone number created:', result.id);
    return result;
  } catch (err) {
    console.error('  ✗ Failed to create phone number:', err.message);
    throw err;
  }
}

/**
 * Place outbound call
 */
async function placeCall(phoneNumberId, destinationNumber) {
  console.log('\n[5] Placing outbound call...');

  const payload = {
    assistantId: CONFIG.VAPI_ASSISTANT_ID,
    phoneNumberId: phoneNumberId,
    customer: {
      number: destinationNumber,
    },
  };

  console.log('  Payload:', JSON.stringify(payload, null, 2));

  try {
    const result = await vapiRequest('POST', '/call', payload);
    console.log('  ✓ Call initiated:', result.id);
    console.log('  Call Status:', result.status);
    return result;
  } catch (err) {
    console.error('  ✗ Failed to place call:', err.message);
    throw err;
  }
}

/**
 * Find existing credential by FreeSWITCH IP or create new
 */
async function getOrCreateCredential() {
  const credentials = await listCredentials();

  // Look for existing FreeSWITCH credential by IP
  const existing = Array.isArray(credentials)
    ? credentials.find(c => {
        if (c.provider !== 'byo-sip-trunk') return false;
        if (!c.gateways || !Array.isArray(c.gateways)) return false;
        // Check if any gateway points to our FreeSWITCH IP
        return c.gateways.some(g => g.ip === CONFIG.FREESWITCH_HOST);
      })
    : null;

  if (existing) {
    console.log('  Found existing FreeSWITCH credential:', existing.id);

    // Check if inboundEnabled is correct
    const gateway = existing.gateways?.find(g => g.ip === CONFIG.FREESWITCH_HOST);
    if (gateway && gateway.inboundEnabled === false) {
      console.log('  ⚠ Gateway has inboundEnabled=false, fixing...');
      await updateCredentialGateway(existing.id);
    }

    return existing;
  }

  console.log('  No existing FreeSWITCH credential found, creating new...');
  return await createSipTrunkCredential();
}

/**
 * Update credential gateway to enable inbound
 */
async function updateCredentialGateway(credentialId) {
  console.log(`\n[1a] Updating credential ${credentialId} gateway settings...`);

  const payload = {
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
  };

  console.log('  Payload:', JSON.stringify(payload, null, 2));

  try {
    const result = await vapiRequest('PATCH', `/credential/${credentialId}`, payload);
    console.log('  ✓ Credential gateway updated');
    return result;
  } catch (err) {
    console.error('  ✗ Failed to update credential gateway:', err.message);
    throw err;
  }
}

/**
 * Update phone number to use new credential
 */
async function updatePhoneNumberCredential(phoneNumberId, credentialId) {
  console.log(`\n[4a] Updating phone number ${phoneNumberId} to use credential ${credentialId}...`);

  const payload = {
    credentialId: credentialId,
  };

  try {
    const result = await vapiRequest('PATCH', `/phone-number/${phoneNumberId}`, payload);
    console.log('  ✓ Phone number credential updated');
    return result;
  } catch (err) {
    console.error('  ✗ Failed to update phone number credential:', err.message);
    throw err;
  }
}

/**
 * Find existing phone number or create new
 */
async function getOrCreatePhoneNumber(credentialId) {
  const numbers = await listPhoneNumbers();

  // Look for our DID
  const existing = Array.isArray(numbers)
    ? numbers.find(n => n.number === CONFIG.VAPI_FROM_NUMBER)
    : null;

  if (existing) {
    console.log('  Found existing phone number:', existing.id);

    // Check if the credential matches
    if (existing.credentialId !== credentialId) {
      console.log(`  ⚠ Phone number uses wrong credential: ${existing.credentialId}`);
      console.log(`  ⚠ Expected credential: ${credentialId}`);
      return await updatePhoneNumberCredential(existing.id, credentialId);
    }

    return existing;
  }

  return await createPhoneNumber(credentialId);
}

/**
 * Main execution
 */
async function main() {
  const destinationNumber = process.argv[2];

  if (!destinationNumber) {
    console.error('Usage: node vapi_provision_and_call.js <destination_e164>');
    console.error('Example: node vapi_provision_and_call.js +18653969104');
    process.exit(1);
  }

  // Validate E.164 format
  if (!destinationNumber.match(/^\+?1?\d{10,15}$/)) {
    console.error('Error: Destination must be E.164 format (e.g., +18653969104)');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Vapi Provisioning and Call Script');
  console.log('='.repeat(60));
  console.log('Configuration:');
  console.log('  Assistant ID:', CONFIG.VAPI_ASSISTANT_ID);
  console.log('  From Number:', CONFIG.VAPI_FROM_NUMBER);
  console.log('  FreeSWITCH:', `${CONFIG.FREESWITCH_HOST}:${CONFIG.FREESWITCH_PORT}`);
  console.log('  Destination:', destinationNumber);
  console.log('='.repeat(60));

  try {
    let phoneNumberId;

    // Check if we have a pre-configured phone number ID (skip provisioning)
    if (CONFIG.VAPI_PHONE_NUMBER_ID) {
      console.log(
        '\n[FAST MODE] Using pre-configured Phone Number ID:',
        CONFIG.VAPI_PHONE_NUMBER_ID
      );
      phoneNumberId = CONFIG.VAPI_PHONE_NUMBER_ID;
    } else {
      // Step 1-2: Get or create SIP trunk credential
      const credential = await getOrCreateCredential();

      // Step 3-4: Get or create phone number
      const phoneNumber = await getOrCreatePhoneNumber(credential.id);
      phoneNumberId = phoneNumber.id;
      console.log('Credential ID:', credential.id);
    }

    // Step 5: Place the call
    const call = await placeCall(phoneNumberId, destinationNumber);

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log('Phone Number ID:', phoneNumberId);
    console.log('Call ID:', call.id);
    console.log('Call Status:', call.status);
    console.log('\nFull Call Response:');
    console.log(JSON.stringify(call, null, 2));
  } catch (err) {
    console.error('\n✗ Error:', err.message);
    process.exit(1);
  }
}

main();
