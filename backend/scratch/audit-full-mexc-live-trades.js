const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');
const mexc = new MexcClient();

async function auditMexcLiveTrades() {
  console.log('========================================================================');
  console.log('📊 MEXC LIVE TRADE HISTORY FULL RECALCULATION AUDIT');
  console.log('========================================================================\n');

  const ordersPath = path.join(__dirname, '../data/orders.json');
  if (!fs.existsSync(ordersPath)) {
    console.log('❌ orders.json not found!');
    return;
  }

  const rawOrders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  console.log(`📌 Found ${rawOrders.length} active/saved orders in orders.json.\n`);

  let globalWins = 0;
  let globalLosses = 0;
  let globalNetProfit = 0;

  const perCoinSummary = {};

  rawOrders.forEach(order => {
    const symbol = order.symbol;
    if (!perCoinSummary[symbol]) {
      perCoinSummary[symbol] = { wins: 0, losses: 0, profitUsdt: 0, tradesCount: 0 };
    }

    if (Array.isArray(order.tradeHistory) && order.tradeHistory.length > 0) {
      order.tradeHistory.forEach(t => {
        const pVal = parseFloat(t.profitUsdt || t.netProfitUsdt || 0);
        perCoinSummary[symbol].tradesCount++;
        perCoinSummary[symbol].profitUsdt += pVal;
        globalNetProfit += pVal;

        if (pVal > 0) {
          perCoinSummary[symbol].wins++;
          globalWins++;
        } else {
          perCoinSummary[symbol].losses++;
          globalLosses++;
        }
      });
    }
  });

  console.log('------------------------------------------------------------------------');
  console.log('📈 RECALCULATED GLOBAL TRADE SUMMARY FROM SAVED ORDERS:');
  console.log('------------------------------------------------------------------------');
  const totalTrades = globalWins + globalLosses;
  const winRate = totalTrades > 0 ? (globalWins / totalTrades * 100).toFixed(1) : '100.0';
  console.log(`  - Total Executed Trades: ${totalTrades}`);
  console.log(`  - Wins (Profit > $0): 🟢 ${globalWins}`);
  console.log(`  - Losses (Profit <= $0): 🔴 ${globalLosses}`);
  console.log(`  - Recalculated Win Rate: ${winRate}%`);
  console.log(`  - Cumulative Net PnL: $${globalNetProfit.toFixed(2)} USDT\n`);

  console.log('------------------------------------------------------------------------');
  console.log('🪙 PER-COIN RECALCULATED BREAKDOWN:');
  console.log('------------------------------------------------------------------------');
  Object.keys(perCoinSummary).forEach(s => {
    const c = perCoinSummary[s];
    const cTotal = c.wins + c.losses;
    const cWinRate = cTotal > 0 ? (c.wins / cTotal * 100).toFixed(1) : '100.0';
    console.log(`  ${s.padEnd(10)}: Trades=${cTotal} | 🟢 Wins=${c.wins} | 🔴 Losses=${c.losses} | WinRate=${cWinRate}% | PnL=$${c.profitUsdt.toFixed(2)} USDT`);
  });

  // Attempt MEXC API myTrades audit for live trades
  if (mexc.hasCredentials()) {
    console.log('\n------------------------------------------------------------------------');
    console.log('🔑 FETCHING RECENT LIVE TRADES DIRECTLY FROM MEXC API (getMyTrades):');
    console.log('------------------------------------------------------------------------');
    for (const order of rawOrders) {
      try {
        const trades = await mexc.getMyTrades(order.symbol, 100);
        console.log(`  ${order.symbol}: MEXC API returned ${Array.isArray(trades) ? trades.length : 0} live fills.`);
      } catch (e) {
        console.log(`  ${order.symbol}: Could not fetch live fills from MEXC (${e.message}).`);
      }
    }
  }

  console.log('\n========================================================================');
  console.log('🏆 AUDIT COMPLETE!');
  console.log('========================================================================\n');
}

auditMexcLiveTrades().catch(e => console.error(e));
