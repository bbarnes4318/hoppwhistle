const https = require('https');

const VAPI_KEY = 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const FREESWITCH_CREDENTIAL_ID = 'e842c05a-8ba4-4084-8af7-735611a5af23';
const PHONE_NUMBER_ID = 'a5855d7f-203a-4c07-9fb5-1bfe0fa71cfe';

// Switch phone number back to FreeSWITCH credential
const data = JSON.stringify({
  credentialId: FREESWITCH_CREDENTIAL_ID,
  name: 'SignalWire via FreeSWITCH +18036135410'
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
  res.on('data', (c) => body += c);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', body);
  });
});

req.write(data);
req.end();
