const MexcClient = require('../mexc-client');
const fs = require('fs');
const path = require('path');

const mexcClient = new MexcClient();

async function fetchRealMexcTradesHistory() {
  console.log("================================================================================");
  console.log("🔍 FETCHING REAL ACCOUNT TRADING HISTORY DIRECTLY FROM MEXC API");
  console.log("================================================================================");

  if (!mexcClient.hasCredentials()) {
    console.error("❌ MEXC API credentials not found!");
    return;
  }

  // Common symbols to check trade history for
  const symbols = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BTCUSDT', 'SUIUSDT', 'GOLDUSDT', 'XAUTUSDT', 'EURUSDT', 'NVDAONUSDT'];

  let allTrades = [];

  for (const sym of symbols) {
    try {
      console.log(`⏳ Querying real MEXC trade history for ${sym}...`);
      const trades = await mexcClient.getMyTrades(sym);
      if (Array.isArray(trades) && trades.length > 0) {
        console.log(`   ✅ Found ${trades.length} real fills for ${sym}!`);
        trades.forEach(t => {
          allTrades.push({
            symbol: sym,
            orderId: t.orderId,
            tradeId: t.id,
            price: parseFloat(t.price),
            qty: parseFloat(t.qty),
            quoteQty: parseFloat(t.quoteQty || (t.price * t.qty)),
            commission: parseFloat(t.commission || 0),
            commissionAsset: t.commissionAsset || 'USDT',
            isBuyer: t.isBuyer,
            isMaker: t.isMaker,
            timeMs: t.time,
            utcStr: new Date(t.time).toISOString(),
            pktStr: new Date(t.time + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT'
          });
        });
      } else {
        console.log(`   No trades found for ${sym}.`);
      }
    } catch (e) {
      console.log(`   Info (${sym}): ${e.message}`);
    }
  }

  console.log("\n================================================================================");
  console.log(`🏆 REAL MEXC ACCOUNT TRADES REPORT (TOTAL FILLS FOUND: ${allTrades.length}):`);
  console.log("================================================================================");

  if (allTrades.length === 0) {
    console.log("\n📌 RESULT: No executed trades found on MEXC API for the checked USDT trading pairs.");
    console.log("   (Note: The dashboard banner '+0.7747 USDT' came from frontend mock calculations on saved test order objects in data/orders.json).");
  } else {
    allTrades.forEach((tr, i) => {
      console.log(`\n[FILL #${i + 1}] ${tr.symbol}`);
      console.log(`- ⏱️ PKT Time: ${tr.pktStr}`);
      console.log(`- ⏱️ UTC Time: ${tr.utcStr}`);
      console.log(`- 🔄 Side: ${tr.isBuyer ? '🟢 BUY' : '🔴 SELL'}`);
      console.log(`- 💵 Price: $${tr.price}`);
      console.log(`- 📦 Quantity: ${tr.qty} (Quote: $${tr.quoteQty.toFixed(4)} USDT)`);
      console.log(`- 💸 Fee: ${tr.commission} ${tr.commissionAsset}`);
    });
  }
}

fetchRealMexcTradesHistory().catch(console.error);
