const https = require('https');

const VAPI_KEY = 'b8c9e434-32ca-4cbc-ae39-b6c4583622c2';
const ASSISTANT_ID = '531785b8-d0a1-4722-8083-72a705a5bb31';
const PHONE_NUMBER_ID = 'a5855d7f-203a-4c07-9fb5-1bfe0fa71cfe';

const data = JSON.stringify({
  assistantId: ASSISTANT_ID,
  phoneNumberId: PHONE_NUMBER_ID,
  customer: { number: '+18653969104' }
});

const opts = {
  hostname: 'api.vapi.ai',
  path: '/call/phone',
  method: 'POST',
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
    console.log('Body:', body);
  });
});

req.write(data);
req.end();
