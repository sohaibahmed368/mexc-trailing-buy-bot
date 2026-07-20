const axios = require('axios');

async function downloadKlines(symbol, interval, startTime, endTime) {
  const klines = [];
  let currentStart = startTime;
  const chunkMs = 500 * 60 * 60 * 1000; // 500 hours range per request
  
  console.log(`Downloading historical candles for ${symbol}...`);
  
  while (currentStart < endTime) {
    const currentEnd = Math.min(currentStart + chunkMs, endTime);
    try {
      const response = await axios.get('https://api.mexc.com/api/v3/klines', {
        params: {
          symbol,
          interval,
          startTime: currentStart,
          endTime: currentEnd,
          limit: 1000
        }
      });
      
      const data = response.data;
      if (!data || data.length === 0) {
        currentStart += chunkMs;
        continue;
      }
      
      klines.push(...data);
      const lastCandleTime = data[data.length - 1][0];
      if (lastCandleTime <= currentStart) {
        currentStart += chunkMs;
      } else {
        currentStart = lastCandleTime + 1;
      }
      
      await new Promise(r => setTimeout(r, 50));
    } catch (error) {
      console.error(`Error downloading klines: ${error.message}`);
      break;
    }
  }
  
  // Deduplicate by timestamp index 0
  const unique = [];
  const seen = new Set();
  for (const k of klines) {
    if (!seen.has(k[0])) {
      seen.add(k[0]);
      unique.push(k);
    }
  }
  return unique;
}

function calculateRSI(closes, period = 14) {
  if (closes.length <= period) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const currentGain = diff > 0 ? diff : 0;
    const currentLoss = diff < 0 ? -diff : 0;
    
    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
  }
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function runDynamicLoopSimulation(klines, activationOffset, trailValue, tpOffset, slOffset, checkObi, checkVolume, checkRsi) {
  let state = 'PENDING_ACTIVATION';
  let exitPrice = parseFloat(klines[0][4]); // starting price
  let peakPrice = exitPrice;
  let activationPrice = peakPrice - activationOffset;
  
  let buyPrice = 0;
  let tpPrice = 0;
  let slPrice = 0;
  
  let tpCount = 0;
  let slCount = 0;
  let totalTrades = 0;
  
  let balance = 1000;
  const tradeSize = 100;
  let bottomPrice = null;

  // Pre-calculate RSI values
  const closes = klines.map(k => parseFloat(k[4]));
  const rsiValues = [];
  for (let i = 0; i < klines.length; i++) {
    if (i < 14) {
      rsiValues.push(50);
    } else {
      const slice = closes.slice(i - 14, i + 1);
      rsiValues.push(calculateRSI(slice));
    }
  }

  for (let i = 14; i < klines.length; i++) {
    const candle = klines[i];
    const open = parseFloat(candle[1]);
    const high = parseFloat(candle[2]);
    const low = parseFloat(candle[3]);
    const close = parseFloat(candle[4]);
    const volume = parseFloat(candle[5]);
    
    if (state === 'PENDING_ACTIVATION') {
      // Dynamic Peak Tracking
      if (high > peakPrice) {
        peakPrice = high;
        activationPrice = peakPrice - activationOffset;
      }
      
      // Check standard Dip activation -> transitions to trailing buy
      if (low <= activationPrice) {
        state = 'TRAILING_BUY';
        bottomPrice = low;
      }
    } else if (state === 'TRAILING_BUY') {
      if (low < bottomPrice) {
        bottomPrice = low;
      }
      
      const triggerPrice = bottomPrice + trailValue;
      if (high >= triggerPrice) {
        let passed = true;
        
        if (checkObi) {
          if (close <= open) passed = false;
        }
        
        if (checkVolume) {
          let totalPrevVol = 0;
          for (let j = i - 5; j < i; j++) {
            totalPrevVol += parseFloat(klines[j][5]);
          }
          const avgPrevVol = totalPrevVol / 5;
          if (volume < avgPrevVol * 1.5) passed = false;
        }
        
        if (checkRsi) {
          const rsi = rsiValues[i];
          if (rsi > 35) passed = false;
        }
        
        if (passed) {
          buyPrice = triggerPrice;
          tpPrice = buyPrice + tpOffset;
          slPrice = buyPrice - slOffset;
          state = 'TP_SL_ACTIVE';
          totalTrades++;
        }
      }
    } else if (state === 'TP_SL_ACTIVE') {
      const hitSL = low <= slPrice;
      const hitTP = high >= tpPrice;
      
      if (hitSL && hitTP) {
        slCount++;
        balance -= (tradeSize * (slOffset / buyPrice));
        exitPrice = slPrice;
        peakPrice = exitPrice;
        activationPrice = peakPrice - activationOffset;
        state = 'PENDING_ACTIVATION';
      } else if (hitSL) {
        slCount++;
        balance -= (tradeSize * (slOffset / buyPrice));
        exitPrice = slPrice;
        peakPrice = exitPrice;
        activationPrice = peakPrice - activationOffset;
        state = 'PENDING_ACTIVATION';
      } else if (hitTP) {
        tpCount++;
        balance += (tradeSize * (tpOffset / buyPrice));
        exitPrice = tpPrice;
        peakPrice = exitPrice;
        activationPrice = peakPrice - activationOffset;
        state = 'PENDING_ACTIVATION';
      }
    }
  }
  
  const winRate = totalTrades > 0 ? ((tpCount / (tpCount + slCount)) * 100).toFixed(1) : 0;
  const netProfit = balance - 1000;

  return { totalTrades, tpCount, slCount, winRate, netProfit };
}

