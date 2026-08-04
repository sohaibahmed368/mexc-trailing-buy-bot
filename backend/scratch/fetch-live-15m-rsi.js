const https = require('https');

function fetchKlines(symbol) {
  return new Promise((resolve, reject) => {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=25`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', err => resolve([]));
  });
}

function calculateRSI(closes) {
  if (closes.length < 15) return 50.0;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < 15; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / 14;
  let avgLoss = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) {
      avgGain = (avgGain * 13 + diff) / 14;
      avgLoss = (avgLoss * 13) / 14;
    } else {
      avgGain = (avgGain * 13) / 14;
      avgLoss = (avgLoss * 13 - diff) / 14;
    }
  }
  if (avgLoss === 0) return 100.0;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - (100 / (1 + rs))).toFixed(1));
}

async function run() {
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT', 'XAUTUSDT', 'BNBUSDT', 'NEARUSDT', 'LINKUSDT', 'UNIUSDT'];
  console.log('================================================================================');
  console.log('📊 REAL-TIME 15-MINUTE RSI & TREND ANALYSIS (BTC, ETH, SOL, GOLD)');
  console.log('================================================================================\n');

  for (const sym of symbols) {
    const klines = await fetchKlines(sym);
    if (!Array.isArray(klines) || klines.length < 15) continue;

    const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
    const currentPrice = closes[closes.length - 1];
    const rsi15m = calculateRSI(closes);

    let trendStatus = '';
    let mode = '';

    if (rsi15m >= 45) {
      trendStatus = '🟢 BULLISH / SIDEWAYS (Healthy Rebound Zone)';
      mode = '🛡️ NO-SL MODE (Stop Loss Disabled - Hold for TP)';
    } else if (rsi15m <= 38) {
      trendStatus = '🔴 BEARISH / CRASHING TREND';
      mode = '⚠️ SL ACTIVE (Stop Loss Enabled to Protect USDT)';
    } else {
      trendStatus = '🟡 NEUTRAL / CONSOLIDATION';
      mode = '⚠️ SL ACTIVE (Stop Loss Enabled)';
    }

    console.log(`🪙 Asset: ${sym.padEnd(10)} | Price: $${currentPrice.toFixed(2).padEnd(10)} | 15m RSI: ${rsi15m.toFixed(1).padEnd(5)} | Trend: ${trendStatus}`);
    console.log(`   └─ Adaptive Hybrid Action: ${mode}\n`);
  }
  console.log('================================================================================\n');
}

run();
