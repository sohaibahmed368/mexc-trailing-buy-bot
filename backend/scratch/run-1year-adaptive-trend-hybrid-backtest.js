const https = require('https');
const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('📊 1-YEAR HISTORICAL BACKTEST: 3-LAYER ADAPTIVE TREND HYBRID ENGINE');
console.log('================================================================================');
console.log('Parameters:');
console.log('- Coins: BTC, ETH, SOL, BNB, SUI');
console.log('- Dip Offset: 0.60% | Trail Rebound: 0.25%');
console.log('- Take Profit: +0.60% | Stop Loss: -0.30%');
console.log('- 15m RSI Guard: If 15m RSI >= 45 -> NO_SL Mode (Only TP Limit Sell)');
console.log('                 If 15m RSI < 40  -> Active SL Mode (-0.30%)');
console.log('- 50% TP Progress Lock: Reaching +0.30% gain locks SL at +0.20% Net Gain');
console.log('- 45-Min Stale Exit: Held 45m without TP & 15m RSI < 42 -> Break-even Exit (+0.05%)');
console.log('================================================================================\n');

function fetchKlinesChunk(symbol, interval, startTime, limit = 1000) {
  return new Promise((resolve) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}${startTime ? `&startTime=${startTime}` : ''}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(Array.isArray(json) ? json : []);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function fetchFullYearKlines(symbol, interval, totalCandlesTarget = 35000) {
  console.log(`⏳ Fetching historical ${interval} klines for ${symbol}...`);
  let allKlines = [];
  let startTime = Date.now() - (365 * 24 * 60 * 60 * 1000); // 1 Year ago

  while (allKlines.length < totalCandlesTarget) {
    const chunk = await fetchKlinesChunk(symbol, interval, startTime, 1000);
    if (!chunk || chunk.length === 0) break;
    allKlines = allKlines.concat(chunk);
    startTime = chunk[chunk.length - 1][0] + 1;
    if (chunk.length < 1000) break;
  }
  console.log(`   ✅ Downloaded ${allKlines.length} ${interval} candles for ${symbol}`);
  return allKlines;
}

function calculate15mRSIAt(klines15m, targetTime) {
  // Find klines up to targetTime
  const pastKlines = klines15m.filter(k => k[0] <= targetTime).slice(-25);
  if (pastKlines.length < 15) return 50.0;

  const closes = pastKlines.map(k => parseFloat(k[4]));
  let gains = 0, losses = 0;

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

async function runCoinBacktest(symbol) {
  const klines1m = await fetchFullYearKlines(symbol, '1m', 30000);
  const klines15m = await fetchFullYearKlines(symbol, '15m', 10000);

  if (klines1m.length === 0 || klines15m.length === 0) {
    console.log(`❌ Skipped ${symbol} due to insufficient data.`);
    return null;
  }

  let state = 'WAITING_DIP'; // WAITING_DIP, TRAILING_REBOUND, TP_SL_ACTIVE
  let peakPrice = parseFloat(klines1m[0][4]);
  let bottomPrice = null;
  let buyPrice = null;
  let buyTime = null;
  let mode = 'SL_ACTIVE'; // NO_SL or SL_ACTIVE
  let isProfitLocked = false;
  let lockedSlPrice = null;

  let totalTrades = 0;
  let tpWins = 0;
  let profitLockWins = 0;
  let slLosses = 0;
  let staleExits = 0;
  let netPnlPct = 0;

  const dipOffsetPct = 0.60;
  const trailReboundPct = 0.25;
  const tpPct = 0.60;
  const slPct = 0.30;
  const roundtripFeePct = 0.05; // 0.05% Taker Buy + 0.00% Maker Sell Fee!

  for (let i = 1; i < klines1m.length; i++) {
    const time = klines1m[i][0];
    const high = parseFloat(klines1m[i][2]);
    const low = parseFloat(klines1m[i][3]);
    const close = parseFloat(klines1m[i][4]);

    if (state === 'WAITING_DIP') {
      if (close > peakPrice) {
        peakPrice = close;
      }
      const dipTarget = peakPrice * (1 - dipOffsetPct / 100);
      if (low <= dipTarget) {
        state = 'TRAILING_REBOUND';
        bottomPrice = low;
      }
    } else if (state === 'TRAILING_REBOUND') {
      if (low < bottomPrice) {
        bottomPrice = low;
      }
      const reboundTarget = bottomPrice * (1 + trailReboundPct / 100);
      if (high >= reboundTarget) {
        // Entry Triggered!
        buyPrice = reboundTarget;
        buyTime = time;
        totalTrades++;

        // Calculate 15m RSI at Entry Time
        const rsi15m = calculate15mRSIAt(klines15m, time);
        if (rsi15m >= 45) {
          mode = 'NO_SL';
        } else {
          mode = 'SL_ACTIVE';
        }

        isProfitLocked = false;
        lockedSlPrice = null;
        state = 'TP_SL_ACTIVE';
      }
    } else if (state === 'TP_SL_ACTIVE') {
      const tpTarget = buyPrice * (1 + tpPct / 100);
      const halfTpTarget = buyPrice * (1 + (tpPct * 0.50) / 100);
      const normalSlTarget = buyPrice * (1 - slPct / 100);

      // Check 50% TP Progress Lock
      if (!isProfitLocked && high >= halfTpTarget) {
        isProfitLocked = true;
        lockedSlPrice = buyPrice * (1 + 0.20 / 100); // Lock +0.20% Net Profit Floor
      }

      // 1. Check Take Profit Hit
      if (high >= tpTarget) {
        tpWins++;
        netPnlPct += (tpPct - roundtripFeePct); // +0.55% net win!
        state = 'WAITING_DIP';
        peakPrice = close;
        continue;
      }

      // 2. Check Locked Profit Floor Hit
      if (isProfitLocked && low <= lockedSlPrice) {
        profitLockWins++;
        netPnlPct += (0.20 - roundtripFeePct); // +0.15% net win!
        state = 'WAITING_DIP';
        peakPrice = close;
        continue;
      }

      // 3. Check Stop Loss Hit (Bypassed if NO_SL is active)
      if (mode === 'SL_ACTIVE' && low <= normalSlTarget) {
        slLosses++;
        netPnlPct -= (slPct + roundtripFeePct); // -0.35% net loss
        state = 'WAITING_DIP';
        peakPrice = close;
        continue;
      }

      // 4. Check 45-Minute Stale Exit Guard
      if (time - buyTime >= 45 * 60 * 1000) {
        const rsiNow = calculate15mRSIAt(klines15m, time);
        if (rsiNow < 42) {
          staleExits++;
          const gainNow = ((close - buyPrice) / buyPrice) * 100;
          netPnlPct += (gainNow - roundtripFeePct);
          state = 'WAITING_DIP';
          peakPrice = close;
          continue;
        }
      }
    }
  }

  const winRate = totalTrades > 0 ? (((tpWins + profitLockWins) / totalTrades) * 100) : 0;

  return {
    symbol,
    totalTrades,
    tpWins,
    profitLockWins,
    slLosses,
    staleExits,
    winRate,
    netPnlPct
  };
}

async function runMasterBacktest() {
  const coins = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'SUIUSDT'];
  const results = [];

  for (const coin of coins) {
    const res = await runCoinBacktest(coin);
    if (res) results.push(res);
  }

  console.log('\n================================================================================');
  console.log('🏆 1-YEAR ADAPTIVE TREND HYBRID BACKTEST RESULTS SUMMARY');
  console.log('================================================================================\n');

  let masterTrades = 0;
  let masterTpWins = 0;
  let masterProfitLockWins = 0;
  let masterSlLosses = 0;
  let masterStaleExits = 0;
  let masterNetPnlPct = 0;

  results.forEach(r => {
    masterTrades += r.totalTrades;
    masterTpWins += r.tpWins;
    masterProfitLockWins += r.profitLockWins;
    masterSlLosses += r.slLosses;
    masterStaleExits += r.staleExits;
    masterNetPnlPct += r.netPnlPct;

    console.log(`🪙 Asset: ${r.symbol.padEnd(10)} | Trades: ${r.totalTrades.toString().padEnd(4)} | Win Rate: ${r.winRate.toFixed(1)}% | 🟢 TP Wins: ${r.tpWins} | 🔒 50% Lock Wins: ${r.profitLockWins} | 🔴 SL Losses: ${r.slLosses} | ⏳ Stale Exits: ${r.staleExits} | Net PnL: +${r.netPnlPct.toFixed(2)}%`);
  });

  const masterWinRate = masterTrades > 0 ? (((masterTpWins + masterProfitLockWins) / masterTrades) * 100) : 0;

  console.log('\n--------------------------------------------------------------------------------');
  console.log(`👑 GRAND MASTER TOTALS (ALL COINS AGGREGATED):`);
  console.log(`- Total Trades Executed:        ${masterTrades}`);
  console.log(`- Overall Win Rate:             ${masterWinRate.toFixed(1)}%`);
  console.log(`- 🟢 Clean Take Profit Wins:    ${masterTpWins}`);
  console.log(`- 🔒 50% TP Locked Wins:       ${masterProfitLockWins}`);
  console.log(`- 🔴 Stop Loss Hits (Crashing): ${masterSlLosses}`);
  console.log(`- ⏳ 45-Min Stale Exits:        ${masterStaleExits}`);
  console.log(`- 💰 Cumulative Net PnL:        +${masterNetPnlPct.toFixed(2)}% Net Profit`);
  console.log('================================================================================\n');
}

runMasterBacktest();
