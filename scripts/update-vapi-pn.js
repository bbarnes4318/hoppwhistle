const https = require('https');

const VAPI_KEY = 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const PHONE_NUMBER_ID = 'a5855d7f-203a-4c07-9fb5-1bfe0fa71cfe';
const SIGNALWIRE_CREDENTIAL_ID = '0d2c6892-fc34-44e4-9db6-11b6daae8eec';

const data = JSON.stringify({
  credentialId: SIGNALWIRE_CREDENTIAL_ID,
  name: 'SignalWire DID +18036135410'
});

const opts = {
  hostname: 'api.vapi.ai',
  path: `/phone-number/${PHONE_NUMBER_ID}`,
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${VAPI_KEY}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(opts, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.write(data);
req.end();
