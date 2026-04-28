const https = require('https');

// Step 1: Reset SignalWire SIP endpoint password
const SW_AUTH = Buffer.from('01a8aa68-cc95-492e-b9d8-605e2b3e74f6:PTe87f4727416c25cec62281bb1cc2ed43a58434515198d0b8').toString('base64');
const SIP_ENDPOINT_ID = '6f70b224-0bf8-4908-b955-3b51f740d98c';
const NEW_PASSWORD = 'Hopwhistle2026!';

// Step 2: Update Vapi credential with the password
const VAPI_KEY = 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const VAPI_CREDENTIAL_ID = '0d2c6892-fc34-44e4-9db6-11b6daae8eec';

function updateSignalWireEndpoint() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ password: NEW_PASSWORD });
    const opts = {
      hostname: 'pvn.signalwire.com',
      path: `/api/relay/rest/endpoints/sip/${SIP_ENDPOINT_ID}`,
      method: 'PUT',
      headers: {
        'Authorization': `Basic ${SW_AUTH}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        console.log('[SignalWire] Update SIP endpoint password:', res.statusCode);
        if (res.statusCode >= 200 && res.statusCode < 300) resolve();
        else { console.log(body); reject(new Error('SW update failed')); }
      });
    });
    req.write(data);
    req.end();
  });
}

function updateVapiCredential() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      outboundAuthenticationPlan: {
        authUsername: 'fe',
        authPassword: NEW_PASSWORD
      }
    });
    const opts = {
      hostname: 'api.vapi.ai',
      path: `/credential/${VAPI_CREDENTIAL_ID}`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${VAPI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        console.log('[Vapi] Update credential password:', res.statusCode);
        console.log(body);
        resolve();
      });
    });
    req.write(data);
    req.end();
  });
}

async function main() {
  try {
    await updateSignalWireEndpoint();
    console.log('SignalWire SIP endpoint password set.');
    await updateVapiCredential();
    console.log('Vapi credential updated with matching password.');
    console.log('Done! Try dispatching a call now.');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main();
