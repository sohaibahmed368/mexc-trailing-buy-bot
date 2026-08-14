const axios = require('axios');
const fs = require('fs');

function calculateRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50.0;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
}

// Generate 1-Month (30 Days = 2880 15m candles) of EUR/USDT
function generate1MonthEurUsdtCandles() {
  const days = 30;
  const totalSteps = days * 96;
  const basePrice = 1.0850;
  let price = basePrice;
  let seed = 77777;
  function prng() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  const startTime = Date.now() - (days * 24 * 3600 * 1000);
  const candles = [];
  for (let i = 0; i < totalSteps; i++) {
    const time = startTime + i * (15 * 60 * 1000);
    const delta = (prng() - 0.499) * 0.0006;
    price = Math.max(1.0400, Math.min(1.1100, price + delta));

    const open = price;
    const high = open * (1 + prng() * 0.0007);
    const low = open * (1 - prng() * 0.0007);
    const close = low + prng() * (high - low);
    const volume = 150000 + Math.floor(prng() * 500000);

    candles.push({ time, open, high, low, close, volume });
  }
  return candles;
}

function calculateObi(candle, rsi) {
  const wickRatio = (candle.close - candle.low) / (candle.high - candle.low + 0.00001);
  let baseObi = 50.0;
  if (rsi <= 55.0) {
    baseObi += (55.0 - rsi) * 0.7 + wickRatio * 10.0;
  } else {
    baseObi -= (rsi - 55.0) * 0.4;
  }
  const noise = ((candle.time % 997) / 997 - 0.5) * 4.0;
  return Math.min(95.0, Math.max(15.0, parseFloat((baseObi + noise).toFixed(2))));
}

function runHighFrequencyOptimization() {
  const candles = generate1MonthEurUsdtCandles();
  const closes = candles.map(c => c.close);
  const rsiValues = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < 16) {
      rsiValues.push(50.0);
    } else {
      const slice = closes.slice(Math.max(0, i - 16), i + 1);
      rsiValues.push(calculateRSI(slice, 14));
    }
  }

  const rsiList = [50, 52, 55, 58, 60];
  const obiList = [45, 48, 50, 52, 55];
  const tpList = [0.10, 0.12, 0.15, 0.18, 0.20];

  const results = [];

  for (const rsiThresh of rsiList) {
    for (const obiThresh of obiList) {
      for (const tpPct of tpList) {
        let cardStatus = 'PENDING_ACTIVATION';
        let entryPrice = 0;
        let entryTime = 0;
        let totalSignalHits = 0;
        let totalTpHits = 0;
        let totalSlHits = 0;
        let pendingCount = 0;
        const durations = [];

        for (let i = 16; i < candles.length; i++) {
          const candle = candles[i];
          const rsi = rsiValues[i];
          const obi = calculateObi(candle, rsi);

          if (cardStatus === 'PENDING_ACTIVATION') {
            if (obi >= obiThresh && rsi <= rsiThresh) {
              totalSignalHits++;
              cardStatus = 'HOLDING';
              entryPrice = candle.close;
              entryTime = candle.time;
            }
          } else if (cardStatus === 'HOLDING') {
            const tpPrice = entryPrice * (1 + (tpPct / 100));
            if (candle.high >= tpPrice) {
              totalTpHits++;
              const durMin = Math.max(15, Math.round((candle.time - entryTime) / 60000));
              durations.push(durMin);
              cardStatus = 'PENDING_ACTIVATION';
            } else if (rsi <= 20.0) {
              totalSlHits++;
              cardStatus = 'PENDING_ACTIVATION';
            }
          }
        }

        if (cardStatus === 'HOLDING') pendingCount = 1;

        const winRate = totalSignalHits > 0 ? ((totalTpHits / totalSignalHits) * 100).toFixed(1) : '0.0';
        const avgDurMin = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        const avgDurHours = (avgDurMin / 60).toFixed(1);
        const netProfitPct = (totalTpHits * tpPct).toFixed(2);

        results.push({
          rsiThresh,
          obiThresh,
          tpPct,
          totalSignalHits,
          totalTpHits,
          winRate: parseFloat(winRate),
          avgDurMin,
          avgDurHours,
          pendingCount,
          netProfitPct: parseFloat(netProfitPct)
        });
      }
    }
  }

  // Sort by highest number of total completed TP trades
  results.sort((a, b) => b.totalTpHits - a.totalTpHits);

  console.log('========================================================================');
  console.log('🚀 HIGH-FREQUENCY EUR/USDT 1-MONTH STRATEGY OPTIMIZATION');
  console.log('========================================================================\n');

  console.log('🏆 TOP 8 HIGHEST FREQUENCY & HIGHEST PROFIT COMBINATIONS:\n');
  console.log('Rank | OBI Threshold | RSI Threshold | TP % | Total Hits | TP Trades | Win Rate % | Avg TP Time | Net Return %');
  console.log('-----------------------------------------------------------------------------------------------------------------');

  results.slice(0, 8).forEach((r, idx) => {
    console.log(`#${(idx + 1).toString().padEnd(2)} | OBI >= ${r.obiThresh}%  | RSI <= ${r.rsiThresh}  | +${r.tpPct.toFixed(2)}% | ${r.totalSignalHits.toString().padEnd(10)} | ${r.totalTpHits.toString().padEnd(9)} | ${r.winRate.toFixed(1)}%     | ${r.avgDurMin}m (${r.avgDurHours}h) | +${r.netProfitPct.toFixed(2)}%`);
  });
}

runHighFrequencyOptimization();
