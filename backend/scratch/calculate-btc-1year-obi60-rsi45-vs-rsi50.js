const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper: Calculate RSI on candle array
function calculateRsiSeries(prices, period = 14) {
  const rsiValues = new Array(prices.length).fill(50.0);
  if (prices.length <= period) return rsiValues;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  if (avgLoss === 0) rsiValues[period] = 100.0;
  else {
    const rs = avgGain / avgLoss;
    rsiValues[period] = 100.0 - (100.0 / (1.0 + rs));
  }

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * 13 + gain) / 14;
    avgLoss = (avgLoss * 13 + loss) / 14;

    if (avgLoss === 0) rsiValues[i] = 100.0;
    else {
      const rs = avgGain / avgLoss;
      rsiValues[i] = 100.0 - (100.0 / (1.0 + rs));
    }
  }

  return rsiValues;
}

// Fetch historical candles from Binance (1 Year = 35000 candles)
function fetchBinanceCandles(symbol, interval = '15m', totalLimit = 35000) {
  return new Promise((resolve, reject) => {
    let allCandles = [];
    let endTime = Date.now();

    function fetchBatch() {
      const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000${endTime ? `&endTime=${endTime}` : ''}`;
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (!Array.isArray(parsed) || parsed.length === 0) {
              return resolve(allCandles.reverse());
            }
            allCandles = allCandles.concat(parsed);
            endTime = parsed[0][0] - 1;

            if (allCandles.length < totalLimit && parsed.length === 1000) {
              process.stdout.write(`\r📥 Fetched ${allCandles.length} candles for ${symbol}...`);
              setTimeout(fetchBatch, 80);
            } else {
              console.log(`\n   Fetched ${allCandles.length} candles for ${symbol}`);
              allCandles.sort((a, b) => a[0] - b[0]);
              resolve(allCandles);
            }
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    }

    fetchBatch();
  });
}

// Deterministic Synthetic OBI for historical candles
function getSyntheticObi(candle, prevCandle) {
  const open = parseFloat(candle[1]);
  const high = parseFloat(candle[2]);
  const low = parseFloat(candle[3]);
  const close = parseFloat(candle[4]);
  const volume = parseFloat(candle[5]);
  const takerBuyVolume = parseFloat(candle[9]);

  const range = (high - low) || 0.0001;
  const closePosition = (close - low) / range;
  const takerRatio = volume > 0 ? (takerBuyVolume / volume) : 0.5;

  let baseObi = 50.0 + (closePosition - 0.5) * 30.0 + (takerRatio - 0.5) * 40.0;
  baseObi = Math.max(25.0, Math.min(85.0, baseObi));

  return baseObi;
}

async function runBtcAudit() {
  console.log("================================================================================");
  console.log("🪙 BITCOIN (BTCUSDT) 1-YEAR OBI >= 60.0% & RSI <= 45 vs RSI < 50 AUDIT");
  console.log("================================================================================");

  const candles = await fetchBinanceCandles('BTCUSDT', '15m', 35000);
  const closePrices = candles.map(c => parseFloat(c[4]));
  
  // Calculate 15m RSI
  const rsi15m = calculateRsiSeries(closePrices, 14);

  // Calculate 4h 15m RSI (rolling 16 15m candles window)
  const rsi4h = new Array(candles.length).fill(50.0);
  for (let i = 15; i < candles.length; i++) {
    const windowSlice = rsi15m.slice(i - 15, i + 1);
    const avgWindowRsi = windowSlice.reduce((sum, val) => sum + val, 0) / windowSlice.length;
    rsi4h[i] = avgWindowRsi;
  }

  let countObi60Rsi45 = 0;
  let countObi60Rsi50 = 0;

  const matchesRsi45 = [];
  const matchesRsi50 = [];

  let lastSignal45Index = -100;
  let lastSignal50Index = -100;

  let distinctTrades45 = 0;
  let distinctTrades50 = 0;

  for (let i = 16; i < candles.length; i++) {
    const candle = candles[i];
    const openTimeStr = new Date(candle[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
    const closePrice = parseFloat(candle[4]);

    const rsiVal = rsi4h[i];
    const obiVal = getSyntheticObi(candle, candles[i - 1]);

    const isObi60 = (obiVal >= 60.0);
    const isRsi45 = (rsiVal <= 45.0);
    const isRsi50 = (rsiVal < 50.0);

    if (isObi60 && isRsi45) {
      countObi60Rsi45++;
      matchesRsi45.push({ index: i, time: openTimeStr, price: closePrice, obi: obiVal, rsi: rsiVal });
      if (i - lastSignal45Index >= 16) { // 4h Cooldown
        distinctTrades45++;
        lastSignal45Index = i;
      }
    }

    if (isObi60 && isRsi50) {
      countObi60Rsi50++;
      matchesRsi50.push({ index: i, time: openTimeStr, price: closePrice, obi: obiVal, rsi: rsiVal });
      if (i - lastSignal50Index >= 16) {
        distinctTrades50++;
        lastSignal50Index = i;
      }
    }
  }

  console.log("\n================================================================================");
  console.log("📊 BITCOIN (BTCUSDT) 1-YEAR AUDIT RESULTS SUMMARY");
  console.log("================================================================================");
  console.log(`1️⃣ CONDITION A: OBI >= 60.0% AND 4h 15m RSI <= 45.0`);
  console.log(`   - Total 15m Candles/Scans Matched: ${countObi60Rsi45} Candles`);
  console.log(`   - Distinct Trade Signal Entries Triggered (4h Cooldown): ${distinctTrades45} Trades`);

  console.log(`\n2️⃣ CONDITION B: OBI >= 60.0% AND 4h 15m RSI < 50.0`);
  console.log(`   - Total 15m Candles/Scans Matched: ${countObi60Rsi50} Candles`);
  console.log(`   - Distinct Trade Signal Entries Triggered (4h Cooldown): ${distinctTrades50} Trades`);

  console.log(`\n3️⃣ COMPARISON & DIFFERENCE:`);
  console.log(`   - RSI < 50 filter captures +${countObi60Rsi50 - countObi60Rsi45} more candles (+${(((countObi60Rsi50 - countObi60Rsi45) / countObi60Rsi45) * 100).toFixed(1)}%) than RSI <= 45.`);
  console.log(`   - Distinct Trade Entries increase from ${distinctTrades45} Trades (RSI <= 45) to ${distinctTrades50} Trades (RSI < 50).`);

  console.log("\n--------------------------------------------------------------------------------");
  console.log("📅 SAMPLE RECENT MATCHED TIMESTAMPS FOR BTC (RSI <= 45 & OBI >= 60%):");
  matchesRsi45.slice(-5).forEach((m, idx) => {
    console.log(`   [#${idx+1}] ${m.time} | BTC Price: $${m.price.toFixed(2)} USDT | OBI: ${m.obi.toFixed(1)}% | 4h 15m RSI: ${m.rsi.toFixed(1)}`);
  });

  console.log("\n--------------------------------------------------------------------------------");
  console.log("📅 SAMPLE RECENT MATCHED TIMESTAMPS FOR BTC (RSI < 50 & OBI >= 60%):");
  matchesRsi50.slice(-5).forEach((m, idx) => {
    console.log(`   [#${idx+1}] ${m.time} | BTC Price: $${m.price.toFixed(2)} USDT | OBI: ${m.obi.toFixed(1)}% | 4h 15m RSI: ${m.rsi.toFixed(1)}`);
  });

  const btcReport = {
    asset: 'BITCOIN (BTCUSDT)',
    totalCandles: candles.length,
    conditionA_Rsi45: {
      totalCandlesMatched: countObi60Rsi45,
      distinctTrades: distinctTrades45,
      samples: matchesRsi45.slice(-10)
    },
    conditionB_Rsi50: {
      totalCandlesMatched: countObi60Rsi50,
      distinctTrades: distinctTrades50,
      samples: matchesRsi50.slice(-10)
    }
  };

  fs.writeFileSync(
    path.join(__dirname, 'btc_obi60_rsi45_vs_rsi50_audit_report.json'),
    JSON.stringify(btcReport, null, 2)
  );

  console.log("\n✅ Saved complete BTC audit report to backend/btc_obi60_rsi45_vs_rsi50_audit_report.json");
}

runBtcAudit().catch(err => {
  console.error("❌ BTC Audit Error:", err);
});
