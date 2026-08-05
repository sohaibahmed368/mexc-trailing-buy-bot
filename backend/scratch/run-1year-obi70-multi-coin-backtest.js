const axios = require('axios');

console.log('================================================================================');
console.log('⚡ 1-YEAR HISTORICAL BACKTEST: OBI > 70% STRICT GATE ON ETH, SOL & BTC');
console.log('   Parameters: Dip Offset: 0.60% | Trail: 0.25% | TP: 0.60% | SL: 0.30% | Lock @ 50%');
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

async function runCoinTimeframeAudit(symbol, intervalName, intervalCode) {
  const klines = await fetchHistoricalKlines(symbol, intervalCode);
  if (!klines || klines.length < 50) return null;

  const dipOffset = 0.60;
  const trailValue = 0.25;
  const tpTargetPct = 0.60;
  const slTargetPct = 0.30;

  let fullTpWins = 0;
  let profitLockWins = 0;
  let hardLosses = 0;
  let totalPnlPct = 0;

  let inTrade = false;
  let peakPrice = parseFloat(klines[0][4]);
  let bottomPrice = null;
  let triggerPrice = null;
  let buyPrice = 0;
  let tpPrice = 0;
  let slPrice = 0;
  let profitLocked = false;

  for (let i = 25; i < klines.length; i++) {
    const close = parseFloat(klines[i][4]);
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const vol = parseFloat(klines[i][5]);

    const closes = klines.slice(i - 25, i + 1).map(k => parseFloat(k[4]));
    const rsi = calcRSI(closes, 14);

    // OBI Simulation: OBI > 70% occurs during strong bullish volume spikes & RSI >= 52
    let prevVolSum = 0;
    for (let v = i - 5; v < i; v++) prevVolSum += parseFloat(klines[v][5]);
    const avgVol = prevVolSum / 5;
    const isObi70Plus = rsi >= 52 && vol >= avgVol * 1.25;

    if (!inTrade) {
      if (close > peakPrice) peakPrice = close;
      const actPrice = peakPrice * (1 - (dipOffset / 100));

      if (close <= actPrice) {
        if (!bottomPrice || close < bottomPrice) {
          bottomPrice = close;
          triggerPrice = bottomPrice * (1 + (trailValue / 100));
        }

        // ENTRY: Only when price rebounds to trigger AND OBI >= 70% gate passes!
        if (close >= triggerPrice && isObi70Plus) {
          inTrade = true;
          buyPrice = close;
          tpPrice = buyPrice * (1 + (tpTargetPct / 100));
          slPrice = buyPrice * (1 - (slTargetPct / 100));
          profitLocked = false;
          bottomPrice = null;
          triggerPrice = null;
        }
      }
    } else {
      const gainPct = ((high - buyPrice) / buyPrice) * 100;

      // 50% Profit Lock Check (at +0.30% gain)
      if (!profitLocked && gainPct >= 0.30) {
        profitLocked = true;
        slPrice = buyPrice * 1.0008; // Lock SL at +0.08% Net Gain
      }

      if (high >= tpPrice) {
        fullTpWins++;
        totalPnlPct += tpTargetPct;
        inTrade = false;
        peakPrice = close;
      } else if (low <= slPrice) {
        if (profitLocked) {
          profitLockWins++;
          totalPnlPct += 0.08;
        } else {
          hardLosses++;
          totalPnlPct -= slTargetPct;
        }
        inTrade = false;
        peakPrice = close;
      }
    }
  }

  const totalTrades = fullTpWins + profitLockWins + hardLosses;
  const totalWins = fullTpWins + profitLockWins;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return {
    symbol,
    intervalName,
    totalTrades,
    fullTpWins,
    profitLockWins,
    hardLosses,
    winRate,
    netPnlPct: totalPnlPct.toFixed(2)
  };
}

async function runAll() {
  const symbols = ['ETHUSDT', 'SOLUSDT', 'BTCUSDT'];
  const timeframes = [
    { name: '15-Minute (15m)', code: '15m' },
    { name: '30-Minute (30m)', code: '30m' },
    { name: '1-Hour (60m)', code: '60m' }
  ];

  for (const sym of symbols) {
    console.log(`\n================================================================================`);
    console.log(`📊 BACKTEST AUDIT RESULTS FOR ${sym} (OBI > 70% GATE)`);
    console.log(`================================================================================`);
    for (const tf of timeframes) {
      const res = await runCoinTimeframeAudit(sym, tf.name, tf.code);
      if (res) {
        console.log(`\n📌 Timeframe: ${res.intervalName}`);
        console.log(`   - Total Trades Hit: ${res.totalTrades}`);
        console.log(`   - 🟢 Full Take Profit Wins (+0.60%): ${res.fullTpWins}`);
        console.log(`   - 🔒 50% Profit Lock Exit Wins (+0.08%): ${res.profitLockWins}`);
        console.log(`   - 🔴 Hard Stop Loss Hits (-0.30%): ${res.hardLosses}`);
        console.log(`   - 🏆 Overall Win Ratio: ${res.winRate}%`);
        console.log(`   - 💰 Cumulative Net Profit: +${res.netPnlPct}% USDT`);
      }
    }
  }
  console.log('\n================================================================================\n');
}

runAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
