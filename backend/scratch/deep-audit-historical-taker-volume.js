const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

const mexc = new MexcClient();

async function runDeepTradeHistoryAudit() {
  console.log('========================================================================');
  console.log('🔍 DEEP FORENSIC TRADE HISTORY & TAKER VOLUME ANALYSIS');
  console.log('========================================================================\n');

  const ordersPath = path.join(__dirname, '../data/orders.json');
  const stockOrdersPath = path.join(__dirname, '../data/alpaca-stock-orders.json');

  let cryptoOrders = [];
  let stockOrders = [];

  if (fs.existsSync(ordersPath)) {
    try {
      cryptoOrders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
    } catch (e) {}
  }

  if (fs.existsSync(stockOrdersPath)) {
    try {
      stockOrders = JSON.parse(fs.readFileSync(stockOrdersPath, 'utf8'));
    } catch (e) {}
  }

  console.log(`📦 Loaded Crypto Orders: ${cryptoOrders.length} | Stock Orders: ${stockOrders.length}\n`);

  // Extract all trade history items
  let allTrades = [];

  cryptoOrders.forEach(o => {
    if (Array.isArray(o.tradeHistory) && o.tradeHistory.length > 0) {
      o.tradeHistory.forEach((h, idx) => {
        allTrades.push({
          bot: 'Crypto (MEXC)',
          symbol: o.symbol,
          cycle: idx + 1,
          result: h.result || (h.pnlUsdt >= 0 ? 'WIN' : 'LOSS'),
          pnlUsdt: h.pnlUsdt || 0,
          pnlPct: h.pnlPct || 0,
          buyPrice: h.executionPrice || h.buyPrice || o.executionPrice,
          sellPrice: h.sellExecutionPrice || h.sellPrice,
          buyTime: h.buyTime || h.activatedAt || o.activatedAt,
          sellTime: h.sellTime || h.completedAt || h.timestamp,
          takeProfitSetting: o.takeProfit,
          stopLossSetting: o.stopLoss
        });
      });
    }
  });

  stockOrders.forEach(o => {
    if (Array.isArray(o.tradeHistory) && o.tradeHistory.length > 0) {
      o.tradeHistory.forEach((h, idx) => {
        allTrades.push({
          bot: 'Stock (Alpaca)',
          symbol: o.symbol,
          cycle: idx + 1,
          result: h.result || (h.pnlUsdt >= 0 ? 'WIN' : 'LOSS'),
          pnlUsdt: h.pnlUsdt || 0,
          pnlPct: h.pnlPct || 0,
          buyPrice: h.executionPrice || h.buyPrice || o.executionPrice,
          sellPrice: h.sellExecutionPrice || h.sellPrice,
          buyTime: h.buyTime || h.activatedAt || o.activatedAt,
          sellTime: h.sellTime || h.completedAt || h.timestamp,
          takeProfitSetting: o.takeProfit,
          stopLossSetting: o.stopLoss
        });
      });
    }
  });

  console.log(`------------------------------------------------------------------------`);
  console.log(`📊 TOTAL RECORDED EXECUTED TRADES IN HISTORY: ${allTrades.length}`);
  console.log(`------------------------------------------------------------------------\n`);

  if (allTrades.length === 0) {
    console.log('ℹ️ No completed trades found in historical order logs.');
  } else {
    let totalWins = 0;
    let totalLosses = 0;
    let cumPnL = 0;

    console.log(`Trade | Bot | Symbol | Result | Buy Price | Sell Price | Net PnL ($) | Net PnL (%) | Buy Time`);
    console.log(`------+-----+--------+--------+-----------+------------+-------------+-------------+---------`);

    allTrades.forEach((t, i) => {
      if (t.result === 'WIN' || t.pnlUsdt > 0) totalWins++; else totalLosses++;
      cumPnL += t.pnlUsdt;

      const idxStr = (i + 1).toString().padStart(5);
      const botStr = t.bot.padEnd(14);
      const symStr = t.symbol.padEnd(9);
      const resStr = (t.result || 'WIN').padEnd(6);
      const buyStr = t.buyPrice ? `$${t.buyPrice.toFixed(4)}`.padStart(9) : '-'.padStart(9);
      const sellStr = t.sellPrice ? `$${t.sellPrice.toFixed(4)}`.padStart(10) : '-'.padStart(10);
      const pnlStr = `$${t.pnlUsdt >= 0 ? '+' : ''}${t.pnlUsdt.toFixed(4)}`.padStart(11);
      const pctStr = `${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(2)}%`.padStart(11);
      const timeStr = t.buyTime ? t.buyTime.substring(11, 19) : '-';

      console.log(`${idxStr} | ${botStr} | ${symStr} | ${resStr} | ${buyStr} | ${sellStr} | ${pnlStr} | ${pctStr} | ${timeStr}`);
    });

    const totalTrades = totalWins + totalLosses;
    const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0.0';

    console.log('\n========================================================================');
    console.log('📈 AGGREGATED TRADE HISTORY SUMMARY:');
    console.log('========================================================================');
    console.log(`  Total Trades Executed: ${totalTrades}`);
    console.log(`  🟢 Total Wins:          ${totalWins}`);
    console.log(`  🔴 Total Losses:        ${totalLosses}`);
    console.log(`  📊 Overall Win Rate:    ${winRate}%`);
    console.log(`  💰 Cumulative Net PnL:  $${cumPnL >= 0 ? '+' : ''}${cumPnL.toFixed(4)} USDT`);
    console.log('========================================================================\n');
  }

  // 40-Second Taker Volume Microstructure Simulation on Recent Market Trades for Active Coins
  console.log('------------------------------------------------------------------------');
  console.log('🔬 40-SECOND TAKER BUY VOLUME DELTA SNAPSHOT FOR TRACKED COINS:');
  console.log('------------------------------------------------------------------------');

  const activeSymbols = cryptoOrders.map(o => o.symbol);
  for (const sym of activeSymbols) {
    try {
      const trades = await mexc.getRecentTrades(sym, 100);
      if (Array.isArray(trades) && trades.length > 0) {
        const now = Date.now();
        let buyVol = 0;
        let sellVol = 0;
        trades.forEach(t => {
          const tTime = parseInt(t.time || t.timestamp || now);
          if (now - tTime <= 40000) {
            const val = parseFloat(t.qty || 0) * parseFloat(t.price || 0);
            if (t.isBuyerMaker) sellVol += val; else buyVol += val;
          }
        });
        const total = buyVol + sellVol;
        const buyPct = total > 0 ? ((buyVol / total) * 100).toFixed(1) : '50.0';
        const sellPct = total > 0 ? ((sellVol / total) * 100).toFixed(1) : '50.0';
        console.log(`  ${sym.padEnd(10)}: Last 40s Taker Buy Volume = ${buyPct}% ($${buyVol.toFixed(2)} USDT) | Taker Sell Volume = ${sellPct}% ($${sellVol.toFixed(2)} USDT)`);
      }
    } catch (e) {}
  }

  console.log('\n========================================================================');
  console.log('🏆 AUDIT COMPLETE');
  console.log('========================================================================\n');
}

runDeepTradeHistoryAudit().catch(e => console.error(e));
