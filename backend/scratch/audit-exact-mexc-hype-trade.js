const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

async function auditExactMexcHypeTrade() {
  console.log("================================================================================");
  console.log("🔍 MEXC LIVE SPOT ACCOUNT TRADE HISTORY AUDIT FOR HYPEUSDT");
  console.log("================================================================================");

  let apiKey = process.env.MEXC_API_KEY;
  let secretKey = process.env.MEXC_SECRET_KEY;

  // Search all possible directories for credentials files or .env files
  const searchDirs = [
    process.cwd(),
    path.join(process.cwd(), 'data'),
    path.join(process.cwd(), 'config'),
    path.join(__dirname, '..'),
    path.join(__dirname, '../data')
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const files = fs.readdirSync(dir);
      for (const f of files) {
        const fullPath = path.join(dir, f);
        if (f.endsWith('.json')) {
          try {
            const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
            if (content.apiKey && content.secretKey) {
              apiKey = content.apiKey;
              secretKey = content.secretKey;
              console.log(`   Loaded API Credentials from ${fullPath}`);
              break;
            }
          } catch (e) {}
        } else if (f === '.env' || f.endsWith('.env')) {
          try {
            const envText = fs.readFileSync(fullPath, 'utf8');
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
              console.log(`   Loaded API Credentials from ${fullPath}`);
              break;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    if (apiKey && secretKey) break;
  }

  const mexcClient = new MexcClient(apiKey, secretKey);
  if (!mexcClient.hasCredentials()) {
    console.error("❌ MEXC API Credentials not found! Please check frontend settings.");
    process.exit(1);
  }

  const symbol = 'HYPEUSDT';
  console.log(`\n1️⃣ Fetching Open Orders for ${symbol} on MEXC...`);
  try {
    const openOrders = await mexcClient.getOpenOrders(symbol);
    console.log(`   Open Orders Count: ${openOrders.length}`);
    openOrders.forEach((o, i) => {
      console.log(`   [#${i + 1}] Order ID: ${o.orderId} | Side: ${o.side} | Price: $${parseFloat(o.price).toFixed(4)} USDT | Qty: ${o.origQty} | Status: ${o.status}`);
    });
  } catch (e) {
    console.log(`   Open orders query error: ${e.message}`);
  }

  console.log(`\n2️⃣ Fetching Recent Trade Executions (getMyTrades) for ${symbol} on MEXC...`);
  try {
    const trades = await mexcClient.getMyTrades(symbol, 50);
    console.log(`   Recent Trades Count: ${trades.length}`);
    trades.slice(-10).forEach((t, i) => {
      const isBuy = t.isBuyer || t.side === 'BUY';
      const pktTime = new Date(parseInt(t.time || t.timestamp || Date.now()) + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`   [#${i + 1}] Time (PKT): ${pktTime} | Side: ${isBuy ? 'BUY 🟢' : 'SELL 🔴'} | Price: $${parseFloat(t.price).toFixed(4)} USDT | Qty: ${t.qty} | Quote Value: $${parseFloat(t.quoteQty || (t.price * t.qty)).toFixed(2)} USDT`);
    });
  } catch (e) {
    console.log(`   Trades query error: ${e.message}`);
  }

  console.log("\n================================================================================");
  console.log("🏆 MEXC SPOT TRADE AUDIT COMPLETED!");
  console.log("================================================================================");
}

auditExactMexcHypeTrade().catch(err => {
  console.error("❌ AUDIT FAILED:", err);
  process.exit(1);
});
