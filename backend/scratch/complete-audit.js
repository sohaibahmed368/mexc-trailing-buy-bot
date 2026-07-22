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

function publicRequest(path) {
  return new Promise((resolve, reject) => {
    const options = { hostname: 'api.mexc.com', port: 443, path, method: 'GET' };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getAccount() {
  const ts = Date.now();
  return await apiRequest('/api/v3/account', `timestamp=${ts}`);
}

async function getAllTrades(symbol) {
  const ts = Date.now();
  const res = await apiRequest('/api/v3/myTrades', `symbol=${symbol}&limit=1000&timestamp=${ts}`);
  return Array.isArray(res) ? res : [];
}

async function getPrice(symbol) {
  try {
    const res = await publicRequest(`/api/v3/ticker/price?symbol=${symbol}`);
    return parseFloat(res.price) || 0;
  } catch { return 0; }
}

async function run() {
  console.log('Fetching account data...\n');

  // 1. Get all balances
  const account = await getAccount();
  const balances = account.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);

  // 2. Find USDT free balance
  const usdtBalance = balances.find(b => b.asset === 'USDT');
  const freeUSDT = usdtBalance ? parseFloat(usdtBalance.free) : 0;

  // 3. Get all non-USDT assets
  const tradableAssets = balances.filter(b => b.asset !== 'USDT' && b.asset !== 'MX' && b.asset !== 'TAKER');
  const allSymbols = tradableAssets.map(b => `${b.asset}USDT`);

  // 4. Fetch trades for each symbol
  const symbolData = {};
  for (const symbol of allSymbols) {
    const trades = await getAllTrades(symbol);
    if (trades.length > 0) {
      symbolData[symbol] = trades;
    }
  }

  // Also check BTC and ONDO explicitly
  for (const sym of ['BTCUSDT', 'ONDOUSDT']) {
    if (!symbolData[sym]) {
      const trades = await getAllTrades(sym);
      if (trades.length > 0) symbolData[sym] = trades;
    }
  }

  console.log('='.repeat(80));
  console.log('           COMPLETE MEXC TRADING HISTORY AUDIT');
  console.log('='.repeat(80));

  let grandTotalBuySpent = 0;
  let grandTotalSellReceived = 0;
  let grandTotalFees_USDT = 0;
  let grandTotalHoldingValue = 0;

  const symbolSummaries = [];

  for (const [symbol, trades] of Object.entries(symbolData)) {
    const coin = symbol.replace('USDT', '');

    let totalBuyQty = 0, totalBuyUSDT = 0;
    let totalSellQty = 0, totalSellUSDT = 0;
    let totalFeeUSDT = 0;
    let totalFeeMX = 0;

    for (const t of trades) {
      const qty = parseFloat(t.qty);
      const quoteQty = parseFloat(t.quoteQty);
      const fee = parseFloat(t.commission || 0);
      const feeAsset = t.commissionAsset || '';

      if (t.isBuyer) {
        totalBuyQty += qty;
        totalBuyUSDT += quoteQty;
      } else {
        totalSellQty += qty;
        totalSellUSDT += quoteQty;
      }

      if (feeAsset === 'USDT') totalFeeUSDT += fee;
      else if (feeAsset === 'MX') totalFeeMX += fee;
      else if (feeAsset === coin) {
        // fee paid in coin itself - convert to USDT later
      }
    }

    const holdingQty = totalBuyQty - totalSellQty;
    const currentPrice = holdingQty > 0.000001 ? await getPrice(symbol) : 0;
    const holdingValue = holdingQty * currentPrice;

    // Realized P&L: what we got from sells minus what we paid for those sold coins
    const avgBuyPrice = totalBuyQty > 0 ? totalBuyUSDT / totalBuyQty : 0;
    const costOfSoldCoins = totalSellQty * avgBuyPrice;
    const realizedPnL = totalSellUSDT - costOfSoldCoins;

    // Unrealized P&L on remaining holding
    const costOfHolding = holdingQty * avgBuyPrice;
    const unrealizedPnL = holdingValue - costOfHolding;

    grandTotalBuySpent += totalBuyUSDT;
    grandTotalSellReceived += totalSellUSDT;
    grandTotalFees_USDT += totalFeeUSDT;
    grandTotalHoldingValue += holdingValue;

    symbolSummaries.push({
      symbol, coin,
      totalTrades: trades.length,
      buys: trades.filter(t => t.isBuyer).length,
      sells: trades.filter(t => !t.isBuyer).length,
      totalBuyUSDT, totalSellUSDT,
      avgBuyPrice, holdingQty, currentPrice, holdingValue,
      realizedPnL, unrealizedPnL,
      totalFeeUSDT, totalFeeMX
    });
  }

  // Print each symbol
  for (const s of symbolSummaries) {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`COIN: ${s.coin.padEnd(10)} | Total Trades: ${s.totalTrades} (${s.buys} buys, ${s.sells} sells)`);
    console.log(`${'─'.repeat(80)}`);
    console.log(`  Spent on BUYs:          $${s.totalBuyUSDT.toFixed(4).padStart(12)}`);
    console.log(`  Received from SELLs:    $${s.totalSellUSDT.toFixed(4).padStart(12)}`);
    console.log(`  Avg Buy Price:          $${s.avgBuyPrice.toFixed(6).padStart(12)}`);
    console.log(`  Still Holding:           ${s.holdingQty.toFixed(6).padStart(12)} ${s.coin}`);
    console.log(`  Current Market Price:   $${s.currentPrice.toFixed(6).padStart(12)}`);
    console.log(`  Holding Value (live):   $${s.holdingValue.toFixed(4).padStart(12)}`);
    console.log(`  Realized P&L:           $${s.realizedPnL.toFixed(4).padStart(12)}  ${s.realizedPnL >= 0 ? '✅ PROFIT' : '❌ LOSS'}`);
    console.log(`  Unrealized P&L:         $${s.unrealizedPnL.toFixed(4).padStart(12)}  (on current holding)`);
    console.log(`  Fees Paid (USDT):       $${s.totalFeeUSDT.toFixed(4).padStart(12)}`);
    if (s.totalFeeMX > 0) {
      console.log(`  Fees Paid (MX token):    ${s.totalFeeMX.toFixed(6).padStart(12)} MX`);
    }
  }

  // Grand Summary
  const totalNetFlow = grandTotalSellReceived - grandTotalBuySpent;
  const estimatedDeposit = 2000;

  console.log(`\n${'='.repeat(80)}`);
  console.log('                    GRAND TOTAL RECONCILIATION');
  console.log('='.repeat(80));
  console.log(`  Your Total Deposit:                 $${estimatedDeposit.toFixed(2).padStart(10)}`);
  console.log(`  Free USDT in Account (right now):   $${freeUSDT.toFixed(4).padStart(10)}`);
  console.log(`  Active Holdings Value (live):        $${grandTotalHoldingValue.toFixed(4).padStart(10)}`);
  console.log(`  Total Fees Paid (USDT):             $${grandTotalFees_USDT.toFixed(4).padStart(10)}`);
  console.log(`─────────────────────────────────────────────────────`);
  const netPortfolio = freeUSDT + grandTotalHoldingValue;
  console.log(`  NET PORTFOLIO VALUE:                 $${netPortfolio.toFixed(4).padStart(10)}`);
  console.log(`  Difference from $2000 deposit:      $${(netPortfolio - estimatedDeposit).toFixed(4).padStart(10)}`);
  console.log(`=`.repeat(80));

  // Per-trade detail for all symbols
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('           DETAILED TRADE LOG (All Symbols)');
  console.log('='.repeat(80));

  for (const [symbol, trades] of Object.entries(symbolData)) {
    const coin = symbol.replace('USDT', '');
    console.log(`\n--- ${coin} (${trades.length} trades) ---`);
    console.log(`${'#'.padStart(4)} | Date & Time         | Side | Price          | Qty            | USDT           | Fee`);
    console.log('─'.repeat(100));

    let runningQty = 0;
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i];
      const date = new Date(t.time).toISOString().replace('T', ' ').substring(0, 19);
      const side = t.isBuyer ? 'BUY ' : 'SELL';
      const qty = parseFloat(t.qty);
      runningQty += t.isBuyer ? qty : -qty;
      const fee = parseFloat(t.commission || 0);
      const feeStr = fee > 0 ? `${fee.toFixed(6)} ${t.commissionAsset}` : '0';
      console.log(`${String(i+1).padStart(4)} | ${date} | ${side} | ${parseFloat(t.price).toFixed(6).padStart(14)} | ${qty.toFixed(6).padStart(14)} | ${parseFloat(t.quoteQty).toFixed(4).padStart(14)} | ${feeStr}`);
    }
  }
}

run().catch(console.error);
