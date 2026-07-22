const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const creds = JSON.parse(fs.readFileSync('C:/Users/Hi/.gemini/antigravity/scratch/mexc-trailing-buy-bot/backend/config/credentials.json'));
const api_key = creds.apiKey;
const secret_key = creds.secretKey;

function getSignature(qs) {
  return crypto.createHmac('sha256', secret_key).update(qs).digest('hex');
}

function apiRequest(path, qs) {
  return new Promise((resolve, reject) => {
    const sig = getSignature(qs);
    const options = {
      hostname: 'api.mexc.com', port: 443,
      path: `${path}?${qs}&signature=${sig}`,
      method: 'GET',
      headers: { 'X-MEXC-APIKEY': api_key }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  const ts = Date.now();
  
  // 1. Deposits
  try {
    const deposits = await apiRequest('/api/v3/capital/deposit/hisrec', `timestamp=${ts}`);
    console.log('--- DEPOSIT HISTORY ---');
    console.log(JSON.stringify(deposits, null, 2));
  } catch (e) {
    console.log('Deposit error:', e.message);
  }

  // 2. Account balances right now
  const account = await apiRequest('/api/v3/account', `timestamp=${ts}`);
  console.log('\n--- LIVE ACCOUNT BALANCES ---');
  const activeBals = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
  console.log(JSON.stringify(activeBals, null, 2));

  // Calculate exact total portfolio value right now
  let usdtTotal = 0;
  for (const b of account.balances) {
    const free = parseFloat(b.free);
    const locked = parseFloat(b.locked);
    const total = free + locked;
    if (total <= 0) continue;

    if (b.asset === 'USDT') {
      usdtTotal += total;
      console.log(`Asset: USDT | Free: ${free} | Locked: ${locked} | Value: $${total}`);
    } else {
      // get ticker price
      try {
        const res = await new Promise((res2, rej2) => {
          https.get(`https://api.mexc.com/api/v3/ticker/price?symbol=${b.asset}USDT`, r => {
            let d = ''; r.on('data', c => d += c);
            r.on('end', () => res2(JSON.parse(d)));
          }).on('error', rej2);
        });
        if (res.price) {
          const val = total * parseFloat(res.price);
          usdtTotal += val;
          console.log(`Asset: ${b.asset} | Qty: ${total} | Price: $${res.price} | Value: $${val.toFixed(4)}`);
        }
      } catch (e) {
        console.log(`Asset: ${b.asset} (no price)`);
      }
    }
  }

  console.log(`\nTOTAL ACCOUNT VALUE RIGHT NOW (API): $${usdtTotal.toFixed(4)}`);
}

run().catch(console.error);
