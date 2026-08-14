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

// Full 1-Year realistic Forex EURUSDT candle generator
function generate1YearEurUsdtCandles() {
  const candles = [];
  const basePrice = 1.0850;
  const days = 365;
  const totalSteps = days * 96; // 35,040 15m candles
  let price = basePrice;
  let seed = 98765;
  function prng() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  const startTime = Date.now() - (days * 24 * 3600 * 1000);
  for (let i = 0; i < totalSteps; i++) {
    const time = startTime + i * (15 * 60 * 1000);
    // Forex EUR/USDT daily drift + noise
    const delta = (prng() - 0.499) * 0.0006;
    price = Math.max(1.0200, Math.min(1.1300, price + delta));

    const open = price;
    const high = open * (1 + prng() * 0.0007);
    const low = open * (1 - prng() * 0.0007);
    const close = low + prng() * (high - low);
    const volume = 150000 + Math.floor(prng() * 600000);

    candles.push({ time, open, high, low, close, volume });
  }
  return candles;
}

function calculateObi(candle, rsi) {
  const wickRatio = (candle.close - candle.low) / (candle.high - candle.low + 0.00001);
  let baseObi = 50.0;
  if (rsi <= 45.0) {
    baseObi += (45.0 - rsi) * 0.9 + wickRatio * 12.0;
  } else {
    baseObi -= (rsi - 45.0) * 0.4;
  }
  const noise = ((candle.time % 997) / 997 - 0.5) * 4.0;
  return Math.min(95.0, Math.max(15.0, parseFloat((baseObi + noise).toFixed(2))));
}

function runComparison() {
  const candles = generate1YearEurUsdtCandles();
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

  const tpOptions = [0.10, 0.15, 0.20, 0.25, 0.30, 0.60];
  console.log('========================================================================');
  console.log('📊 1-YEAR EUR/USDT TAKE PROFIT COMPARISON (OBI >= 55%, RSI <= 45)');
  console.log('========================================================================\n');

  tpOptions.forEach(tpPct => {
    let cardStatus = 'PENDING_ACTIVATION';
    let entryPrice = 0;
    let entryTime = 0;
    let totalHits = 0;
    let totalTpHits = 0;
    let totalSlHits = 0;
    const durationsMin = [];

    for (let i = 16; i < candles.length; i++) {
      const candle = candles[i];
      const rsi = rsiValues[i];
      const obi = calculateObi(candle, rsi);

      if (cardStatus === 'PENDING_ACTIVATION') {
        if (obi >= 55.0 && rsi <= 45.0) {
          totalHits++;
          cardStatus = 'HOLDING';
          entryPrice = candle.close;
          entryTime = candle.time;
        }
      } else if (cardStatus === 'HOLDING') {
        const tpPrice = entryPrice * (1 + (tpPct / 100));
        if (candle.high >= tpPrice) {
          totalTpHits++;
          const durationMin = Math.max(15, Math.round((candle.time - entryTime) / 60000));
          durationsMin.push(durationMin);
          cardStatus = 'PENDING_ACTIVATION';
        } else if (rsi <= 20.0) {
          totalSlHits++;
          cardStatus = 'PENDING_ACTIVATION';
        }
      }
    }

    const winRate = totalHits > 0 ? ((totalTpHits / totalHits) * 100).toFixed(1) : '0.0';
    const avgDurationMin = durationsMin.length > 0 ? Math.round(durationsMin.reduce((a, b) => a + b, 0) / durationsMin.length) : 0;
    const avgDurationHours = (avgDurationMin / 60).toFixed(1);
    const netReturn = (totalTpHits * tpPct).toFixed(2);

    console.log(`📌 Take Profit +${tpPct.toFixed(2)}%:`);
    console.log(`   - Signal Hits: ${totalHits} | Completed TP Trades: ${totalTpHits} (${winRate}% Win Rate)`);
    console.log(`   - Avg Time to Hit TP: ${avgDurationMin} min (${avgDurationHours} hours)`);
    console.log(`   - Emergency SL (RSI <= 20): ${totalSlHits}`);
    console.log(`   - Total Net Return: +${netReturn}%\n`);
  });
}

runComparison();
