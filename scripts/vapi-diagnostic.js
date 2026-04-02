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

const VAPI_TOKEN = process.env.VAPI_API_TOKEN || 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';

function vapiRequest(method, apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.vapi.ai',
      port: 443,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${VAPI_TOKEN}`,
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
            reject(new Error(`API ${res.statusCode}: ${JSON.stringify(json)}`));
          }
        } catch {
          reject(new Error(`Parse error: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

async function runDiagnostic() {
  console.log('═'.repeat(60));
  console.log('  VAPI SIP Handshake Diagnostics');
  console.log('═'.repeat(60));

  try {
    const calls = await vapiRequest('GET', '/call?limit=5');
    console.log(`\nAnalyzing last ${calls.length} calls...\n`);

    for (const call of calls) {
      console.log(`[ID] ${call.id}`);
      console.log(`  Destination: ${call.customer?.number}`);
      console.log(`  State:       ${call.endedReason || call.status}`);
      
      // Check for SIP signaling details in the call object
      if (call.endedReason === 'error-sip-outbound-call-failed-to-connect') {
        console.log('  ⚠ Connection Failed Handshake');
      }

      // Check for SIP response codes if available in the transcription or metadata
      // Some Vapi responses have 'sipResponseCode' or similar in internal objects
      if (call.messages) {
        // ... search for 'failure'
      }
      
      console.log(`  Monitor:     https://vapi.ai/calls/${call.id}`);
      console.log('-'.repeat(60));
    }

  } catch (err) {
    console.error('\n✗ Diagnostic error:', err.message);
  }
}

runDiagnostic();
