const https = require('https');
require('dotenv').config();

const auth = Buffer.from(`${process.env.BULKVS_USERNAME}:${process.env.BULKVS_PASSWORD}`).toString('base64');
const options = {
  hostname: 'portal.bulkvs.com',
  port: 443,
  path: '/api/v1.0/availableTns?Npa=212',
  method: 'GET',
  headers: {
    'Authorization': 'Basic ' + auth,
    'Accept': 'application/json'
  }
};

const req = https.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);
  let data = '';
  res.on('data', d => {
    data += d;
  });
  res.on('end', () => {
    console.log(data.substring(0, 500));
  });
});

req.on('error', error => {
  console.error(error);
});

req.end();
