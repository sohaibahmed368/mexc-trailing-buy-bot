const fs = require('fs');
const path = require('path');

function auditAndRestoreTradeHistory() {
  console.log('========================================================================');
  console.log('📊 RECALCULATING & SANITIZING SAVED TRADE HISTORIES');
  console.log('========================================================================\n');

  const ordersPath = path.join(__dirname, '../data/orders.json');
  if (!fs.existsSync(ordersPath)) {
    console.log('❌ orders.json not found!');
    return;
  }

  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  console.log(`📌 Found ${orders.length} saved orders in orders.json.\n`);

  let rawWins = 0;
  let rawLosses = 0;
  let manualSellsCount = 0;

  let strictWins = 0;
  let strictLosses = 0;
  let totalNetPnl = 0;

  orders.forEach(order => {
    if (Array.isArray(order.tradeHistory)) {
      order.tradeHistory.forEach(t => {
        const pVal = typeof t.profitUsdt === 'number' ? t.profitUsdt : (t.profit || 0);
        totalNetPnl += pVal;

        if (t.type === 'TAKE_PROFIT') {
          rawWins++;
        } else if (t.type === 'STOP_LOSS') {
          rawLosses++;
        } else {
          manualSellsCount++;
        }

        if (pVal > 0) {
          strictWins++;
        } else {
          strictLosses++;
        }
      });
    }
  });

  const rawTotal = rawWins + rawLosses;
  const rawWinRate = rawTotal > 0 ? (rawWins / rawTotal * 100).toFixed(1) : '0.0';

  const strictTotal = strictWins + strictLosses;
  const strictWinRate = strictTotal > 0 ? (strictWins / strictTotal * 100).toFixed(1) : '0.0';

  console.log('------------------------------------------------------------------------');
  console.log('📊 COMPARISON BREAKDOWN:');
  console.log('------------------------------------------------------------------------');
  console.log(`1️⃣ TYPE-BASED COUNT (Old Formula):`);
  console.log(`   - Wins (TAKE_PROFIT): ${rawWins}`);
  console.log(`   - Losses (STOP_LOSS): ${rawLosses}`);
  console.log(`   - Ignored (MANUAL_SELL): ${manualSellsCount}`);
  console.log(`   - Total Counted: ${rawTotal}`);
  console.log(`   - Win Rate: ${rawWinRate}%\n`);

  console.log(`2️⃣ STRICT NET-PROFIT COUNT (Current Formula):`);
  console.log(`   - Wins (Profit > $0): 🟢 ${strictWins}`);
  console.log(`   - Losses (Profit <= $0): 🔴 ${strictLosses}`);
  console.log(`   - Total Executed Trades: ${strictTotal}`);
  console.log(`   - Win Rate: ${strictWinRate}%`);
  console.log(`   - Cumulative Net PnL: $${totalNetPnl.toFixed(2)} USDT\n`);

  console.log('========================================================================');
  console.log('🏆 RECALCULATION COMPARISON COMPLETE!');
  console.log('========================================================================\n');
}

auditAndRestoreTradeHistory();
