const OrderTracker = require('../tracker');
const MexcClient = require('../mexc-client');
const fs = require('fs');
const path = require('path');

async function syncActiveOrdersNow() {
  console.log("================================================================================");
  console.log("🔍 REAL-TIME MEXC ORDER & TRADE SYNC AUDIT (LINK, HYPE, ONDO)");
  console.log("================================================================================");

  const mexcClient = new MexcClient();
  const tracker = new OrderTracker(mexcClient, null);

  const ordersPath = path.join(__dirname, '../data/orders.json');
  if (!fs.existsSync(ordersPath)) {
    console.log("No orders.json file found.");
    return;
  }

  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  console.log(`Loaded ${orders.length} cards from orders.json.`);

  for (const order of orders) {
    if (order.status === 'TP_SL_ACTIVE') {
      console.log(`\n📌 Auditing Active Card: ${order.symbol}`);
      console.log(`   Bought At: $${order.executionPrice}`);
      console.log(`   TP Target: $${(order.executionPrice * (1 + (order.takeProfit || 0.6) / 100)).toFixed(5)}`);
      console.log(`   mexcSellOrderId: ${order.mexcSellOrderId}`);

      if (mexcClient.hasCredentials()) {
        try {
          const openOrders = await mexcClient.getOpenOrders(order.symbol);
          console.log(`   Open Orders on MEXC (${order.symbol}): ${JSON.stringify(openOrders)}`);

          const trades = await mexcClient.getMyTrades(order.symbol, 10);
          console.log(`   Recent Trades on MEXC (${order.symbol}):`, trades.slice(0, 3));

          // Check if recent sell trade filled
          const recentSell = Array.isArray(trades) ? trades.reverse().find(t => (t.isBuyerMaker || t.isMaker) && parseFloat(t.price) >= (order.executionPrice * 1.004)) : null;

          if (recentSell) {
            console.log(`   🟢 FOUND EXECUTED TP SELL TRADE ON MEXC! Price: $${recentSell.price}`);
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = parseFloat(recentSell.price);
            order.sellTriggeredAt = new Date().toISOString();
            await tracker.handleOrderCycleComplete(order);
            console.log(`   ✅ Cycle Completed & Card Auto-Reset to PENDING_ACTIVATION! Total Profit: +$${order.totalNetProfit.toFixed(4)} USDT`);
          } else if (Array.isArray(openOrders) && openOrders.length === 0) {
            console.log(`   ⚠️ NO OPEN SELL ORDERS ON MEXC! Force Syncing Cycle...`);
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = order.executionPrice * (1 + (order.takeProfit || 0.6) / 100);
            order.sellTriggeredAt = new Date().toISOString();
            await tracker.handleOrderCycleComplete(order);
            console.log(`   ✅ Cycle Completed & Card Auto-Reset to PENDING_ACTIVATION! Total Profit: +$${order.totalNetProfit.toFixed(4)} USDT`);
          }
        } catch (err) {
          console.log(`   API Error for ${order.symbol}: ${err.message}`);
        }
      }
    }
  }

  // Save updated orders
  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
  console.log("\n================================================================================");
  console.log("✅ SYNC AUDIT COMPLETE: orders.json updated and saved.");
  console.log("================================================================================");
}

syncActiveOrdersNow().catch(console.error);
