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

// List of all symbols traded by the bot or available on MEXC that might have trades
const checkSymbols = [
  'ONDOUSDT', 'BTCUSDT', 'XRPUSDT', 'SOLUSDT', 'ETHUSDT', 'BNBUSDT', 'SUIUSDT', 'UNIUSDT', 'MXUSDT',
  'ADAUSDT', 'DOGEUSDT', 'PEPEUSDT', 'SHIBUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'NEARUSDT', 'APTUSDT'
];

async function run() {
  const ts = Date.now();
  console.log('Calculating exact breakdown of all trades...\n');

  let totalUSDTSpentAll = 0;
  let totalUSDTReceivedAll = 0;
  let totalUSDTFeesAll = 0;

  for (const sym of checkSymbols) {
    const trades = await apiRequest('/api/v3/myTrades', `symbol=${sym}&limit=1000&timestamp=${ts}`);
    if (!Array.isArray(trades) || trades.length === 0) continue;

    let buyUSDT = 0, sellUSDT = 0, feeUSDT = 0, feeMX = 0;
    let buyQty = 0, sellQty = 0;

    for (const t of trades) {
      const q = parseFloat(t.qty);
      const u = parseFloat(t.quoteQty);
      const f = parseFloat(t.commission || 0);
      const fa = t.commissionAsset || '';

      if (t.isBuyer) {
        buyQty += q;
        buyUSDT += u;
      } else {
        sellQty += q;
        sellUSDT += u;
      }

      if (fa === 'USDT') feeUSDT += f;
      if (fa === 'MX') feeMX += f;
    }

    totalUSDTSpentAll += buyUSDT;
    totalUSDTReceivedAll += sellUSDT;
    totalUSDTFeesAll += feeUSDT;

    const netCashflow = sellUSDT - buyUSDT;
    console.log(`${sym.padEnd(10)} | Buys: $${buyUSDT.toFixed(2).padStart(8)} | Sells: $${sellUSDT.toFixed(2).padStart(8)} | Net Cashflow: $${netCashflow.toFixed(2).padStart(7)} | Fee: $${feeUSDT.toFixed(2)} / ${feeMX.toFixed(4)} MX`);
  }

  console.log('─'.repeat(80));
  console.log(`TOTAL BUY SPENT:       $${totalUSDTSpentAll.toFixed(2)}`);
  console.log(`TOTAL SELL RECEIVED:   $${totalUSDTReceivedAll.toFixed(2)}`);
  console.log(`CASHFLOW DIFFERENCE:   $${(totalUSDTReceivedAll - totalUSDTSpentAll).toFixed(2)}`);
  console.log(`TOTAL USDT FEES PAID:  $${totalUSDTFeesAll.toFixed(2)}`);
}

run().catch(console.error);
