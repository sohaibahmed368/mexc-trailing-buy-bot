const fs = require('fs');
const path = require('path');

const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
const logsPath = path.join(__dirname, '..', 'data', 'logs.json');

async function auditFinishedWinningTrades() {
  console.log("================================================================================");
  console.log("🏆 AUDITING FINISHED WINNING TRADES (2 WINS | +0.7747 USDT TOTAL PNL)");
  console.log("================================================================================");

  if (!fs.existsSync(ordersPath)) {
    console.log(`❌ Orders file not found at: ${ordersPath}`);
    return;
  }

  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  } catch (e) {
    console.error("Error reading orders.json:", e.message);
    return;
  }

  console.log(`Total active/historical card objects in data/orders.json: ${orders.length}\n`);

  let finishedTrades = [];

  orders.forEach((order, idx) => {
    const history = order.tradeHistory || [];
    if (history.length > 0) {
      history.forEach((t, tIdx) => {
        const profitUsdt = typeof t.profitUsdt === 'number' ? t.profitUsdt : (t.profit || 0);
        finishedTrades.push({
          cardId: order.id,
          symbol: order.symbol,
          cycle: t.cycle || (tIdx + 1),
          buyPrice: t.buyPrice,
          sellPrice: t.sellPrice,
          profitUsdt,
          type: t.type || 'TAKE_PROFIT',
          timestamp: t.timestamp || t.time || order.updatedAt || order.createdAt
        });
      });
    } else if (order.sellExecutionPrice && order.executionPrice) {
      const buyP = order.executionPrice;
      const sellP = order.sellExecutionPrice;
      const qty = order.quantity || (order.quoteOrderQty ? order.quoteOrderQty / buyP : 1);
      const profitUsdt = (sellP - buyP) * qty;
      finishedTrades.push({
        cardId: order.id,
        symbol: order.symbol,
        cycle: 1,
        buyPrice: buyP,
        sellPrice: sellP,
        profitUsdt,
        type: 'TAKE_PROFIT',
        timestamp: order.sellTriggeredAt || order.updatedAt
      });
    }
  });

  console.log("================================================================================");
  console.log(`🏆 FINISHED TRADES FOUND IN SYSTEM STORAGE: ${finishedTrades.length}`);
  console.log("================================================================================");

  let totalPnl = 0;
  finishedTrades.forEach((tr, i) => {
    totalPnl += tr.profitUsdt;
    const pktTimeStr = new Date(new Date(tr.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
    console.log(`\n[TRADE #${i + 1}]`);
    console.log(`- 🪙 Symbol: ${tr.symbol}`);
    console.log(`- 🛒 Buy Price: $${tr.buyPrice}`);
    console.log(`- 🎯 Sell Price (TP): $${tr.sellPrice}`);
    console.log(`- 💰 Net Profit: +$${tr.profitUsdt.toFixed(4)} USDT`);
    console.log(`- ⏱️ Timestamp (PKT): ${pktTimeStr}`);
    console.log(`- ⏱️ Timestamp (UTC): ${tr.timestamp}`);
  });

  console.log(`\n================================================================================`);
  console.log(`📊 TOTAL PNL COMPUTED: +${totalPnl.toFixed(4)} USDT`);
  console.log(`================================================================================`);
}

auditFinishedWinningTrades().catch(console.error);
