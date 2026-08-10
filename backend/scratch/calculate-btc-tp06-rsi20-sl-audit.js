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

// Simulation Engine for a given list of trade entries
function simulateTrades(trades, candles, rsi4h, tpPct = 0.60, rsiSlThreshold = 20.0, positionSizeUsdt = 100.0) {
  let tpHits = 0;
  let rsiSlHits = 0;
  let pendingCount = 0;

  let grossProfitUsdt = 0;
  let grossLossUsdt = 0;

  const tpTradeList = [];
  const slTradeList = [];

  for (const trade of trades) {
    const entryPrice = trade.entryPrice;
    const tpTargetPrice = entryPrice * (1 + tpPct / 100.0);

    let outcome = 'PENDING';
    let exitTime = null;
    let exitPrice = null;
    let durationCandles = 0;

    for (let j = trade.entryIndex + 1; j < candles.length; j++) {
      const c = candles[j];
      const candleHigh = parseFloat(c[2]);
      const currentRsi = rsi4h[j];
      durationCandles++;

      // 1. Check Take Profit Target (+0.60%)
      if (candleHigh >= tpTargetPrice) {
        outcome = 'TAKE_PROFIT';
        exitTime = new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
        exitPrice = tpTargetPrice;
        break;
      }

      // 2. Check Emergency Stop Loss (4h 15m RSI <= 20.0)
      if (currentRsi <= rsiSlThreshold) {
        outcome = 'RSI_EMERGENCY_SL';
        exitTime = new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
        exitPrice = parseFloat(c[4]);
        break;
      }
    }

    trade.outcome = outcome;
    trade.exitTime = exitTime;
    trade.exitPrice = exitPrice;
    trade.durationMinutes = durationCandles * 15;

    if (outcome === 'TAKE_PROFIT') {
      tpHits++;
      const profitUsdt = positionSizeUsdt * (tpPct / 100.0); // +$0.60 USDT
      grossProfitUsdt += profitUsdt;
      trade.profitUsdt = profitUsdt;
      tpTradeList.push(trade);
    } else if (outcome === 'RSI_EMERGENCY_SL') {
      rsiSlHits++;
      const lossPct = ((exitPrice - entryPrice) / entryPrice) * 100.0;
      const lossUsdt = positionSizeUsdt * (lossPct / 100.0);
      grossLossUsdt += Math.abs(lossUsdt);
      trade.lossPct = lossPct;
      trade.lossUsdt = lossUsdt;
      slTradeList.push(trade);
    } else {
      pendingCount++;
    }
  }

  const netProfitUsdt = grossProfitUsdt - grossLossUsdt;
  const winRatePct = ((tpHits / trades.length) * 100).toFixed(2);
  const slRatePct = ((rsiSlHits / trades.length) * 100).toFixed(2);
  const netReturnPct = ((netProfitUsdt / positionSizeUsdt) * 100).toFixed(2);

  return {
    totalTrades: trades.length,
    tpHits,
    winRatePct: parseFloat(winRatePct),
    rsiSlHits,
    slRatePct: parseFloat(slRatePct),
    pendingCount,
    grossProfitUsdt: parseFloat(grossProfitUsdt.toFixed(2)),
    grossLossUsdt: parseFloat(grossLossUsdt.toFixed(2)),
    netProfitUsdt: parseFloat(netProfitUsdt.toFixed(2)),
    netReturnPct: parseFloat(netReturnPct),
    slTradeList
  };
}

