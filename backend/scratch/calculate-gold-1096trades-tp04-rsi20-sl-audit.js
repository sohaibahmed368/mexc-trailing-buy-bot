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

async function runGold1096TradesAudit() {
  console.log("================================================================================");
  console.log("🥇 GOLD 1,096 TRADES AUDIT: +0.40% TP vs RSI <= 20.0 EMERGENCY SL");
  console.log("================================================================================");

  const candles = await fetchBinanceCandles('PAXGUSDT', '15m', 35000);
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

  // Find all 1,096 distinct trade entry signals
  let lastSignalIndex = -16;
  const trades = [];

  for (let i = 16; i < candles.length; i++) {
    const candle = candles[i];
    const rsiVal = rsi4h[i];
    const obiVal = getSyntheticObi(candle, candles[i - 1]);

    if (obiVal >= 55.0 && rsiVal < 50.0) {
      if (i - lastSignalIndex >= 16) { // 4h Cooldown
        lastSignalIndex = i;
        trades.push({
          tradeIndex: trades.length + 1,
          entryCandleIndex: i,
          entryTime: new Date(candle[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT',
          entryPrice: parseFloat(candle[4]),
          entryObi: obiVal,
          entryRsi: rsiVal
        });
      }
    }
  }

  console.log(`\n📌 Total Distinct Trades Identified: ${trades.length} Trades`);

  let totalTpHits = 0;
  let totalRsiSlHits = 0;
  let totalPending = 0;

  const tpHitTrades = [];
  const rsiSlHitTrades = [];

  let totalTpDurationMinutes = 0;
  let totalSlDurationMinutes = 0;

  const TP_TARGET_PCT = 0.40; // +0.40% Take Profit
  const RSI_SL_THRESHOLD = 20.0; // RSI <= 20.0 Emergency SL

  for (const trade of trades) {
    const entryPrice = trade.entryPrice;
    const tpTargetPrice = entryPrice * (1 + TP_TARGET_PCT / 100.0);

    let outcome = 'PENDING';
    let exitTime = null;
    let exitPrice = null;
    let durationCandles = 0;

    for (let j = trade.entryCandleIndex + 1; j < candles.length; j++) {
      const c = candles[j];
      const candleHigh = parseFloat(c[2]);
      const candleLow = parseFloat(c[3]);
      const currentRsi = rsi4h[j];
      durationCandles++;

      // Check 1: Did price reach +0.40% Take Profit Target?
      if (candleHigh >= tpTargetPrice) {
        outcome = 'TAKE_PROFIT';
        exitTime = new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
        exitPrice = tpTargetPrice;
        break;
      }

      // Check 2: Did 4h 15m RSI drop <= 20.0 (Emergency Crash SL)?
      if (currentRsi <= RSI_SL_THRESHOLD) {
        outcome = 'RSI_EMERGENCY_SL';
        exitTime = new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
        exitPrice = parseFloat(c[4]); // Market sell at close price
        break;
      }
    }

    trade.outcome = outcome;
    trade.exitTime = exitTime;
    trade.exitPrice = exitPrice;
    trade.durationMinutes = durationCandles * 15;

    if (outcome === 'TAKE_PROFIT') {
      totalTpHits++;
      totalTpDurationMinutes += trade.durationMinutes;
      tpHitTrades.push(trade);
    } else if (outcome === 'RSI_EMERGENCY_SL') {
      totalRsiSlHits++;
      totalSlDurationMinutes += trade.durationMinutes;
      rsiSlHitTrades.push(trade);
    } else {
      totalPending++;
    }
  }

  const winRate = ((totalTpHits / trades.length) * 100).toFixed(2);
  const rsiSlRate = ((totalRsiSlHits / trades.length) * 100).toFixed(2);
  const avgTpDurationHours = (totalTpDurationMinutes / (totalTpHits || 1) / 60).toFixed(2);
  const avgSlDurationHours = (totalSlDurationMinutes / (totalRsiSlHits || 1) / 60).toFixed(2);

  console.log("\n================================================================================");
  console.log("🏆 GOLD 1,096 TRADES SIMULATION AUDIT RESULTS");
  console.log("================================================================================");
  console.log(`🔹 Total Trade Signal Entries Evaluated: ${trades.length} Trades`);
  console.log(`🟢 Total Take Profit Hits (+0.40% TP Target): ${totalTpHits} Trades (${winRate}% Win Rate)`);
  console.log(`🚨 Total Emergency RSI <= 20.0 Stop Loss Hits: ${totalRsiSlHits} Trades (${rsiSlRate}% SL Rate)`);
  console.log(`⏳ Still Pending / Open at end of dataset: ${totalPending} Trades`);
  console.log(`⏱️ Average Time to Hit +0.40% Take Profit: ${avgTpDurationHours} Hours (${(avgTpDurationHours * 60).toFixed(0)} Mins)`);
  if (totalRsiSlHits > 0) {
    console.log(`⏱️ Average Time to Trigger RSI <= 20.0 SL: ${avgSlDurationHours} Hours`);
  }

  console.log("\n--------------------------------------------------------------------------------");
  console.log("📅 SAMPLE TAKE PROFIT SUCCESSFUL TRADES (+0.40% HIT):");
  tpHitTrades.slice(0, 5).forEach((t) => {
    console.log(`   Trade #${t.tradeIndex} | Entry: ${t.entryTime} @ $${t.entryPrice.toFixed(2)} | Exit: ${t.exitTime} @ $${t.exitPrice.toFixed(2)} | Duration: ${t.durationMinutes} mins`);
  });

  if (rsiSlHitTrades.length > 0) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("📅 SAMPLE EMERGENCY RSI <= 20.0 STOP LOSS TRADES:");
    rsiSlHitTrades.forEach((t) => {
      console.log(`   Trade #${t.tradeIndex} | Entry: ${t.entryTime} @ $${t.entryPrice.toFixed(2)} | Exit: ${t.exitTime} @ $${t.exitPrice.toFixed(2)} | Duration: ${t.durationMinutes} mins | Exit RSI: <= 20.0`);
    });
  }

  const fullReport = {
    totalTrades: trades.length,
    takeProfitHits: totalTpHits,
    winRatePct: parseFloat(winRate),
    rsiSlHits: totalRsiSlHits,
    rsiSlRatePct: parseFloat(rsiSlRate),
    pendingTrades: totalPending,
    avgTpDurationHours: parseFloat(avgTpDurationHours),
    avgSlDurationHours: totalRsiSlHits > 0 ? parseFloat(avgSlDurationHours) : 0,
    sampleTpHitTrades: tpHitTrades.slice(0, 10),
    sampleRsiSlHitTrades: rsiSlHitTrades
  };

  fs.writeFileSync(
    path.join(__dirname, 'gold_1096trades_tp04_rsi20_audit_report.json'),
    JSON.stringify(fullReport, null, 2)
  );

  console.log("\n✅ Saved complete Gold 1,096 trades report to backend/gold_1096trades_tp04_rsi20_audit_report.json");
}

runGold1096TradesAudit().catch(err => {
  console.error("❌ Gold 1096 Trades Audit Error:", err);
});
