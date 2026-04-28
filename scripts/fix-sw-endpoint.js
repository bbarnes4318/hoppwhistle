const https = require('https');

const SW_AUTH = Buffer.from('01a8aa68-cc95-492e-b9d8-605e2b3e74f6:PTe87f4727416c25cec62281bb1cc2ed43a58434515198d0b8').toString('base64');
const SIP_ENDPOINT_ID = '6f70b224-0bf8-4908-b955-3b51f740d98c';
// The Vapi Outbound Router SWML resource ID
const SWML_RESOURCE_ID = '19d29806-89f7-4574-ab50-71bd8e3ad35e';

const data = JSON.stringify({
  call_handler: 'relay_script',
  call_relay_script_url: 'https://pvn.signalwire.com/relay-bins/f55c006c-7c8b-48d2-bea5-34549d98ffaf'
});

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
    console.log('Status:', res.statusCode);
    console.log('Body:', body);
  });
});

req.write(data);
req.end();
