const https = require('https');

const data = JSON.stringify({
  contents: {
    "version": "1.0.0",
    "sections": {
      "main": [
        {
          "connect": {
            "answer_on_bridge": true,
            "from": "+18652679650",
            "to": "+%{call.to.replace(/^sip:\\+?/i, '').replace(/@.*/, '')}"
          }
        }
      ]
    }
  }
});

const opts = {
  hostname: 'pvn.signalwire.com',
  path: '/api/relay/rest/bins/f55c006c-7c8b-48d2-bea5-34549d98ffaf',
  method: 'PUT',
  headers: {
    'Authorization': 'Basic ' + Buffer.from('01a8aa68-cc95-492e-b9d8-605e2b3e74f6:PTe87f4727416c25cec62281bb1cc2ed43a58434515198d0b8').toString('base64'),
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(opts, (res) => {
  let b = '';
  res.on('data', c => b += c);
  res.on('end', () => console.log(b));
});
req.write(data);
req.end();
