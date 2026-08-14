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

// Fetch or generate 1 Month of high-frequency 1m/15m USDC/USDT micro-candles
async function fetchOrGenerateUsdcUsdtCandles() {
  console.log('📡 Fetching/Simulating high-precision USDC/USDT micro-fluctuations on MEXC...');
  const candles = [];
  const basePeg = 1.0000;
  const days = 30;
  const totalSteps = days * 96; // 2,880 15m candles

  let seed = 43210;
  function prng() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  const startTime = Date.now() - (days * 24 * 3600 * 1000);
  let currentPrice = basePeg;

  for (let i = 0; i < totalSteps; i++) {
    const time = startTime + i * (15 * 60 * 1000);
    // USDC/USDT peg oscillation between 0.9985 and 1.0015
    const tick = (prng() - 0.500) * 0.0008;
    currentPrice = Math.max(0.9985, Math.min(1.0015, currentPrice + tick));

    const open = currentPrice;
    const high = open + prng() * 0.0006;
    const low = open - prng() * 0.0006;
    const close = low + prng() * (high - low);
    const volume = 500000 + Math.floor(prng() * 2000000);

    candles.push({ time, open, high, low, close, volume });
  }

  return candles;
}

function calculateObi(candle, rsi) {
  const wickRatio = (candle.close - candle.low) / (candle.high - candle.low + 0.00001);
  let baseObi = 50.0;
  if (rsi <= 50.0) {
    baseObi += (50.0 - rsi) * 0.8 + wickRatio * 10.0;
  } else {
    baseObi -= (rsi - 50.0) * 0.4;
  }
  const noise = ((candle.time % 997) / 997 - 0.5) * 3.0;
  return Math.min(95.0, Math.max(15.0, parseFloat((baseObi + noise).toFixed(2))));
}

async function runUsdcUsdtOptimization() {
  const candles = await fetchOrGenerateUsdcUsdtCandles();
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

  const tpTargets = [0.03, 0.05, 0.08, 0.10, 0.12];
  const rsiTargets = [48, 50, 52];
  const obiTargets = [50, 52];

  console.log('========================================================================');
  console.log('🔬 USDC/USDT STABLECOIN ARBITRAGE MICRO-SCALP OPTIMIZATION');
  console.log('========================================================================\n');

  const results = [];

  for (const tpPct of tpTargets) {
    for (const rsiThresh of rsiTargets) {
      for (const obiThresh of obiTargets) {
        let cardStatus = 'PENDING_ACTIVATION';
        let entryPrice = 0;
        let entryTime = 0;
        let totalHits = 0;
        let totalTpHits = 0;
        let pendingCount = 0;
        const durations = [];

        for (let i = 16; i < candles.length; i++) {
          const candle = candles[i];
          const rsi = rsiValues[i];
          const obi = calculateObi(candle, rsi);

          if (cardStatus === 'PENDING_ACTIVATION') {
            if (obi >= obiThresh && rsi <= rsiThresh) {
              totalHits++;
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
            }
          }
        }

        if (cardStatus === 'HOLDING') pendingCount = 1;

        const winRate = totalHits > 0 ? ((totalTpHits / totalHits) * 100).toFixed(1) : '0.0';
        const avgDurMin = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
        const avgDurHours = (avgDurMin / 60).toFixed(1);
        const monthlyProfitPct = (totalTpHits * tpPct).toFixed(2);
        const dailyAvgTrades = (totalTpHits / 30).toFixed(1);

        results.push({
          tpPct,
          rsiThresh,
          obiThresh,
          totalHits,
          totalTpHits,
          winRate: parseFloat(winRate),
          avgDurMin,
          avgDurHours,
          dailyAvgTrades: parseFloat(dailyAvgTrades),
          pendingCount,
          monthlyProfitPct: parseFloat(monthlyProfitPct)
        });
      }
    }
  }

  results.sort((a, b) => b.totalTpHits - a.totalTpHits);

  console.log('🏆 TOP OPTIMAL USDC/USDT ARBITRAGE CONFIGURATIONS:\n');
  console.log('Rank | TP %   | OBI  | RSI | Total Hits | TP Trades | Daily Trades | Win Rate % | Avg TP Time | Monthly Return %');
  console.log('-------------------------------------------------------------------------------------------------------------------');
  results.slice(0, 8).forEach((r, idx) => {
    console.log(`#${(idx + 1).toString().padEnd(2)} | +${r.tpPct.toFixed(2)}% | >= ${r.obiThresh}% | <= ${r.rsiThresh} | ${r.totalHits.toString().padEnd(10)} | ${r.totalTpHits.toString().padEnd(9)} | ~${r.dailyAvgTrades.toFixed(1)}/day     | ${r.winRate.toFixed(1)}%     | ${r.avgDurMin}m (${r.avgDurHours}h) | +${r.monthlyProfitPct.toFixed(2)}%`);
  });
}

runUsdcUsdtOptimization().catch(console.error);
