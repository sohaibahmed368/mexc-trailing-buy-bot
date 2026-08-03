const fs = require('fs');
const path = require('path');
const axios = require('axios');

console.log('================================================================');
console.log('🔬 DIAGNOSTIC AUDIT: WHY DID BOT MISS BTC $62,000 -> $64,086 PUMP?');
console.log('================================================================\n');

async function analyzeBtcMove() {
  try {
    // Fetch last 500 15m klines for BTCUSDT from MEXC API
    console.log('📡 Fetching BTCUSDT 15m Klines from MEXC API...');
    const res = await axios.get('https://api.mexc.com/api/v3/klines', {
      params: { symbol: 'BTCUSDT', interval: '15m', limit: 100 },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    if (Array.isArray(res.data) && res.data.length > 0) {
      const klines = res.data.map(k => ({
        time: new Date(k[0]).toISOString().substring(11, 19),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));

      console.log(`✅ Loaded ${klines.length} klines for BTCUSDT.\n`);

      // Find lowest bottom in recent range
      let minLow = 999999;
      let minIdx = -1;
      klines.forEach((k, idx) => {
        if (k.low < minLow) {
          minLow = k.low;
          minIdx = idx;
        }
      });

      console.log(`📌 Lowest Local Bottom Found: $${minLow} at candle index ${minIdx} (${klines[minIdx].time})`);

      // Evaluate indicators during the bounce after minLow
      console.log('\n📊 Candle-by-Candle Indicator Evaluation During Rebound:');
      console.log('---------------------------------------------------------------------------------------------------------------------------------');
      console.log('| Time     | Open    | High    | Low     | Close   | Vol Ratio | RSI (14) | Vol Spike (1.5x) | RSI <=35 | Overall Pass (4/4) |');
      console.log('---------------------------------------------------------------------------------------------------------------------------------');

      for (let i = Math.max(15, minIdx); i < Math.min(klines.length, minIdx + 20); i++) {
        const bar = klines[i];
        const pastCloses = klines.slice(i - 14, i + 1).map(k => k.close);
        
        // Calculate RSI
        let gains = 0, losses = 0;
        for (let r = 1; r < pastCloses.length; r++) {
          const diff = pastCloses[r] - pastCloses[r - 1];
          if (diff >= 0) gains += diff;
          else losses -= diff;
        }
        const avgGain = gains / 14;
        const avgLoss = losses / 14;
        const rs = avgLoss === 0 ? 100 : (avgGain / avgLoss);
        const rsi = 100 - (100 / (1 + rs));

        // Calculate Volume Spike
        let volSum = 0;
        for (let v = i - 5; v < i; v++) volSum += klines[v].volume;
        const avgVol = volSum / 5;
        const volRatio = avgVol > 0 ? (bar.volume / avgVol) : 1.0;

        const volPass = volRatio >= 1.5;
        const rsiPass = rsi <= 35;

        // Simulated OBI & 40s Vol (Assume 65% on rebound)
        const obiPass = true;
        const takerPass = true;

        const all4Pass = volPass && rsiPass && obiPass && takerPass;

        console.log(`| ${bar.time} | $${bar.open.toFixed(1)} | $${bar.high.toFixed(1)} | $${bar.low.toFixed(1)} | $${bar.close.toFixed(1)} | ${volRatio.toFixed(2)}x      | ${rsi.toFixed(1)}     | ${volPass ? '✅ PASS' : '❌ FAIL'}   | ${rsiPass ? '✅ PASS' : '❌ FAIL'}  | ${all4Pass ? '🎯 BOUGHT' : '⏳ SKIPPED'}         |`);
      }
      console.log('---------------------------------------------------------------------------------------------------------------------------------');
    }
  } catch (e) {
    console.error('Error analyzing BTC move:', e.message);
  }
}

analyzeBtcMove();
