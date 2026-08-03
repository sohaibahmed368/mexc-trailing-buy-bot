const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('🔬 DEEP FORENSIC AUDIT: LIVE ACCOUNT TRADES (23 WINS / 28 LOSSES)');
console.log('================================================================\n');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');
const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');

let logs = [];
let orders = [];

try {
  if (fs.existsSync(logsPath)) {
    const raw = fs.readFileSync(logsPath, 'utf8');
    logs = JSON.parse(raw);
  }
} catch (e) {
  console.log('Error reading logs.json:', e.message);
}

try {
  if (fs.existsSync(ordersPath)) {
    const raw = fs.readFileSync(ordersPath, 'utf8');
    orders = JSON.parse(raw);
  }
} catch (e) {
  console.log('Error reading orders.json:', e.message);
}

console.log(`📊 Loaded ${logs.length} log entries and ${orders.length} active orders.\n`);

// Collect all trade history records across orders
let allTrades = [];

orders.forEach(order => {
  if (Array.isArray(order.tradeHistory)) {
    order.tradeHistory.forEach(t => {
      allTrades.push({
        symbol: order.symbol,
        ...t,
        dip: order.activationOffset || order.dipOffset,
        trail: order.trailValue,
        tp: order.takeProfit,
        sl: order.stopLoss,
        buffer: order.slBuffer
      });
    });
  }
});

// Also parse trades directly from logs if any
logs.forEach(log => {
  const msg = log.message || '';
  if (msg.includes('Cycle #') && msg.includes('completed')) {
    // e.g. Cycle #1 completed (TAKE_PROFIT). Profit: 0.5432 USDT...
  }
});

console.log(`================================================================`);
console.log(`📈 EXECUTED TRADES BREAKDOWN (${allTrades.length} Total Trades Found):`);
console.log(`================================================================`);

let wins = allTrades.filter(t => t.type === 'TAKE_PROFIT' || t.type === 'PROFIT_LOCK_WIN' || t.profitUsdt > 0);
let losses = allTrades.filter(t => t.type === 'STOP_LOSS' || t.profitUsdt < 0);

console.log(`🟢 Wins: ${wins.length} | 🔴 Losses: ${losses.length}`);
let totalPnL = allTrades.reduce((acc, t) => acc + (t.profitUsdt || 0), 0);
console.log(`💵 Cumulative PnL: $${totalPnL.toFixed(4)} USDT\n`);

console.log('📌 Individual Trade History:');
console.table(allTrades.map(t => ({
  Symbol: t.symbol,
  Type: t.type,
  BuyPrice: t.buyPrice,
  SellPrice: t.sellPrice,
  ProfitUSDT: t.profitUsdt ? `$${t.profitUsdt.toFixed(4)}` : '$0',
  TP_Pct: `+${t.tp}%`,
  SL_Pct: `-${t.sl}%`,
  Timestamp: t.timestamp ? t.timestamp.substring(0, 19).replace('T', ' ') : ''
})));

// Analyze Stop Loss Patterns
console.log('\n================================================================');
console.log('🔍 STOP LOSS CAUSE ANALYSIS:');
console.log('================================================================');

let slBySymbol = {};
losses.forEach(l => {
  slBySymbol[l.symbol] = (slBySymbol[l.symbol] || 0) + 1;
});

console.log('Losses per Symbol:', slBySymbol);
