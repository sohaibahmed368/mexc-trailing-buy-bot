const axios = require('axios');

console.log('================================================================================');
console.log('🔬 NO_SL MODE SIMULATION AUDIT: OBI >= 70% SIGNALS (AUG 1 - AUG 6, 2026)');
console.log('   Target: +0.60% Take Profit | NO STOP LOSS (Hold for TP)');
console.log('================================================================================\n');

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

async function auditNoSlCoin(symbol) {
  try {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=1000`;
    const res = await axios.get(url, { timeout: 10000 });
    const klines = res.data;

    if (!Array.isArray(klines)) return;

    const augStart = new Date('2026-08-01T00:00:00Z').getTime();
    const augEnd = new Date('2026-08-06T23:59:59Z').getTime();

    let signals = [];

    for (let i = 20; i < klines.length; i++) {
      const timeMs = parseInt(klines[i][0]);
      if (timeMs < augStart || timeMs > augEnd) continue;

      const closes = klines.slice(i - 20, i + 1).map(k => parseFloat(k[4]));
      const rsi = calcRSI(closes, 14);
      const vol = parseFloat(klines[i][5]);

      let prevVolSum = 0;
      for (let v = i - 5; v < i; v++) prevVolSum += parseFloat(klines[v][5]);
      const avgVol = prevVolSum / 5;

      let obiPct = 50.0;
      if (rsi >= 50) {
        const volRatio = avgVol > 0 ? (vol / avgVol) : 1.0;
        obiPct = 50.0 + (rsi - 50) * 0.6 + (volRatio > 1.2 ? (volRatio - 1.2) * 8.0 : 0);
      }

      // Signal triggered when OBI >= 70%
      if (obiPct >= 70.0) {
        signals.push({
          idx: i,
          timeMs,
          timeStr: new Date(timeMs).toLocaleString('en-US', { timeZone: 'UTC' }),
          entryPrice: parseFloat(klines[i][4])
        });
      }
    }

    let hitTpCount = 0;
    let pendingHoldingCount = 0;
    let details = [];

    // Evaluate each signal to see if +0.60% TP is hit before candle data ends
    signals.forEach(sig => {
      const targetTpPrice = sig.entryPrice * 1.0060;
      let tpResolved = false;

      for (let j = sig.idx + 1; j < klines.length; j++) {
        const candleHigh = parseFloat(klines[j][2]);
        if (candleHigh >= targetTpPrice) {
          tpResolved = true;
          const durationCandles = j - sig.idx;
          const durationMinutes = durationCandles * 15;
          details.push({
            status: '🟢 TP HIT',
            time: sig.timeStr,
            entry: sig.entryPrice.toFixed(2),
            tpPrice: targetTpPrice.toFixed(2),
            duration: `${durationMinutes} mins (${(durationMinutes/60).toFixed(1)} hrs)`
          });
          break;
        }
      }

      if (tpResolved) {
        hitTpCount++;
      } else {
        pendingHoldingCount++;
        const currentPrice = parseFloat(klines[klines.length - 1][4]);
        const drawdownPct = (((currentPrice - sig.entryPrice) / sig.entryPrice) * 100).toFixed(2);
        details.push({
          status: '⏳ PENDING (HOLDING)',
          time: sig.timeStr,
          entry: sig.entryPrice.toFixed(2),
          current: currentPrice.toFixed(2),
          drawdown: `${drawdownPct}%`
        });
      }
    });

    console.log(`================================================================================`);
    console.log(`📊 ${symbol} RESULTS (6 DAYS: AUG 1 - AUG 6, 2026):`);
    console.log(`================================================================================`);
    console.log(`   - Total Signals Triggered: ${signals.length} Signals`);
    console.log(`   - 🟢 Hit +0.60% Take Profit: ${hitTpCount} Trades (${signals.length > 0 ? ((hitTpCount/signals.length)*100).toFixed(1) : 0}%)`);
    console.log(`   - ⏳ Pending / Holding in Drawdown: ${pendingHoldingCount} Trades\n`);

    details.slice(0, 15).forEach((d, idx) => {
      if (d.status.includes('TP HIT')) {
        console.log(`  ${idx + 1}. 🟢 ${d.time} | Entry: $${d.entry} -> TP $${d.tpPrice} | Hit Time: ${d.duration}`);
      } else {
        console.log(`  ${idx + 1}. ⏳ ${d.time} | Entry: $${d.entry} -> Current: $${d.current} | Drawdown: ${d.drawdown}`);
      }
    });
    console.log('\n');

  } catch (e) {
    console.log(`Error auditing ${symbol}: ${e.message}`);
  }
}

async function runAll() {
  await auditNoSlCoin('ETHUSDT');
  await auditNoSlCoin('SOLUSDT');
  await auditNoSlCoin('BTCUSDT');
  console.log('================================================================================\n');
}

runAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
