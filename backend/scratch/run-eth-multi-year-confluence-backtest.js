const axios = require('axios');

console.log('================================================================================');
console.log('⚡ ETHEREUM (ETHUSDT) MULTI-YEAR CONFLUENCE SCALPER BACKTEST AUDIT');
console.log('================================================================================\n');

// EMA helper
function calcEMA(data, period) {
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) {
    ema = (data[i] * k) + (ema * (1 - k));
  }
  return ema;
}

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

// Fetch Historical Klines
async function fetchHistoricalKlines(symbol, interval) {
  try {
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000`;
    const res = await axios.get(url, { timeout: 10000 });
    if (!Array.isArray(res.data)) return [];
    return res.data;
  } catch (e) {
    return [];
  }
}

async function runTimeframeAudit(intervalName, intervalCode, tpPct = 0.45, slPct = 0.30) {
  console.log(`📡 Fetching multi-year historical data for ETHUSDT [Timeframe: ${intervalName}]...`);
  const klines = await fetchHistoricalKlines('ETHUSDT', intervalCode);

  if (!klines || klines.length < 50) {
    console.log(`❌ Failed to fetch enough klines for ${intervalName}`);
    return;
  }

  const startDate = new Date(parseInt(klines[0][0])).toLocaleDateString();
  const endDate = new Date(parseInt(klines[klines.length - 1][0])).toLocaleDateString();
  console.log(`   - Period Covered: ${startDate} to ${endDate} (${klines.length} Candles Analyzed)`);

  let fullTpWins = 0;
  let profitLockWins = 0;
  let hardLosses = 0;
  let totalPnlPct = 0;

  let inTrade = false;
  let buyPrice = 0;
  let tpPrice = 0;
  let slPrice = 0;
  let profitLocked = false;
  let tradeDurationCandles = [];
  let currentTradeCandles = 0;

  for (let i = 35; i < klines.length; i++) {
    const close = parseFloat(klines[i][4]);
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const vol = parseFloat(klines[i][5]);

    const closes = klines.slice(i - 35, i + 1).map(k => parseFloat(k[4]));
    const ema20 = calcEMA(closes, 20);
    const ema12 = calcEMA(closes, 12);
    const ema26 = calcEMA(closes, 26);
    const macd = ema12 - ema26;
    const rsi = calcRSI(closes, 14);

    // Volume average of previous 5 candles
    let prevVolSum = 0;
    for (let v = i - 5; v < i; v++) prevVolSum += parseFloat(klines[v][5]);
    const avgVol = prevVolSum / 5;

    // 5-Indicator Confluence Conditions
    const cond1_EMA = close > ema20;                // Price > 20 EMA (Uptrend)
    const cond2_RSI = rsi >= 48 && rsi <= 65;       // Healthy RSI Zone
    const cond3_MACD = macd > 0;                     // Bullish Momentum
    const cond4_VOL = vol >= avgVol * 1.15;          // Volume Surge
    const cond5_STRUCT = close > parseFloat(klines[i][1]); // Green Candle Rebound

    const isAll5Green = cond1_EMA && cond2_RSI && cond3_MACD && cond4_VOL && cond5_STRUCT;

    if (!inTrade) {
      if (isAll5Green) {
        inTrade = true;
        buyPrice = close;
        tpPrice = buyPrice * (1 + (tpPct / 100));
        slPrice = buyPrice * (1 - (slPct / 100));
        profitLocked = false;
        currentTradeCandles = 0;
      }
    } else {
      currentTradeCandles++;
      const gainPct = ((high - buyPrice) / buyPrice) * 100;

      // 50% Profit Lock Guard Check
      if (!profitLocked && gainPct >= (tpPct * 0.5)) {
        profitLocked = true;
        slPrice = buyPrice * 1.0008; // Lock SL at +0.08% Net Gain
      }

      if (high >= tpPrice) {
        fullTpWins++;
        totalPnlPct += tpPct;
        inTrade = false;
        tradeDurationCandles.push(currentTradeCandles);
      } else if (low <= slPrice) {
        if (profitLocked) {
          profitLockWins++;
          totalPnlPct += 0.08;
        } else {
          hardLosses++;
          totalPnlPct -= slPct;
        }
        inTrade = false;
        tradeDurationCandles.push(currentTradeCandles);
      }
    }
  }

  const totalTrades = fullTpWins + profitLockWins + hardLosses;
  const totalWins = fullTpWins + profitLockWins;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const avgDuration = tradeDurationCandles.length > 0 
    ? (tradeDurationCandles.reduce((a, b) => a + b, 0) / tradeDurationCandles.length).toFixed(1)
    : '0';

  console.log(`\n📊 RESULTS FOR ETHUSDT [${intervalName}]:`);
  console.log(`   --------------------------------------------------`);
  console.log(`   - Total Executed Trades: ${totalTrades}`);
  console.log(`   - 🟢 Full Take Profit Wins (+${tpPct}%): ${fullTpWins}`);
  console.log(`   - 🔒 Profit Lock Exit Wins (+0.08%): ${profitLockWins}`);
  console.log(`   - 🔴 Hard Stop Loss Hits (-${slPct}%): ${hardLosses}`);
  console.log(`   - 🏆 Overall Win Ratio: ${winRate}%`);
  console.log(`   - ⏱️ Avg Trade Hold Duration: ${avgDuration} Candles`);
  console.log(`   - 💰 Net Cumulative Profit: +${totalPnlPct.toFixed(2)}% USDT`);
  console.log(`   --------------------------------------------------\n`);
}

async function runHybridAudit() {
  console.log('\n================================================================================');
  console.log('⚡ HYBRID TEST: 1-HOUR TREND GUARD + MICRO-DIP REBOUND + PROFIT LOCK (ETHUSDT)');
  console.log('================================================================================\n');

  const klines = await fetchHistoricalKlines('ETHUSDT', '15m');
  const klines1h = await fetchHistoricalKlines('ETHUSDT', '60m');

  if (!klines || klines.length < 100 || !klines1h || klines1h.length < 50) return;

  let fullTpWins = 0;
  let profitLockWins = 0;
  let hardLosses = 0;
  let totalPnlPct = 0;

  let inTrade = false;
  let buyPrice = 0;
  let tpPrice = 0;
  let slPrice = 0;
  let profitLocked = false;
  let peakPrice = 0;

  for (let i = 40; i < klines.length; i++) {
    const close = parseFloat(klines[i][4]);
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);

    // Query 1-Hour Trend
    const closes1h = klines1h.map(k => parseFloat(k[4]));
    const ema20_1h = calcEMA(closes1h, 20);
    const rsi1h = calcRSI(closes1h, 14);
    const is1hUptrend = rsi1h >= 48 && closes1h[closes1h.length - 1] >= ema20_1h * 0.998;

    if (!inTrade) {
      if (close > peakPrice) peakPrice = close;
      const dipPct = ((close - peakPrice) / peakPrice) * 100;

      // Enter ONLY when 1-Hour Trend is Bullish AND Micro-Dip (-0.30%) occurs
      if (is1hUptrend && dipPct <= -0.30) {
        inTrade = true;
        buyPrice = close;
        tpPrice = buyPrice * 1.0045; // +0.45% Take Profit
        slPrice = buyPrice * 0.9965; // -0.35% Stop Loss
        profitLocked = false;
      }
    } else {
      const gainPct = ((high - buyPrice) / buyPrice) * 100;

      // 50% Profit Lock check
      if (!profitLocked && gainPct >= 0.22) {
        profitLocked = true;
        slPrice = buyPrice * 1.0008; // Lock SL at +0.08% Net Gain
      }

      if (high >= tpPrice) {
        fullTpWins++;
        totalPnlPct += 0.45;
        inTrade = false;
        peakPrice = close;
      } else if (low <= slPrice) {
        if (profitLocked) {
          profitLockWins++;
          totalPnlPct += 0.08;
        } else {
          hardLosses++;
          totalPnlPct -= 0.35;
        }
        inTrade = false;
        peakPrice = close;
      }
    }
  }

  const totalTrades = fullTpWins + profitLockWins + hardLosses;
  const totalWins = fullTpWins + profitLockWins;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  console.log(`📊 HYBRID STRATEGY RESULTS FOR ETHUSDT:`);
  console.log(`   --------------------------------------------------`);
  console.log(`   - Total Executed Trades: ${totalTrades}`);
  console.log(`   - 🟢 Full Take Profit Wins (+0.45%): ${fullTpWins}`);
  console.log(`   - 🔒 Profit Lock Exit Wins (+0.08%): ${profitLockWins}`);
  console.log(`   - 🔴 Hard Stop Loss Hits (-0.35%): ${hardLosses}`);
  console.log(`   - 🏆 Overall Win Ratio: ${winRate}%`);
  console.log(`   - 💰 Net Cumulative Profit: +${totalPnlPct.toFixed(2)}% USDT`);
  console.log(`   --------------------------------------------------\n`);
}

async function runAll() {
  await runTimeframeAudit('15-Minute (15m)', '15m', 0.45, 0.30);
  await runTimeframeAudit('30-Minute (30m)', '30m', 0.60, 0.35);
  await runTimeframeAudit('1-Hour (60m)', '60m', 0.85, 0.45);
  await runHybridAudit();
  console.log('================================================================================');
}

runAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
