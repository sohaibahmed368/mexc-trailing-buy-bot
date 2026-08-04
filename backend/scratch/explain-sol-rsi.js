const https = require('https');

function fetchSOL15mKlines() {
  return new Promise((resolve) => {
    const url = 'https://api.mexc.com/api/v3/klines?symbol=SOLUSDT&interval=15m&limit=16';
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve([]);
        }
      });
    });
  });
}

async function explainRSI() {
  const klines = await fetchSOL15mKlines();
  if (!Array.isArray(klines) || klines.length < 15) {
    console.log('Failed to fetch klines');
    return;
  }

  console.log('================================================================================');
  console.log('📊 LIVE STEP-BY-STEP 15-MINUTE RSI AUDIT ON SOLANA (SOL/USDT)');
  console.log('================================================================================\n');

  console.log('14 PENDING 15-MINUTE CANDLES CLOSING PRICES (Last 3.5 Hours):\n');
  const candleData = [];
  let totalGain = 0;
  let totalLoss = 0;

  for (let i = 1; i <= 14; i++) {
    const prevClose = parseFloat(klines[i - 1][4]);
    const currClose = parseFloat(klines[i][4]);
    const diff = currClose - prevClose;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    totalGain += gain;
    totalLoss += loss;

    const timeStr = new Date(klines[i][0]).toLocaleTimeString();
    candleData.push({
      candle: `#${i}`,
      time: timeStr,
      prevClose: `$${prevClose.toFixed(2)}`,
      currClose: `$${currClose.toFixed(2)}`,
      change: `${diff >= 0 ? '+' : ''}$${diff.toFixed(2)}`,
      gain: `$${gain.toFixed(2)}`,
      loss: `$${loss.toFixed(2)}`
    });
  }

  console.table(candleData);

  const avgGain = totalGain / 14;
  const avgLoss = totalLoss / 14;
  const rs = avgLoss > 0 ? (avgGain / avgLoss) : 100;
  const rsi = avgLoss === 0 ? 100 : (100 - (100 / (1 + rs)));

  console.log('\n--------------------------------------------------------------------------------');
  console.log(`🧮 MATHEMATICAL SUMMARY (14 Candles Average):`);
  console.log(`- Total Gains in 14 Candles:  +$${totalGain.toFixed(4)}`);
  console.log(`- Total Losses in 14 Candles: -$${totalLoss.toFixed(4)}`);
  console.log(`- Average Gain (AvgGain):     +$${avgGain.toFixed(4)} per candle`);
  console.log(`- Average Loss (AvgLoss):     -$${avgLoss.toFixed(4)} per candle`);
  console.log(`- Relative Strength (RS):      ${rs.toFixed(4)} (AvgGain / AvgLoss)`);
  console.log(`- FINAL 15m RSI VALUE:        ${rsi.toFixed(1)} / 100`);
  console.log('--------------------------------------------------------------------------------\n');

  console.log('🎯 HOW TO INTERPRET TREND ON 15M CANDLES:');
  if (rsi >= 45) {
    console.log(`🟢 RSI = ${rsi.toFixed(1)} (>= 45): BULLISH / SIDEWAYS REBOUND ZONE`);
    console.log(`   - Meaning: Buyers are stronger than Sellers over the past 3.5 hours.`);
    console.log(`   - Action: STOP LOSS IS DISABLED (NO_SL) because dips will bounce back and fill TP!`);
  } else {
    console.log(`🔴 RSI = ${rsi.toFixed(1)} (< 40): BEARISH / DOWNTREND CRASH ZONE`);
    console.log(`   - Meaning: Sellers are dumping heavily over the past 3.5 hours.`);
    console.log(`   - Action: STOP LOSS IS ENABLED (SL_ACTIVE) to protect capital during crash!`);
  }
  console.log('================================================================================\n');
}

explainRSI();
