const fs = require('fs');
const https = require('https');

function request(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.mexc.com',
      port: 443,
      path: path,
      method: 'GET'
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.end();
  });
}

async function run() {
  try {
    const ondo = await request('/api/v3/ticker/price?symbol=ONDOUSDT');
    const btc = await request('/api/v3/ticker/price?symbol=BTCUSDT');
    console.log('CURRENT PRICES:');
    console.log(ondo);
    console.log(btc);
  } catch (e) {
    console.error(e.message);
  }
}
run();
