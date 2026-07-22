const MexcClient = require('../mexc-client');
const fs = require('fs');

async function auditFullMexcTradeHistory() {
  const creds = JSON.parse(fs.readFileSync('./backend/config/credentials.json', 'utf8'));
  const client = new MexcClient(creds.apiKey, creds.secretKey);

  console.log('========================================================================');
  console.log('📜 MEXC COMPLETE HISTORICAL TRADE AUDIT REPORT');
  console.log('Fetching all executed trades via MEXC /api/v3/myTrades...');
  console.log('========================================================================\n');

  // Candidate symbols to check for trade history
  const symbolsToCheck = [
    'SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'USOONUSDT', 'OIL(USOON)USDT',
    'NVDAONUSDT', 'ONDOUSDT', 'XRPUSDT', 'UNIUSDT', 'BNBUSDT',
    'SUIUSDT', 'GOLD(XAUT)USDT', 'PAXGUSDT', 'MXUSDT', 'SPCXONUSDT',
    'TSLAONUSDT', 'AAPLONUSDT', 'MSFTONUSDT', 'INTKONUSDT'
  ];

  let overallTotalBuyUsdt = 0;
  let overallTotalSellUsdt = 0;
  let overallTotalFeesUsdt = 0;
  let activeOpenCostUsdt = 0;

  const symbolSummaries = [];

  for (const symbol of symbolsToCheck) {
    try {
      const trades = await client._request('GET', '/api/v3/myTrades', { symbol, limit: 1000 }, true);
      if (Array.isArray(trades) && trades.length > 0) {
        let symbolBuyUsdt = 0;
        let symbolBuyQty = 0;
        let symbolSellUsdt = 0;
        let symbolSellQty = 0;
        let symbolFeesUsdt = 0;

        console.log(`\n🔍 [${symbol}] Found ${trades.length} Executed Trades:`);
        trades.forEach(t => {
          const price = parseFloat(t.price);
          const qty = parseFloat(t.qty);
          const quoteQty = parseFloat(t.quoteQty) || (price * qty);
          const fee = parseFloat(t.commission) || 0;
          const isBuy = t.isBuyer;
          const timeStr = new Date(t.time).toLocaleString();

          if (isBuy) {
            symbolBuyUsdt += quoteQty;
            symbolBuyQty += qty;
            console.log(`   🟢 BUY  | Qty: ${qty} @ $${price.toFixed(4)} USDT = $${quoteQty.toFixed(2)} USDT [${timeStr}]`);
          } else {
            symbolSellUsdt += quoteQty;
            symbolSellQty += qty;
            console.log(`   🔴 SELL | Qty: ${qty} @ $${price.toFixed(4)} USDT = $${quoteQty.toFixed(2)} USDT [${timeStr}]`);
          }

          if (t.commissionAsset === 'USDT') {
            symbolFeesUsdt += fee;
          }
        });

        const netRealizedPnl = symbolSellUsdt - (symbolSellQty > 0 ? (symbolBuyUsdt * (symbolSellQty / (symbolBuyQty || 1))) : 0);
        const remainingQty = symbolBuyQty - symbolSellQty;
        const remainingCost = remainingQty > 0 ? (symbolBuyUsdt - (symbolSellUsdt)) : 0;

        overallTotalBuyUsdt += symbolBuyUsdt;
        overallTotalSellUsdt += symbolSellUsdt;
        overallTotalFeesUsdt += symbolFeesUsdt;
        if (remainingCost > 0) activeOpenCostUsdt += remainingCost;

        console.log(`   📊 ${symbol} Summary: Total Bought: $${symbolBuyUsdt.toFixed(2)}, Total Sold: $${symbolSellUsdt.toFixed(2)}, Realized PnL: $${netRealizedPnl.toFixed(2)} USDT, Open Position Cost: $${remainingCost.toFixed(2)} USDT`);

        symbolSummaries.push({
          symbol,
          tradesCount: trades.length,
          buyUsdt: symbolBuyUsdt,
          sellUsdt: symbolSellUsdt,
          realizedPnl: netRealizedPnl,
          remainingQty,
          remainingCost
        });
      }
    } catch (err) {
      // Symbol had no trades or endpoint returned error
    }
  }

  console.log('\n========================================================================');
  console.log('📌 MASTER HISTORICAL AUDIT SUMMARY ACROSS ALL TRADED PAIRS:');
  console.log('========================================================================');
  console.log(`  - Cumulative USDT Spent on Buys:  $${overallTotalBuyUsdt.toFixed(2)} USDT`);
  console.log(`  - Cumulative USDT Received from Sells: $${overallTotalSellUsdt.toFixed(2)} USDT`);
  console.log(`  - Cumulative Realized Net PnL (Closed Trades): $${(overallTotalSellUsdt - (overallTotalBuyUsdt - activeOpenCostUsdt)).toFixed(2)} USDT`);
  console.log(`  - Active Open Position Cost (Unsold Tokens): $${activeOpenCostUsdt.toFixed(2)} USDT`);
  console.log('========================================================================\n');
}

auditFullMexcTradeHistory().catch(err => {
  console.error('History Audit crashed:', err);
});
