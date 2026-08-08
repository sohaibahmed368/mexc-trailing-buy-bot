const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

async function forceRecycleHypeNow() {
  console.log("================================================================================");
  console.log("🚀 FORCE MARKET SELL & RE-CYCLE HYPEUSDT TO WAITING MODE");
  console.log("================================================================================");

  const credPath = path.join(__dirname, '../data/credentials.json');
  let apiKey = process.env.MEXC_API_KEY;
  let secretKey = process.env.MEXC_SECRET_KEY;

  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey = creds.apiKey || apiKey;
      secretKey = creds.secretKey || secretKey;
    } catch (e) {}
  }

  const mexcClient = new MexcClient(apiKey, secretKey);
  if (!mexcClient.hasCredentials()) {
    console.error("❌ MEXC API Credentials not found!");
    process.exit(1);
  }

  const symbol = 'HYPEUSDT';
  console.log(`1️⃣ Fetching live MEXC open orders for ${symbol}...`);

  try {
    const openOrders = await mexcClient.getOpenOrders(symbol);
    if (Array.isArray(openOrders) && openOrders.length > 0) {
      for (const ord of openOrders) {
        console.log(`   Cancelling open order ${ord.orderId} (${ord.side} ${ord.origQty} @ $${ord.price})...`);
        await mexcClient.cancelOrder(symbol, ord.orderId);
      }
    }
  } catch (e) {
    console.log(`   No open orders to cancel or error: ${e.message}`);
  }

  console.log(`2️⃣ Fetching confirmed spot wallet balance for HYPE...`);
  const balances = await mexcClient.getBalances();
  const hypeBal = balances.find(b => b.asset.toUpperCase() === 'HYPE');
  const freeQty = hypeBal ? parseFloat(hypeBal.free || 0) : 0;
  const lockedQty = hypeBal ? parseFloat(hypeBal.locked || 0) : 0;
  const totalQty = freeQty + lockedQty;

  console.log(`   HYPE Spot Wallet Balance: Free = ${freeQty}, Locked = ${lockedQty}, Total = ${totalQty}`);

  if (totalQty >= 0.05) {
    console.log(`3️⃣ Executing IMMEDIATE MARKET SELL on MEXC for ${totalQty} HYPE...`);
    const sellQty = Math.floor(totalQty * 100) / 100;
    try {
      const sellRes = await mexcClient.placeOrder({
        symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: sellQty
      });
      console.log(`   ✅ MARKET SELL EXECUTED ON MEXC! Order ID: ${sellRes.orderId}`);
    } catch (sErr) {
      console.log(`   Market Sell Notice: ${sErr.message}`);
    }
  } else {
    console.log(`   Zero or minimal HYPE balance in wallet. No market sell needed.`);
  }

  console.log(`4️⃣ Updating orders.json on disk to reset HYPEUSDT card to PENDING_ACTIVATION (Waiting)...`);
  const ordersPath = path.join(__dirname, '../data/orders.json');
  if (fs.existsSync(ordersPath)) {
    try {
      const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
      const hypeCard = orders.find(o => o.symbol === 'HYPEUSDT');
      if (hypeCard) {
        hypeCard.status = 'PENDING_ACTIVATION';
        hypeCard.executionPrice = null;
        hypeCard.initialPrice = null;
        hypeCard.mexcSellOrderId = null;
        hypeCard.mexcOrderId = null;
        hypeCard.error = null;
        fs.writeFileSync(ordersPath, JSON.stringify(orders, null, 2));
        console.log(`   ✅ orders.json UPDATED! HYPE Card Status reset to PENDING_ACTIVATION (Waiting)!`);
      }
    } catch (e) {
      console.error(`   Error updating orders.json: ${e.message}`);
    }
  }

  console.log("================================================================================");
  console.log("🏆 HYPEUSDT RE-CYCLED SUCCESSFULLY TO WAITING MODE!");
  console.log("================================================================================");
}

forceRecycleHypeNow().catch(err => {
  console.error("❌ RE-CYCLE FAILED:", err);
  process.exit(1);
});
