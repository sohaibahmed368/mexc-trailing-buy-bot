const fs = require('fs');
const path = require('path');

console.log('================================================================');
console.log('🔬 DEEP FORENSIC AUDIT: 9 WINS / 8 LOSSES (-$2.65 USDT) PnL PARADOX');
console.log('================================================================\n');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');
const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');

let orders = [];
let logs = [];

try {
  if (fs.existsSync(ordersPath)) {
    const raw = fs.readFileSync(ordersPath, 'utf8');
    orders = JSON.parse(raw);
  }
} catch (e) {}

try {
  if (fs.existsSync(logsPath)) {
    const raw = fs.readFileSync(logsPath, 'utf8');
    logs = JSON.parse(raw);
  }
} catch (e) {}

console.log(`Loaded ${orders.length} orders and ${logs.length} logs.\n`);

// Extract all trades from active orders
let trades = [];
orders.forEach(o => {
  if (Array.isArray(o.tradeHistory)) {
    o.tradeHistory.forEach(t => {
      trades.push({
        symbol: o.symbol,
        quoteQty: o.quoteOrderQty || 100,
        ...t
      });
    });
  }
});

console.log(`📌 Found ${trades.length} trades recorded across active order cards:`);
let winCount = 0;
let lossCount = 0;
let totalPnL = 0;

trades.forEach((t, i) => {
  const pnl = t.profitUsdt || 0;
  totalPnL += pnl;
  if (pnl > 0) winCount++;
  else lossCount++;

  console.log(`Trade #${i+1} [${t.symbol}] - Type: ${t.type} | Quote: $${t.quoteQty} | Buy: $${t.buyPrice} | Sell: $${t.sellPrice} | PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)} USDT`);
});

console.log(`\n📊 Total Wins: ${winCount} | Total Losses: ${lossCount} | Net PnL: $${totalPnL.toFixed(4)} USDT`);

// Calculate MEXC Fee Impact Example:
console.log('\n================================================================');
console.log('💡 MATHEMATICAL PROOF OF FEE & POSITION SIZE IMPACT:');
console.log('================================================================');
console.log('Scenario A (No Fees, Equal Size): 9 Wins (+0.60%) vs 8 Losses (-0.30%)');
console.log('   Expected PnL = (9 * +0.60%) - (8 * 0.30%) = +5.40% - 2.40% = +3.00% Net Profit\n');

console.log('Scenario B (Real MEXC 0.20% Roundtrip Fees Included):');
console.log('   Real Net Win per TP = +0.60% - 0.20% fee = +0.40% Net Profit');
console.log('   Real Net Loss per SL = -0.30% - 0.20% fee = -0.50% Net Loss');
console.log('   Actual PnL = (9 * +0.40%) - (8 * 0.50%) = +3.60% - 4.00% = -0.40% NET LOSS!\n');

console.log('Scenario C (Smart SL Extension + Fees):');
console.log('   If SL is extended by +0.15% buffer, SL Loss = -0.45% + 0.20% fee = -0.65% Loss');
console.log('   Actual PnL = (9 * +0.40%) - (8 * 0.65%) = +3.60% - 5.20% = -1.60% NET LOSS!');
console.log('================================================================\n');
