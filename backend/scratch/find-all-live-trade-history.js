const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

console.log('================================================================================');
console.log('🔍 SCANNING ALL SYSTEM & LOG FILES FOR LIVE ACCOUNT TRADE HISTORIES & OBI DATA');
console.log('================================================================================\n');

async function scan() {
  const dirs = [
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..', '..', 'mexc-bot-deploy', 'backend'),
    path.join(__dirname, '..', '..', 'mexc-bot-deploy', 'backend', 'data')
  ];

  let foundFiles = [];

  dirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      files.forEach(f => {
        if (f.endsWith('.json') && (f.includes('order') || f.includes('log') || f.includes('trade'))) {
          foundFiles.push(path.join(dir, f));
        }
      });
    }
  });

  console.log(`Found ${foundFiles.length} potential trade storage files:\n`);

  let allTrades = [];

  foundFiles.forEach(fp => {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      if (raw.includes('tradeHistory') || raw.includes('sellExecutionPrice') || raw.includes('executionPrice')) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item.tradeHistory && Array.isArray(item.tradeHistory) && item.tradeHistory.length > 0) {
              item.tradeHistory.forEach(t => {
                allTrades.push({ symbol: item.symbol, ...t });
              });
            }
          });
        }
      }
    } catch (e) {}
  });

  console.log(`📋 Total Trade Records Found Across System: ${allTrades.length}\n`);

  if (allTrades.length > 0) {
    let winCount = 0, lossCount = 0;
    let winObiSum = 0, winObiCount = 0;
    let lossObiSum = 0, lossObiCount = 0;

    allTrades.forEach((t, idx) => {
      const buyP = t.executionPrice || t.buyPrice || 0;
      const sellP = t.sellExecutionPrice || t.sellPrice || 0;
      const pnl = t.netPnlUsdt !== undefined ? t.netPnlUsdt : (sellP - buyP);
      const isWin = pnl >= 0;
      const obiVal = t.obiBidsRatio !== undefined ? (t.obiBidsRatio * 100) : (t.obiPct || null);

      console.log(`${idx + 1}. [${t.symbol || 'PAIR'}] Buy: $${buyP} | Sell: $${sellP} | Net PnL: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(4)} USDT | OBI: ${obiVal ? obiVal.toFixed(1) + '%' : 'N/A'}`);

      if (isWin) {
        winCount++;
        if (obiVal !== null && !isNaN(obiVal)) { winObiSum += parseFloat(obiVal); winObiCount++; }
      } else {
        lossCount++;
        if (obiVal !== null && !isNaN(obiVal)) { lossObiSum += parseFloat(obiVal); lossObiCount++; }
      }
    });

    console.log('\n================================================================================');
    console.log('📊 STATISTICAL OBI SUMMARY FOR ACCOUNT TRADES:');
    console.log('================================================================================');
    console.log(`   🟢 Total Winning Trades: ${winCount} | Average OBI: ${winObiCount > 0 ? (winObiSum / winObiCount).toFixed(1) + '%' : 'N/A'}`);
    console.log(`   🔴 Total Losing Trades: ${lossCount} | Average OBI: ${lossObiCount > 0 ? (lossObiSum / lossObiCount).toFixed(1) + '%' : 'N/A'}`);
    console.log('================================================================================\n');
  } else {
    console.log('Fetching live trades from MEXC API directly using credentials...');
    try {
      const mexcClient = new MexcClient();
      await mexcClient.loadCredentialsFromFile();
      if (mexcClient.hasCredentials()) {
        const symbols = ['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BTCUSDT', 'DOGEUSDT'];
        for (const s of symbols) {
          const fills = await mexcClient.getAccountTradeHistory(s, 50);
          if (Array.isArray(fills) && fills.length > 0) {
            console.log(`\n📌 Live Exchange Fills for ${s} (${fills.length} Fills):`);
            fills.slice(0, 10).forEach(f => {
              console.log(`   - Side: ${f.side} | Price: $${f.price} | Qty: ${f.qty} | Time: ${new Date(f.time).toLocaleString()}`);
            });
          }
        }
      }
    } catch (e) {
      console.log(`Error querying MEXC API: ${e.message}`);
    }
  }
}

scan().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
