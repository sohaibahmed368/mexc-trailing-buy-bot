const MexcClient = require('../mexc-client');
const fs = require('fs');

async function auditExactMissingMath() {
  const creds = JSON.parse(fs.readFileSync('./backend/config/credentials.json', 'utf8'));
  const client = new MexcClient(creds.apiKey, creds.secretKey);

  console.log('========================================================================');
  console.log('🧮 EXACT WALLET BALANCE RECONCILIATION MATH');
  console.log('========================================================================\n');

  try {
    // Query Deposits & Withdrawals if available
    let deposits = [];
    let withdrawals = [];
    try {
      deposits = await client._request('GET', '/api/v3/capital/deposit/hisrec', {}, true);
    } catch (e) {}
    try {
      withdrawals = await client._request('GET', '/api/v3/capital/withdraw/history', {}, true);
    } catch (e) {}

    console.log('📥 Deposit Records Found:', Array.isArray(deposits) ? deposits.length : 0);
    if (Array.isArray(deposits) && deposits.length > 0) {
      deposits.forEach(d => console.log(`   - Deposit: ${d.amount} ${d.coin} [${new Date(d.insertTime).toLocaleString()}]`));
    }

    // Check MX Token Trades
    const mxTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'MXUSDT', limit: 100 }, true);
    console.log('\n🟩 MX Token Trades Found:', Array.isArray(mxTrades) ? mxTrades.length : 0);
    let mxBuyUsdt = 0;
    let mxBuyQty = 0;
    let mxSellUsdt = 0;
    let mxSellQty = 0;
    if (Array.isArray(mxTrades)) {
      mxTrades.forEach(t => {
        const p = parseFloat(t.price);
        const q = parseFloat(t.qty);
        const cost = parseFloat(t.quoteQty) || (p * q);
        if (t.isBuyer) {
          mxBuyUsdt += cost;
          mxBuyQty += q;
          console.log(`   🟢 MX BUY  | Qty: ${q} MX @ $${p.toFixed(4)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
        } else {
          mxSellUsdt += cost;
          mxSellQty += q;
          console.log(`   🔴 MX SELL | Qty: ${q} MX @ $${p.toFixed(4)} USDT = $${cost.toFixed(2)} USDT [${new Date(t.time).toLocaleString()}]`);
        }
      });
    }

    const liveMxPrice = await client.getTickerPrice('MXUSDT');
    const heldMxQty = 5.1727;
    const currentMxVal = heldMxQty * liveMxPrice;
    const avgMxBuyPrice = mxBuyQty > 0 ? (mxBuyUsdt / mxBuyQty) : 0;
    const mxPnl = currentMxVal - (heldMxQty * avgMxBuyPrice);

    console.log(`\n📊 MX Token Impact:`);
    console.log(`   - Total MX Bought: ${mxBuyQty} MX for $${mxBuyUsdt.toFixed(2)} USDT (Avg Buy: $${avgMxBuyPrice.toFixed(4)})`);
    console.log(`   - Current MX Holdings: ${heldMxQty} MX @ $${liveMxPrice.toFixed(4)} = $${currentMxVal.toFixed(2)} USDT`);
    console.log(`   - MX Value Change: ${mxPnl >= 0 ? '+' : ''}$${mxPnl.toFixed(2)} USDT\n`);

    // Check ETHUSDT, SOLUSDT, USOON trades
    const ethTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'ETHUSDT', limit: 100 }, true);
    let ethPnl = 0;
    if (Array.isArray(ethTrades)) {
      let ethBuy = 0, ethSell = 0;
      ethTrades.forEach(t => {
        const cost = parseFloat(t.quoteQty) || (parseFloat(t.price) * parseFloat(t.qty));
        if (t.isBuyer) ethBuy += cost; else ethSell += cost;
      });
      ethPnl = ethSell - ethBuy;
      console.log(`   - ETH Realized Trades PnL: $${ethPnl.toFixed(2)} USDT`);
    }

    const solTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'SOLUSDT', limit: 100 }, true);
    let solPnl = 0;
    if (Array.isArray(solTrades)) {
      let solBuy = 0, solSell = 0;
      solTrades.forEach(t => {
        const cost = parseFloat(t.quoteQty) || (parseFloat(t.price) * parseFloat(t.qty));
        if (t.isBuyer) solBuy += cost; else solSell += cost;
      });
      solPnl = solSell - solBuy;
      console.log(`   - SOL Realized Trades PnL: $${solPnl.toFixed(2)} USDT`);
    }

    const usoonTrades = await client._request('GET', '/api/v3/myTrades', { symbol: 'OIL(USOON)USDT', limit: 100 }, true);
    let usoonPnl = 0;
    if (Array.isArray(usoonTrades)) {
      let uBuy = 0, uSell = 0;
      usoonTrades.forEach(t => {
        const cost = parseFloat(t.quoteQty) || (parseFloat(t.price) * parseFloat(t.qty));
        if (t.isBuyer) uBuy += cost; else uSell += cost;
      });
      usoonPnl = uSell - uBuy;
      console.log(`   - USOON Realized Trades PnL: $${usoonPnl.toFixed(2)} USDT`);
    }

  } catch (e) {
    console.error('Reconciliation error:', e.message);
  }
}

auditExactMissingMath();
