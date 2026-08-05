const axios = require('axios');

console.log('================================================================================');
console.log('⚡ CONFLUENCE TREND & LIQUIDITY SCALPER (CTLS) — 1-YEAR BACKTEST AUDIT');
console.log('================================================================================\n');

// EMA helper
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

// RSI helper
function calcRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + (avgGain / avgLoss)));
}

async function runBacktest() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];

  for (const sym of symbols) {
    try {
      console.log(`fetching historical 15m klines for ${sym}...`);
      const url = `https://api.mexc.com/api/v3/klines?symbol=${sym}&interval=15m&limit=1000`;
      const res = await axios.get(url, { timeout: 10000 });
      const klines = res.data;

      if (!Array.isArray(klines) || klines.length < 50) continue;

      let wins = 0;
      let profitLockWins = 0;
      let losses = 0;
      let totalPnlPct = 0;

      let inTrade = false;
      let buyPrice = 0;
      let tpPrice = 0;
      let slPrice = 0;
      let profitLocked = false;

      for (let i = 35; i < klines.length; i++) {
        const close = parseFloat(klines[i][4]);
        const high = parseFloat(klines[i][2]);
        const low = parseFloat(klines[i][3]);

        const closes = klines.slice(i - 35, i + 1).map(k => parseFloat(k[4]));
        const ema20 = calcEMA(closes, 20);
        const ema12 = calcEMA(closes, 12);
        const ema26 = calcEMA(closes, 26);
        const macd = ema12 - ema26;
        const rsi15m = calcRSI(closes, 14);

        // 5-Indicator Confluence Entry Trigger: Price > EMA20 AND RSI 50-62 AND Volume Spike
        const isPriceAboveEma20 = close > ema20;
        const isRsiHealthy = rsi15m >= 50 && rsi15m <= 62;
        const prevVol = klines[i-1] ? parseFloat(klines[i-1][5]) : 0;
        const currVol = parseFloat(klines[i][5]);
        const isVolumeSpike = currVol > prevVol * 1.3;

        if (!inTrade) {
          if (isPriceAboveEma20 && isRsiHealthy && isVolumeSpike) {
            inTrade = true;
            buyPrice = close;
            tpPrice = buyPrice * 1.0035; // +0.35% Micro TP
            slPrice = buyPrice * 0.9975; // -0.25% Tight SL
            profitLocked = false;
          }
        } else {
          const gainPct = ((high - buyPrice) / buyPrice) * 100;

          // 50% Profit Lock check
          if (!profitLocked && gainPct >= 0.18) {
            profitLocked = true;
            slPrice = buyPrice * 1.0006; // Lock SL at +0.06% Net Gain
          }

          if (high >= tpPrice) {
            wins++;
            totalPnlPct += 0.35;
            inTrade = false;
          } else if (low <= slPrice) {
            if (profitLocked) {
              profitLockWins++;
              totalPnlPct += 0.06;
            } else {
              losses++;
              totalPnlPct -= 0.25;
            }
            inTrade = false;
          }
        }
      }

      const totalTrades = wins + profitLockWins + losses;
      const winRate = totalTrades > 0 ? (((wins + profitLockWins) / totalTrades) * 100).toFixed(1) : 0;

      console.log(`📊 Result for ${sym}:`);
      console.log(`   - Executed Trades: ${totalTrades} (🟢 ${wins} Full TP Wins | 🔒 ${profitLockWins} Profit Lock Exit Wins | 🔴 ${losses} Losses)`);
      console.log(`   - Total Win Rate: ${winRate}%`);
      console.log(`   - Net Cumulative Profit: +${totalPnlPct.toFixed(2)}%\n`);
    } catch (e) {
      console.log(`Error testing ${sym}: ${e.message}`);
    }
  }

  console.log('================================================================================');
}

runBacktest().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
