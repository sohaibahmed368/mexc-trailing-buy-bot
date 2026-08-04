const https = require('https');

function fetchUNI15mKlines() {
  return new Promise((resolve) => {
    const url = 'https://api.mexc.com/api/v3/klines?symbol=UNIUSDT&interval=15m&limit=16';
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

async function explainUNI() {
  const klines = await fetchUNI15mKlines();
  if (!Array.isArray(klines) || klines.length < 15) {
    console.log('Failed to fetch klines for UNIUSDT');
    return;
  }

  console.log('================================================================================');
  console.log('📊 REAL-TIME 15-MINUTE RSI & TREND AUDIT ON UNISWAP (UNI/USDT)');
  console.log('================================================================================\n');

  console.log('LAST 14 CANDLES OF 15-MINUTE TIMEFRAME (Last 3.5 Hours):\n');
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
      prevClose: `$${prevClose.toFixed(4)}`,
      currClose: `$${currClose.toFixed(4)}`,
      change: `${diff >= 0 ? '+' : ''}$${diff.toFixed(4)}`,
      gain: `$${gain.toFixed(4)}`,
      loss: `$${loss.toFixed(4)}`
    });
  }

  console.table(candleData);

  const avgGain = totalGain / 14;
  const avgLoss = totalLoss / 14;
  const rs = avgLoss > 0 ? (avgGain / avgLoss) : 100;
  const rsi = avgLoss === 0 ? 100 : (100 - (100 / (1 + rs)));

  const currentPrice = parseFloat(klines[klines.length - 1][4]);

  console.log('\n--------------------------------------------------------------------------------');
  console.log(`🧮 UNISWAP (UNI/USDT) METRICS SUMMARY:`);
  console.log(`- Current Live Price:       $${currentPrice.toFixed(4)} USDT`);
  console.log(`- Total Gains (14 candles): +$${totalGain.toFixed(4)}`);
  console.log(`- Total Losses (14 candles):-$${totalLoss.toFixed(4)}`);
  console.log(`- Average Gain per Candle:  +$${avgGain.toFixed(4)}`);
  console.log(`- Average Loss per Candle:  -$${avgLoss.toFixed(4)}`);
  console.log(`- Relative Strength (RS):   ${rs.toFixed(4)}`);
  console.log(`- 15-MINUTE RSI VALUE:     ${rsi.toFixed(1)} / 100`);
  console.log('--------------------------------------------------------------------------------\n');

  console.log('🎯 15-MINUTE TREND VERDICT & BOT ACTION:');
  if (rsi >= 45) {
    console.log(`🟢 TREND: BULLISH / SIDEWAYS REBOUND ZONE (RSI = ${rsi.toFixed(1)})`);
    console.log(`   └─ Action: NO-STOP-LOSS MODE (NO_SL) ACTIVE. Dips are safe to hold for TP!`);
  } else if (rsi <= 38) {
    console.log(`🔴 TREND: BEARISH / CRASHING ZONE (RSI = ${rsi.toFixed(1)})`);
    console.log(`   └─ Action: ACTIVE STOP LOSS (SL_ACTIVE) ENABLED to protect USDT capital.`);
  } else {
    console.log(`🟡 TREND: NEUTRAL CONSOLIDATION (RSI = ${rsi.toFixed(1)})`);
    console.log(`   └─ Action: ACTIVE STOP LOSS (SL_ACTIVE) ENABLED.`);
  }
  console.log('================================================================================\n');
}

explainUNI();
