const fs = require('fs');
const path = require('path');

const cryptoOrdersPath = path.join(__dirname, '../data/orders.json');
const stockOrdersPath = path.join(__dirname, '../data/alpaca-stock-orders.json');

function auditAndRecalculateOrders(filePath, label) {
  console.log(`\n🔍 Auditing and Recalculating Trade History for ${label}...`);
  if (!fs.existsSync(filePath)) {
    console.log(`  File ${filePath} does not exist. Skipping.`);
    return;
  }

  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`  Error reading ${filePath}: ${e.message}`);
    return;
  }

  let totalTradesCount = 0;
  let totalWins = 0;
  let totalLosses = 0;
  let aggregatePnl = 0;

  orders.forEach(order => {
    let orderNetProfit = 0;
    if (Array.isArray(order.tradeHistory) && order.tradeHistory.length > 0) {
      order.tradeHistory.forEach((t, idx) => {
        totalTradesCount++;
        const pVal = typeof t.profitUsdt === 'number' ? t.profitUsdt : (t.profit || 0);

        // Recalculate and normalize trade type strictly by profit amount
        if (pVal > 0) {
          totalWins++;
          if (t.type !== 'TAKE_PROFIT' && t.type !== 'PROFIT_LOCK_SELL') {
            t.type = 'TAKE_PROFIT';
          }
        } else {
          totalLosses++;
          t.type = 'STOP_LOSS';
        }

        orderNetProfit += pVal;
        aggregatePnl += pVal;
      });
      order.totalNetProfit = parseFloat(orderNetProfit.toFixed(6));
    }
  });

  fs.writeFileSync(filePath, JSON.stringify(orders, null, 2));

  const winRate = totalTradesCount > 0 ? ((totalWins / totalTradesCount) * 100).toFixed(1) : '100.0';
  console.log(`  ✅ Audited ${orders.length} orders in ${label}:`);
  console.log(`     - Total Executed Trades: ${totalTradesCount}`);
  console.log(`     - 🟢 Wins: ${totalWins}`);
  console.log(`     - 🔴 Losses: ${totalLosses}`);
  console.log(`     - Win Rate: ${winRate}%`);
  console.log(`     - Aggregate Cumulative PnL: ${aggregatePnl.toFixed(4)}`);
}

console.log('========================================================================');
console.log('🧹 MASTER TRADE HISTORY RECALCULATION & AUDIT SCRIPT');
console.log('========================================================================');

auditAndRecalculateOrders(cryptoOrdersPath, 'Crypto Bot (orders.json)');
auditAndRecalculateOrders(stockOrdersPath, 'Stock Bot (alpaca-stock-orders.json)');

console.log('\n========================================================================');
console.log('🏆 ALL SAVED TRADE HISTORIES RECALCULATED AND NORMALIZED SUCCESSFULLY!');
console.log('========================================================================\n');
