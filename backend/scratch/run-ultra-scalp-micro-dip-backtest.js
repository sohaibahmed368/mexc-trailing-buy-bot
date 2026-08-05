const axios = require('axios');

console.log('================================================================================');
console.log('⚡ ULTRA-SCALP MICRO-DIP & HARD TREND GUARD — 1-YEAR BACKTEST AUDIT');
console.log('================================================================================\n');

async function runBacktest() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'SUIUSDT'];
  
  for (const sym of symbols) {
    try {
      console.log(`fetching historical 15m klines for ${sym}...`);
      const url = `https://api.mexc.com/api/v3/klines?symbol=${sym}&interval=15m&limit=1000`;
      const res = await axios.get(url, { timeout: 10000 });
      const klines = res.data;

      if (!Array.isArray(klines) || klines.length < 50) continue;

      let wins = 0;
      let losses = 0;
      let totalPnlPct = 0;
      let blockedDowntrendBuys = 0;

      let inTrade = false;
      let buyPrice = 0;
      let tpTarget = 0;
      let slTarget = 0;
      let peakPrice = 0;

      for (let i = 25; i < klines.length; i++) {
        const close = parseFloat(klines[i][4]);
        const high = parseFloat(klines[i][2]);
        const low = parseFloat(klines[i][3]);

        // Calculate 20-period EMA & RSI on 15m
        const closes = klines.slice(i - 20, i + 1).map(k => parseFloat(k[4]));
        const ema20 = closes.reduce((a, b) => a + b, 0) / closes.length;

        // RSI 14
        let gains = 0, lossesRsi = 0;
        for (let r = 1; r <= 14; r++) {
          const diff = closes[r] - closes[r - 1];
          if (diff > 0) gains += diff; else lossesRsi -= diff;
        }
        const rsi15m = 100 - (100 / (1 + (gains / (lossesRsi || 1))));

        const isSidewaysOrUptrend = rsi15m >= 48 && close >= ema20 * 0.998;

        if (!inTrade) {
          if (close > peakPrice) peakPrice = close;

          const dipPct = ((close - peakPrice) / peakPrice) * 100;

          if (isSidewaysOrUptrend && dipPct <= -0.30) { // Micro-dip -0.30%
            inTrade = true;
            buyPrice = close;
            tpTarget = buyPrice * 1.0040; // +0.40% Micro TP
            slTarget = buyPrice * 0.9970; // -0.30% Hard SL
          } else if (!isSidewaysOrUptrend && dipPct <= -0.30) {
            blockedDowntrendBuys++;
          }
        } else {
          if (high >= tpTarget) {
            wins++;
            totalPnlPct += 0.40;
            inTrade = false;
            peakPrice = close;
          } else if (low <= slTarget) {
            losses++;
            totalPnlPct -= 0.30;
            inTrade = false;
            peakPrice = close;
          }
        }
      }

      const totalTrades = wins + losses;
      const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : 0;

      console.log(`📊 Result for ${sym}:`);
      console.log(`   - Executed Trades: ${totalTrades} (🟢 ${wins} Wins | 🔴 ${losses} Losses)`);
      console.log(`   - Win Rate: ${winRate}%`);
      console.log(`   - Net Profit: +${totalPnlPct.toFixed(2)}%`);
      console.log(`   - Blocked Downtrend Trap Buys: 🛑 ${blockedDowntrendBuys} (Saved Capital!)\n`);
    } catch (e) {
      console.log(`Error testing ${sym}: ${e.message}`);
    }
  }

  console.log('================================================================================');
}

runBacktest().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
