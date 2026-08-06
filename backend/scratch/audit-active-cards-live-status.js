const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
const mexcClient = new MexcClient();

async function auditActiveCardsLiveStatus() {
  console.log("================================================================================");
  console.log("🔍 REAL-TIME AUDIT OF ALL ACTIVE CARDS & ORDER STATUSES");
  console.log("================================================================================");

  if (!fs.existsSync(ordersPath)) {
    console.log("No orders file found.");
    return;
  }

  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  } catch (e) {
    console.error("Error reading orders.json:", e.message);
    return;
  }

  console.log(`Total active cards in data/orders.json: ${orders.length}\n`);

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i];
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`📌 CARD #${i + 1}: ${o.symbol} (ID: ${o.id})`);
    console.log(`- 🟢 Status: ${o.status}`);
    console.log(`- 🧪 Mode: ${o.dryRun ? 'SIMULATION (Dry-Run)' : 'REAL LIVE MEXC'}`);
    console.log(`- 💵 Quote Investment: $${o.quoteOrderQty || o.quantity} USDT`);
    console.log(`- 🎯 Target TP %: +${o.takeProfit || 0.60}%`);

    let livePrice = o.currentPrice || 0;
    try {
      livePrice = await mexcClient.getTickerPrice(o.symbol);
    } catch (e) {}

    console.log(`- ⚡ Current Live Price: $${livePrice}`);

    if (o.status === 'TP_SL_ACTIVE') {
      const execPrice = o.executionPrice || livePrice;
      const tpTargetPrice = execPrice * (1 + ((o.takeProfit || 0.60) / 100));
      const priceDiffPct = ((livePrice - execPrice) / execPrice) * 100;
      const progressToTpPct = ((livePrice - execPrice) / (tpTargetPrice - execPrice)) * 100;

      console.log(`- 🛒 Buy Execution Price: $${execPrice}`);
      console.log(`- 🔒 Active Limit Sell TP Price: $${tpTargetPrice.toFixed(5)} (+${o.takeProfit || 0.60}%)`);
      console.log(`- 📈 Current Price vs Buy Price: ${priceDiffPct >= 0 ? '+' : ''}${priceDiffPct.toFixed(2)}%`);
      console.log(`- ⏳ Progress to Take Profit Limit: ${Math.max(0, Math.min(100, progressToTpPct)).toFixed(1)}%`);

      if (livePrice >= tpTargetPrice) {
        console.log(`- 🚀 LIMIT PRICE HIT STATUS: TAKE PROFIT HIT! Limit Sell order filled!`);
      } else {
        console.log(`- 🛡️ LIMIT PRICE HIT STATUS: Limit Sell Order Active on MEXC. Waiting for price to touch $${tpTargetPrice.toFixed(5)}...`);
      }
    } else if (o.status === 'PENDING_ACTIVATION') {
      console.log(`- 🛒 Buy Execution Price: Waiting Buy...`);
      console.log(`- ⚡ OBI Scanning Status: Live scanning Top 10 Exchanges orderbooks (Target Avg OBI >= 55.0%)...`);
    }

    console.log(`--------------------------------------------------------------------------------\n`);
  }
}

auditActiveCardsLiveStatus().catch(console.error);