async function runBtcDetailedSimulation() {
  console.log("================================================================================");
  console.log("🪙 BITCOIN (BTCUSDT) 1-YEAR SIMULATION: +0.60% TP vs RSI <= 20 EMERGENCY SL");
  console.log("   Standard $100 USDT Position Size per Trade");
  console.log("================================================================================");

  const candles = await fetchBinanceCandles('BTCUSDT', '15m', 35000);
  const closePrices = candles.map(c => parseFloat(c[4]));
  
  const rsi15m = calculateRsiSeries(closePrices, 14);
  const rsi4h = new Array(candles.length).fill(50.0);
  for (let i = 15; i < candles.length; i++) {
    const windowSlice = rsi15m.slice(i - 15, i + 1);
    rsi4h[i] = windowSlice.reduce((sum, val) => sum + val, 0) / windowSlice.length;
  }

  // Generate Trades for Condition A (OBI >= 60%, RSI <= 45)
  let lastIndexA = -16;
  const tradesA = [];
  for (let i = 16; i < candles.length; i++) {
    const c = candles[i];
    const rsiVal = rsi4h[i];
    const obiVal = getSyntheticObi(c, candles[i - 1]);
    if (obiVal >= 60.0 && rsiVal <= 45.0) {
      if (i - lastIndexA >= 16) {
        lastIndexA = i;
        tradesA.push({
          tradeId: tradesA.length + 1,
          entryIndex: i,
          entryTime: new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT',
          entryPrice: parseFloat(c[4]),
          entryObi: obiVal,
          entryRsi: rsiVal
        });
      }
    }
  }

  // Generate Trades for Condition B (OBI >= 60%, RSI < 50)
  let lastIndexB = -16;
  const tradesB = [];
  for (let i = 16; i < candles.length; i++) {
    const c = candles[i];
    const rsiVal = rsi4h[i];
    const obiVal = getSyntheticObi(c, candles[i - 1]);
    if (obiVal >= 60.0 && rsiVal < 50.0) {
      if (i - lastIndexB >= 16) {
        lastIndexB = i;
        tradesB.push({
          tradeId: tradesB.length + 1,
          entryIndex: i,
          entryTime: new Date(c[0] + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').substring(0, 16) + ' PKT',
          entryPrice: parseFloat(c[4]),
          entryObi: obiVal,
          entryRsi: rsiVal
        });
      }
    }
  }

  const resultA = simulateTrades(tradesA, candles, rsi4h, 0.60, 20.0, 100.0);
  const resultB = simulateTrades(tradesB, candles, rsi4h, 0.60, 20.0, 100.0);

  console.log("\n================================================================================");
  console.log("📊 CONDITION A (OBI >= 60% & 4h RSI <= 45) SIMULATION RESULTS");
  console.log("================================================================================");
  console.log(`🔹 Total Trade Entries Evaluated: ${resultA.totalTrades} Trades`);
  console.log(`🟢 Take Profit Hits (+0.60% TP Target): ${resultA.tpHits} Trades (${resultA.winRatePct}% Win Rate)`);
  console.log(`🚨 Emergency RSI <= 20.0 SL Hits: ${resultA.rsiSlHits} Trades (${resultA.slRatePct}% SL Rate)`);
  console.log(`💵 Gross Profit Accumulated: +$${resultA.grossProfitUsdt.toFixed(2)} USDT`);
  console.log(`💸 Gross Loss Deducted: -$${resultA.grossLossUsdt.toFixed(2)} USDT`);
  console.log(`🏆 NET BOTTOM-LINE PROFIT: +$${resultA.netProfitUsdt.toFixed(2)} USDT (+${resultA.netReturnPct}% Net Growth)`);

  console.log("\n================================================================================");
  console.log("📊 CONDITION B (OBI >= 60% & 4h RSI < 50) SIMULATION RESULTS");
  console.log("================================================================================");
  console.log(`🔹 Total Trade Entries Evaluated: ${resultB.totalTrades} Trades`);
  console.log(`🟢 Take Profit Hits (+0.60% TP Target): ${resultB.tpHits} Trades (${resultB.winRatePct}% Win Rate)`);
  console.log(`🚨 Emergency RSI <= 20.0 SL Hits: ${resultB.rsiSlHits} Trades (${resultB.slRatePct}% SL Rate)`);
  console.log(`💵 Gross Profit Accumulated: +$${resultB.grossProfitUsdt.toFixed(2)} USDT`);
  console.log(`💸 Gross Loss Deducted: -$${resultB.grossLossUsdt.toFixed(2)} USDT`);
  console.log(`🏆 NET BOTTOM-LINE PROFIT: +$${resultB.netProfitUsdt.toFixed(2)} USDT (+${resultB.netReturnPct}% Net Growth)`);

  if (resultA.slTradeList.length > 0) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("📜 CONDITION A: SAMPLE EMERGENCY SL TRADES (RSI <= 20.0):");
    resultA.slTradeList.forEach((t, idx) => {
      console.log(`   [#${idx+1}] Trade #${t.tradeId} | Entry: ${t.entryTime} @ $${t.entryPrice.toFixed(2)} | Exit: ${t.exitTime} @ $${t.exitPrice.toFixed(2)} | Loss: ${t.lossPct.toFixed(2)}% (-$${Math.abs(t.lossUsdt).toFixed(2)} USDT)`);
    });
  }

  if (resultB.slTradeList.length > 0) {
    console.log("\n--------------------------------------------------------------------------------");
    console.log("📜 CONDITION B: SAMPLE EMERGENCY SL TRADES (RSI <= 20.0):");
    resultB.slTradeList.forEach((t, idx) => {
      console.log(`   [#${idx+1}] Trade #${t.tradeId} | Entry: ${t.entryTime} @ $${t.entryPrice.toFixed(2)} | Exit: ${t.exitTime} @ $${t.exitPrice.toFixed(2)} | Loss: ${t.lossPct.toFixed(2)}% (-$${Math.abs(t.lossUsdt).toFixed(2)} USDT)`);
    });
  }

  const btcPnLReport = {
    asset: 'BITCOIN (BTCUSDT)',
    tpTargetPct: 0.60,
    rsiSlThreshold: 20.0,
    positionSizeUsdt: 100.0,
    conditionA_Rsi45: resultA,
    conditionB_Rsi50: resultB
  };

  fs.writeFileSync(
    path.join(__dirname, 'btc_pnl_tp06_rsi20_audit_report.json'),
    JSON.stringify(btcPnLReport, null, 2)
  );

  console.log("\n✅ Saved complete Bitcoin PnL report to backend/btc_pnl_tp06_rsi20_audit_report.json");
}

runBtcDetailedSimulation().catch(err => {
  console.error("❌ BTC Detailed Simulation Error:", err);
});
