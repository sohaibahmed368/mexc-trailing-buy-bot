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

const checkSymbols = [
  'ONDOUSDT', 'BTCUSDT', 'XRPUSDT', 'SOLUSDT', 'ETHUSDT', 'BNBUSDT', 'SUIUSDT', 'UNIUSDT', 'MXUSDT'
];

async function run() {
  const ts = Date.now();
  
  // 1. Get first deposit
  const deposits = await apiRequest('/api/v3/capital/deposit/hisrec', `timestamp=${ts}`);
  let firstDeposit = null;
  if (Array.isArray(deposits) && deposits.length > 0) {
    // Sort ascending by insertTime
    deposits.sort((a, b) => a.insertTime - b.insertTime);
    firstDeposit = deposits[0];
  }

  if (firstDeposit) {
    console.log('FIRST DEPOSIT DATE:', new Date(firstDeposit.insertTime).toISOString(), '| Amount:', firstDeposit.amount, firstDeposit.coin);
  } else {
    console.log('No deposit history found.');
  }

  // 2. Fetch all trades and find the absolute earliest trade
  let allTrades = [];
  for (const sym of checkSymbols) {
    try {
      const trades = await apiRequest('/api/v3/myTrades', `symbol=${sym}&limit=1000&timestamp=${ts}`);
      if (Array.isArray(trades)) {
        allTrades = allTrades.concat(trades);
      }
    } catch (e) {}
  }

  if (allTrades.length > 0) {
    allTrades.sort((a, b) => a.time - b.time);
    const earliestTrade = allTrades[0];
    const latestTrade = allTrades[allTrades.length - 1];
    console.log('TOTAL TRADES FETCHED:', allTrades.length);
    console.log('EARLIEST TRADE DATE:', new Date(earliestTrade.time).toISOString(), '| Symbol:', earliestTrade.symbol, '| Price:', earliestTrade.price, '| Qty:', earliestTrade.qty);
    console.log('LATEST TRADE DATE:', new Date(latestTrade.time).toISOString(), '| Symbol:', latestTrade.symbol, '| Price:', latestTrade.price, '| Qty:', latestTrade.qty);
  } else {
    console.log('No trades found.');
  }
}

run().catch(console.error);
