const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const creds = JSON.parse(fs.readFileSync('C:/Users/Hi/.gemini/antigravity/scratch/mexc-trailing-buy-bot/backend/config/credentials.json'));
const api_key = creds.apiKey;
const secret_key = creds.secretKey;

function getSignature(queryString) {
  return crypto.createHmac('sha256', secret_key).update(queryString).digest('hex');
}

function request(path, qs) {
  return new Promise((resolve, reject) => {
    const sig = getSignature(qs);
    const options = {
      hostname: 'api.mexc.com',
      port: 443,
      path: `${path}?${qs}&signature=${sig}`,
      method: 'GET',
      headers: {
        'X-MEXC-APIKEY': api_key
      }
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

async function getOpenOrders(symbol) {
  const timestamp = Date.now();
  const qs = `symbol=${symbol}&timestamp=${timestamp}`;
  return await request('/api/v3/openOrders', qs);
}

async function run() {
  try {
    const ondoOrders = await getOpenOrders('ONDOUSDT');
    console.log('--- ONDO OPEN ORDERS ---');
    console.log(JSON.stringify(ondoOrders, null, 2));

    const btcOrders = await getOpenOrders('BTCUSDT');
    console.log('--- BTC OPEN ORDERS ---');
    console.log(JSON.stringify(btcOrders, null, 2));
  } catch (e) {
    console.error(e.message);
  }
}
run();
