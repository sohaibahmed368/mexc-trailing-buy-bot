const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

async function forceSyncHypeNow() {
  console.log("================================================================================");
  console.log("🔍 REAL-TIME MEXC API FORCE SYNC FOR HYPE & ONDO");
  console.log("================================================================================");

  const mexcClient = new MexcClient();
  const ordersPath = path.join(__dirname, '../data/orders.json');

  if (!fs.existsSync(ordersPath)) {
    console.log("orders.json not found.");
    return;
  }

  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));

  if (!mexcClient.hasCredentials()) {
    console.log("No MEXC credentials found.");
    return;
  }

  const balances = await mexcClient.getBalances();
  console.log("MEXC Spot Wallet Balances (HYPE, ONDO, LINK):");
  balances.filter(b => ['HYPE', 'ONDO', 'LINK'].includes(b.asset.toUpperCase())).forEach(b => {
    console.log(`   ${b.asset}: Free = ${b.free}, Locked = ${b.locked}`);
  });

  for (const sym of ['HYPEUSDT', 'ONDOUSDT', 'LINKUSDT']) {
    const asset = sym.replace('USDT', '');
    const bal = balances.find(b => b.asset.toUpperCase() === asset);
    const totalQty = bal ? (parseFloat(bal.free || 0) + parseFloat(bal.locked || 0)) : 0;
    const tickerPrice = await mexcClient.getTickerPrice(sym).catch(() => 0);
    const notional = totalQty * tickerPrice;

    console.log(`\n📌 Checking ${sym}: Total Qty = ${totalQty}, Ticker = $${tickerPrice}, Notional = $${notional.toFixed(2)} USDT`);

    const openOrders = await mexcClient.getOpenOrders(sym).catch(() => []);
    console.log(`   Open Orders on MEXC (${sym}):`, openOrders);

    let card = orders.find(o => o.symbol === sym);
    if (card) {
      if (notional >= 10.0) {
        console.log(`   🟢 Asset ${sym} holds $${notional.toFixed(2)} USDT (>= $10.00). Syncing card to TP_SL_ACTIVE!`);
        card.status = 'TP_SL_ACTIVE';

        // Find last buy price or open sell order price / 1.005
        let buyPrice = card.executionPrice || tickerPrice;
        if (openOrders.length > 0) {
          const sellOrd = openOrders.find(o => o.side === 'SELL');
          if (sellOrd) {
            card.mexcSellOrderId = sellOrd.orderId;
            const sellPrice = parseFloat(sellOrd.price || 0);
            if (sellPrice > 0) {
              buyPrice = sellPrice / (1 + (card.takeProfit || 0.5) / 100);
            }
          }
        }
        card.executionPrice = buyPrice;
        card.initialPrice = buyPrice;
        console.log(`   Updated Card: Status = TP_SL_ACTIVE, Bought At = $${buyPrice.toFixed(4)}, TP Target = $${(buyPrice * 1.005).toFixed(4)}, mexcSellOrderId = ${card.mexcSellOrderId}`);
      }
    }
  }

  fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
  console.log("\n================================================================================");
  console.log("✅ FORCE SYNC COMPLETE: orders.json updated and saved.");
  console.log("================================================================================");
}

forceSyncHypeNow().catch(console.error);
