const MexcClient = require('../mexc-client');
const fs = require('fs');

async function auditOndoBtcBuys() {
  const creds = JSON.parse(fs.readFileSync('./backend/config/credentials.json', 'utf8'));
  const client = new MexcClient(creds.apiKey, creds.secretKey);

  console.log('========================================================================');
  console.log('🔎 ONDO & BTC OPEN POSITION EXACT BUY PRICE VS LIVE MARKET AUDIT');
  console.log('========================================================================\n');

  try {
    const balances = await client.getBalances();
    const btcBal = balances.find(b => b.asset === 'BTC');
    const ondoBal = balances.find(b => b.asset === 'ONDO');

    const btcQty = btcBal ? (btcBal.free + btcBal.locked) : 0;
    const ondoQty = ondoBal ? (ondoBal.free + ondoBal.locked) : 0;

    console.log(`📌 Current Wallet Balances: BTC = ${btcQty} BTC, ONDO = ${ondoQty} ONDO\n`);

    // Fetch trades for BTCUSDT
    const btcTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'BTCUSDT', limit: 100 }, true);
    console.log('--- ₿ BTCUSDT Historical Trades ---');
    let btcBuyCost = 0;
    let btcBuyQty = 0;
    btcTrades.forEach(t => {
      if (t.isBuyer) {
        const p = parseFloat(t.price);
        const q = parseFloat(t.qty);
        const cost = parseFloat(t.quoteQty) || (p * q);
        btcBuyCost += cost;
        btcBuyQty += q;
        console.log(`   🟢 BUY  | Qty: ${q} BTC @ $${p.toFixed(2)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
      } else {
        const p = parseFloat(t.price);
        const q = parseFloat(t.qty);
        const cost = parseFloat(t.quoteQty) || (p * q);
        console.log(`   🔴 SELL | Qty: ${q} BTC @ $${p.toFixed(2)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
      }
    });
    const avgBtcBuyPrice = btcBuyQty > 0 ? (btcBuyCost / btcBuyQty) : 0;
    const liveBtcPrice = await client.getTickerPrice('BTCUSDT');
    const btcCurrentValue = btcQty * liveBtcPrice;
    const btcCostValue = btcQty * avgBtcBuyPrice;
    const btcPnl = btcCurrentValue - btcCostValue;

    console.log(`\n📊 BTC Breakdown:`);
    console.log(`   - Held Quantity: ${btcQty} BTC`);
    console.log(`   - Weighted Average Buy Price: $${avgBtcBuyPrice.toFixed(2)} USDT`);
    console.log(`   - Live Market Price: $${liveBtcPrice.toFixed(2)} USDT`);
    console.log(`   - Total Purchase Cost: $${btcCostValue.toFixed(2)} USDT`);
    console.log(`   - Current Market Valuation: $${btcCurrentValue.toFixed(2)} USDT`);
    console.log(`   - Unrealized PnL: ${btcPnl >= 0 ? '+' : ''}$${btcPnl.toFixed(2)} USDT (${btcPnl >= 0 ? '🟢 PROFIT' : '🔴 LOSS'})\n`);

    // Fetch trades for ONDOUSDT
    const ondoTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'ONDOUSDT', limit: 100 }, true);
    console.log('--- 🌊 ONDOUSDT Historical Trades ---');
    let ondoBuyCost = 0;
    let ondoBuyQty = 0;
    ondoTrades.forEach(t => {
      if (t.isBuyer) {
        const p = parseFloat(t.price);
        const q = parseFloat(t.qty);
        const cost = parseFloat(t.quoteQty) || (p * q);
        ondoBuyCost += cost;
        ondoBuyQty += q;
        console.log(`   🟢 BUY  | Qty: ${q} ONDO @ $${p.toFixed(4)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
      } else {
        const p = parseFloat(t.price);
        const q = parseFloat(t.qty);
        const cost = parseFloat(t.quoteQty) || (p * q);
        console.log(`   🔴 SELL | Qty: ${q} ONDO @ $${p.toFixed(4)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
      }
    });
    const avgOndoBuyPrice = ondoBuyQty > 0 ? (ondoBuyCost / ondoBuyQty) : 0;
    const liveOndoPrice = await client.getTickerPrice('ONDOUSDT');
    const ondoCurrentValue = ondoQty * liveOndoPrice;
    const ondoCostValue = ondoQty * avgOndoBuyPrice;
    const ondoPnl = ondoCurrentValue - ondoCostValue;

    console.log(`\n📊 ONDO Breakdown:`);
    console.log(`   - Held Quantity: ${ondoQty} ONDO`);
    console.log(`   - Weighted Average Buy Price: $${avgOndoBuyPrice.toFixed(4)} USDT`);
    console.log(`   - Live Market Price: $${liveOndoPrice.toFixed(4)} USDT`);
    console.log(`   - Total Purchase Cost: $${ondoCostValue.toFixed(2)} USDT`);
    console.log(`   - Current Market Valuation: $${ondoCurrentValue.toFixed(2)} USDT`);
    console.log(`   - Unrealized PnL: ${ondoPnl >= 0 ? '+' : ''}$${ondoPnl.toFixed(2)} USDT (${ondoPnl >= 0 ? '🟢 PROFIT' : '🔴 LOSS'})\n`);

  } catch (e) {
    console.error('Audit Error:', e.message);
  }
}

auditOndoBtcBuys();
