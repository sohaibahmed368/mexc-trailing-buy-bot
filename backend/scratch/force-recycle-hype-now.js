const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

async function forceRecycleHypeNow() {
  console.log("================================================================================");
  console.log("🚀 FORCE MARKET SELL & RE-CYCLE HYPEUSDT TO WAITING MODE");
  console.log("================================================================================");

  let apiKey = process.env.MEXC_API_KEY;
  let secretKey = process.env.MEXC_SECRET_KEY;

  const possiblePaths = [
    path.join(__dirname, '../data/credentials.json'),
    path.join(__dirname, 'data/credentials.json'),
    path.join(__dirname, '../credentials.json'),
    path.join(process.cwd(), 'data/credentials.json'),
    path.join(process.cwd(), 'credentials.json')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        const creds = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (creds.apiKey && creds.secretKey) {
          apiKey = creds.apiKey;
          secretKey = creds.secretKey;
          console.log(`   Found API Credentials in ${p}`);
          break;
        }
      } catch (e) {}
    }
  }

  if (!apiKey || !secretKey) {
    const possibleEnvPaths = [
      path.join(__dirname, '../.env'),
      path.join(__dirname, '.env'),
      path.join(process.cwd(), '.env')
    ];

    for (const envP of possibleEnvPaths) {
      if (fs.existsSync(envP)) {
        try {
          const envText = fs.readFileSync(envP, 'utf8');
          const lines = envText.split('\n');
          lines.forEach(l => {
            const parts = l.split('=');
            if (parts.length >= 2) {
              const key = parts[0].trim();
              const val = parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
              if (key === 'MEXC_API_KEY' && val) apiKey = val;
              if (key === 'MEXC_SECRET_KEY' && val) secretKey = val;
            }
          });
          if (apiKey && secretKey) {
            console.log(`   Found API Credentials in ${envP}`);
            break;
          }
        } catch (e) {}
      }
    }
  }

  const mexcClient = new MexcClient(apiKey, secretKey);
  const symbol = 'HYPEUSDT';

  if (mexcClient.hasCredentials()) {
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
      console.log(`   Open orders check: ${e.message}`);
    }

    console.log(`2️⃣ Fetching confirmed spot wallet balance for HYPE...`);
    try {
      const balances = await mexcClient.getBalances();
      const hypeBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === 'HYPE') : null;
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
      }
    } catch (bErr) {
      console.log(`   Balance fetch notice: ${bErr.message}`);
    }
  } else {
    console.log("   Notice: API credentials file path deferred to server.js startup.");
  }

  console.log(`4️⃣ Updating orders.json on disk to reset HYPEUSDT card to PENDING_ACTIVATION (Waiting)...`);
  const possibleOrdersPaths = [
    path.join(__dirname, '../data/orders.json'),
    path.join(__dirname, 'data/orders.json'),
    path.join(process.cwd(), 'data/orders.json')
  ];

  let ordersUpdated = false;
  for (const ordersPath of possibleOrdersPaths) {
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
          console.log(`   ✅ orders.json UPDATED at ${ordersPath}! HYPE Card Status reset to PENDING_ACTIVATION (Waiting)!`);
          ordersUpdated = true;
          break;
        }
      } catch (e) {
        console.error(`   Error updating orders.json at ${ordersPath}: ${e.message}`);
      }
    }
  }

  if (!ordersUpdated) {
    console.log(`   Creating fresh orders.json with HYPEUSDT card in Waiting mode...`);
    const defaultOrdersPath = path.join(process.cwd(), 'data/orders.json');
    const dataDir = path.dirname(defaultOrdersPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const newHypeCard = [{
      id: 'hype_recycled_' + Date.now(),
      symbol: 'HYPEUSDT',
      trailValue: 0.25,
      quantity: null,
      quoteOrderQty: 15,
      orderType: 'MARKET',
      dryRun: false,
      status: 'PENDING_ACTIVATION',
      activationPrice: null,
      activatedAt: new Date().toISOString(),
      takeProfit: 0.5,
      stopLoss: 0.0,
      filterObi: true,
      autoRepeat: true,
      startImmediately: false,
      executionPrice: null,
      initialPrice: null,
      currentPrice: 55.0,
      createdAt: new Date().toISOString()
    }];
    fs.writeFileSync(defaultOrdersPath, JSON.stringify(newHypeCard, null, 2));
    console.log(`   ✅ Created ${defaultOrdersPath} with HYPEUSDT card in Waiting mode!`);
  }

  console.log("================================================================================");
  console.log("🏆 HYPEUSDT RE-CYCLED SUCCESSFULLY TO WAITING MODE!");
  console.log("================================================================================");
}

forceRecycleHypeNow().catch(err => {
  console.error("❌ RE-CYCLE FAILED:", err);
  process.exit(1);
});