async function testSymbol(symbol, dip, trail, tp, sl) {
  const interval = '60m'; 
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  const endTime = Date.now();
  const startTime = endTime - oneYearMs;

  const klines = await downloadKlines(symbol, interval, startTime, endTime);
  if (klines.length === 0) {
    console.error(`Failed to download historical data for ${symbol}.`);
    return;
  }
  
  console.log(`\n==================================================`);
  console.log(`BACKTEST RESULTS: ${symbol} (1 Year / ${klines.length} Hourly Candles)`);
  console.log(`Parameters: Dip = $${dip}, Trail = $${trail}, TP = +$${tp}, SL = -$${sl}`);
  console.log(`==================================================`);

  const setups = [
    { name: '1. No Filters (Standard Mode)', checkObi: false, checkVol: false, checkRsi: false },
    { name: '2. Only OBI Filter', checkObi: true, checkVol: false, checkRsi: false },
    { name: '3. Only Volume Spike Filter', checkObi: false, checkVol: true, checkRsi: false },
    { name: '4. Only RSI Oversold Filter', checkObi: false, checkVol: false, checkRsi: true },
    { name: '5. All 3 Filters Active (OBI + Vol + RSI)', checkObi: true, checkVol: true, checkRsi: true }
  ];

  setups.forEach(s => {
    const res = runDynamicLoopSimulation(klines, dip, trail, tp, sl, s.checkObi, s.checkVol, s.checkRsi);
    console.log(`\n🔹 ${s.name}`);
    console.log(`   - Total Trades Executed: ${res.totalTrades}`);
    console.log(`   - Take Profit (TP) Hits: ${res.tpCount} 🟢`);
    console.log(`   - Stop Loss (SL) Hits  : ${res.slCount} 🔴`);
    console.log(`   - Win Rate             : ${res.winRate}%`);
    console.log(`   - Net Profit/Loss      : ${res.netProfit >= 0 ? '+' : ''}${res.netProfit.toFixed(2)} USDT`);
  });
  console.log(`--------------------------------------------------\n`);
}

async function start() {
  // Test ETHUSDT: Dip = $10, Trail = $2, TP = +$9, SL = -$3
  await testSymbol('ETHUSDT', 10, 2, 9, 3);

  // Test SOLUSDT: Dip = $0.5, Trail = $0.1, TP = +$0.42, SL = -$0.1
  await testSymbol('SOLUSDT', 0.5, 0.1, 0.42, 0.1);
}

start();
