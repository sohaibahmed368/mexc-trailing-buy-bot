const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

console.log('================================================================================');
console.log('🔍 DEEP FORENSIC AUDIT — MEXC LIVE ACCOUNT TRADE-BY-TRADE OBI & INDICATOR ANALYSIS');
console.log('================================================================================\n');

async function auditLiveTrades() {
  const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
  if (!fs.existsSync(ordersPath)) {
    console.log('❌ No orders.json found in backend/data/');
    return;
  }

  const raw = fs.readFileSync(ordersPath, 'utf8');
  let orders = [];
  try {
    orders = JSON.parse(raw);
  } catch (e) {
    console.log('❌ Failed to parse orders.json');
    return;
  }

  console.log(`📋 Total Tracked Coins/Cards in Storage: ${orders.length}\n`);

  let totalExecutedTrades = 0;
  let winningTrades = [];
  let losingTrades = [];

  orders.forEach(order => {
    const history = order.tradeHistory || [];
    history.forEach(t => {
      totalExecutedTrades++;
      const buyPrice = t.executionPrice || t.buyPrice || 0;
      const sellPrice = t.sellExecutionPrice || t.sellPrice || 0;
      const pnlUsdt = t.netPnlUsdt !== undefined ? t.netPnlUsdt : (t.pnlUsdt || 0);
      const isWin = pnlUsdt >= 0 || (sellPrice > buyPrice);

      const record = {
        symbol: order.symbol,
        cycle: t.cycleNumber || 1,
        buyTime: t.buyTime || t.buyTriggeredAt || 'N/A',
        sellTime: t.sellTime || t.sellTriggeredAt || 'N/A',
        buyPrice: buyPrice.toFixed(4),
        sellPrice: sellPrice.toFixed(4),
        pnlUsdt: pnlUsdt.toFixed(4),
        obiPct: t.obiBidsRatio !== undefined ? (t.obiBidsRatio * 100).toFixed(1) : (t.obiPct || 'N/A'),
        rsi15m: t.rsi15m !== undefined ? t.rsi15m.toFixed(1) : (t.rsi || 'N/A'),
        reason: t.exitReason || t.status || 'CLOSED'
      };

      if (isWin) winningTrades.push(record);
      else losingTrades.push(record);
    });
  });

  console.log(`📊 SUMMARY OF ALL HISTORICAL EXECUTED TRADES (${totalExecutedTrades} Total):`);
  console.log(`   🟢 WINNING TRADES: ${winningTrades.length}`);
  console.log(`   🔴 LOSING TRADES: ${losingTrades.length}\n`);

  console.log('================================================================================');
  console.log('🟢 DETAILED WINNING TRADES BREAKDOWN:');
  console.log('================================================================================');
  if (winningTrades.length === 0) {
    console.log('   No winning trades found in history.');
  } else {
    winningTrades.forEach((w, i) => {
      console.log(` ${i + 1}. [${w.symbol}] Cycle #${w.cycle}`);
      console.log(`    - Buy Price: $${w.buyPrice} USDT | Sell Price: $${w.sellPrice} USDT`);
      console.log(`    - Net PnL: +$${w.pnlUsdt} USDT`);
      console.log(`    - OBI Bids Ratio at Entry: ${w.obiPct}%`);
      console.log(`    - 15m RSI at Entry: ${w.rsi15m}`);
      console.log(`    - Exit Reason: ${w.reason}\n`);
    });
  }

  console.log('================================================================================');
  console.log('🔴 DETAILED LOSING TRADES BREAKDOWN:');
  console.log('================================================================================');
  if (losingTrades.length === 0) {
    console.log('   No losing trades found in history.');
  } else {
    losingTrades.forEach((l, i) => {
      console.log(` ${i + 1}. [${l.symbol}] Cycle #${l.cycle}`);
      console.log(`    - Buy Price: $${l.buyPrice} USDT | Sell Price: $${l.sellPrice} USDT`);
      console.log(`    - Net PnL: -$${Math.abs(l.pnlUsdt)} USDT`);
      console.log(`    - OBI Bids Ratio at Entry: ${l.obiPct}%`);
      console.log(`    - 15m RSI at Entry: ${l.rsi15m}`);
      console.log(`    - Exit Reason: ${l.reason}\n`);
    });
  }

  // Calculate Average OBI for Wins vs Losses
  const winObis = winningTrades.map(w => parseFloat(w.obiPct)).filter(n => !isNaN(n));
  const lossObis = losingTrades.map(l => parseFloat(l.obiPct)).filter(n => !isNaN(n));

  const avgWinObi = winObis.length > 0 ? (winObis.reduce((a, b) => a + b, 0) / winObis.length).toFixed(1) : 'N/A';
  const avgLossObi = lossObis.length > 0 ? (lossObis.reduce((a, b) => a + b, 0) / lossObis.length).toFixed(1) : 'N/A';

  console.log('================================================================================');
  console.log('📊 OBI INDEX STATISTICAL ANALYSIS:');
  console.log('================================================================================');
  console.log(`   🟢 Average OBI Bids Ratio for WINNING Trades: ${avgWinObi}%`);
  console.log(`   🔴 Average OBI Bids Ratio for LOSING Trades: ${avgLossObi}%`);
  console.log('================================================================================\n');
}

auditLiveTrades().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
