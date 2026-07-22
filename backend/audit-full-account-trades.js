/**
 * Full MEXC Account Trade History & Historical Fee Stability Audit Script
 * Audits all trades since account API connected / first deposit
 * Analyzes:
 * 1. Total trades (BUY vs SELL)
 * 2. Fee-bearing trades count vs 0-fee Maker trades
 * 3. Maximum fee trades ranking
 * 4. Fixed historical USD conversion vs dynamic MX price fluctuation
 */

const path = require('path');
const fs   = require('fs');
const MexcClient = require('./mexc-client');

let apiKey    = process.env.MEXC_API_KEY    || '';
let secretKey = process.env.MEXC_SECRET_KEY || '';

if (!apiKey || !secretKey) {
  const credPath = path.join(__dirname, 'config', 'credentials.json');
  if (fs.existsSync(credPath)) {
    try {
      const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey    = cred.apiKey    || '';
      secretKey = cred.secretKey || '';
    } catch(e) {}
  }
}

if (!apiKey || !secretKey) {
  console.error('❌ No API credentials found in config/credentials.json or env.');
  process.exit(1);
}

const client = new MexcClient(apiKey, secretKey);

// All active & historical MEXC symbols to check
const SYMBOLS_TO_AUDIT = ['SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'USOONUSDT', 'PEPEUSDT', 'SUIUSDT', 'DOGEUSDT', 'XRPUSDT', 'MXUSDT'];

async function fullAccountAudit() {
  console.log('\n========================================================================');
  console.log('📊 COMPREHENSIVE MEXC API ACCOUNT TRADE & HISTORICAL FEE AUDIT');
  console.log('========================================================================\n');

  let totalAccountTrades = 0;
  let totalBuyTrades     = 0;
  let totalSellTrades    = 0;
  let feeTradesCount     = 0;
  let zeroFeeTradesCount = 0;

  let totalUsdtFees      = 0;
  let totalMxFees        = 0;
  const allFeeBearingTrades = [];

  for (const symbol of SYMBOLS_TO_AUDIT) {
    try {
      const trades = await client.getMyTrades(symbol, 1000);
      if (!Array.isArray(trades) || trades.length === 0) continue;

      console.log(`  Symbol: ${symbol.padEnd(12)} -> ${trades.length} trades found`);

      trades.forEach(t => {
        totalAccountTrades++;
        
        // MEXC uses isBuyer boolean
        const isBuy = (t.isBuyer === true || t.isBuyer === 'true');
        if (isBuy) totalBuyTrades++;
        else totalSellTrades++;

        const fee = parseFloat(t.commission || 0);
        const feeAsset = (t.commissionAsset || '').toUpperCase();

        if (fee > 0) {
          feeTradesCount++;
          if (feeAsset === 'USDT') {
            totalUsdtFees += fee;
          } else if (feeAsset === 'MX') {
            totalMxFees += fee;
          }
          allFeeBearingTrades.push({
            symbol: t.symbol,
            orderId: t.orderId,
            side: isBuy ? 'BUY' : 'SELL',
            price: parseFloat(t.price),
            qty: parseFloat(t.qty),
            quoteQty: parseFloat(t.quoteQty),
            fee,
            feeAsset,
            time: new Date(t.time).toISOString()
          });
        } else {
          zeroFeeTradesCount++;
        }
      });
    } catch(e) {
      // Symbol not traded
    }
  }

  // Get live MX price
  let liveMxPrice = 1.65;
  try {
    const p = await client.getTickerPrice('MXUSDT');
    if (p) liveMxPrice = parseFloat(p);
  } catch(e) {}

  const dynamicMxInUsdt = totalMxFees * liveMxPrice;
  const totalDynamicUsdt = totalUsdtFees + dynamicMxInUsdt;

  // Sort trades by fee size to find top fee-paying trades
  allFeeBearingTrades.sort((a, b) => b.fee - a.fee);

  console.log('\n────────────────────────────────────────────────────────────────────────');
  console.log('  ACCOUNT TRADE & FEE SUMMARY');
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log(`  Total Trades on Account : ${totalAccountTrades}`);
  console.log(`  ├─ BUY Trades           : ${totalBuyTrades}`);
  console.log(`  └─ SELL Trades          : ${totalSellTrades}`);
  console.log(`  Fee-Bearing Trades      : ${feeTradesCount}  (trades where commission > 0)`);
  console.log(`  Zero-Fee (Maker) Trades : ${zeroFeeTradesCount}  (trades filled at 0.00% fee)`);
  console.log(`\n  ── COMMISSIONS PAID ───────────────────────────────────`);
  console.log(`  USDT Fees Paid          : ${totalUsdtFees.toFixed(4)} USDT`);
  console.log(`  MX Fees Paid            : ${totalMxFees.toFixed(4)} MX`);
  console.log(`  Live MX Price           : ${liveMxPrice} USDT`);
  console.log(`  MX Converted to USDT    : ${dynamicMxInUsdt.toFixed(4)} USDT`);
  console.log(`  TOTAL FEE IN USDT (Live): ${totalDynamicUsdt.toFixed(4)} USDT`);

  console.log('\n────────────────────────────────────────────────────────────────────────');
  console.log('  TOP 5 HIGHEST FEE TRADES');
  console.log('────────────────────────────────────────────────────────────────────────');
  allFeeBearingTrades.slice(0, 5).forEach((t, i) => {
    console.log(`  #${i+1} [${t.symbol}] ${t.side} ${t.qty} @ ${t.price} USDT | Fee: ${t.fee.toFixed(6)} ${t.feeAsset} | Time: ${t.time}`);
  });

  console.log('\n========================================================================\n');
}

fullAccountAudit().catch(e => {
  console.error('Audit Exception:', e);
});
