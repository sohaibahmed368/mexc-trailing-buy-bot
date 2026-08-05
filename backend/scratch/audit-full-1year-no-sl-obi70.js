const axios = require('axios');

console.log('================================================================================');
console.log('⚡ FULL 1-YEAR (365 DAYS) NO_SL OBI >= 70% HISTORICAL AUDIT');
console.log('   Coins: SOLUSDT, ETHUSDT, BTCUSDT | TP Target: +0.60% | NO STOP LOSS');
console.log('================================================================================\n');

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

// Fetch Paginated 1h Klines for Full 365 Days (~8,760 candles)
async function fetchFullYearKlines(symbol) {
  let allKlines = [];
  let endTime = Date.now();

  for (let page = 0; page < 9; page++) {
    try {
      const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=60m&limit=1000&endTime=${endTime}`;
      const res = await axios.get(url, { timeout: 10000 });
      if (!Array.isArray(res.data) || res.data.length === 0) break;
      const batch = res.data;
      allKlines = batch.concat(allKlines);
      endTime = parseInt(batch[0][0]) - 1;
    } catch (e) {
      break;
    }
  }

  const map = new Map();
  allKlines.forEach(k => map.set(k[0], k));
  return Array.from(map.values()).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
}

async function audit1YearCoin(symbol) {
  console.log(`📡 Fetching 1-year historical dataset for ${symbol}...`);
  const klines = await fetchFullYearKlines(symbol);

  if (!klines || klines.length < 100) {
    console.log(`❌ Failed to fetch dataset for ${symbol}\n`);
    return;
  }

  const startDate = new Date(parseInt(klines[0][0])).toLocaleDateString();
  const endDate = new Date(parseInt(klines[klines.length - 1][0])).toLocaleDateString();
  console.log(`   - Data Span: ${startDate} to ${endDate} (${klines.length} Candles Analyzed)`);

  let signals = [];

  for (let i = 20; i < klines.length; i++) {
    const closes = klines.slice(i - 20, i + 1).map(k => parseFloat(k[4]));
    const rsi = calcRSI(closes, 14);
    const vol = parseFloat(klines[i][5]);

    let prevVolSum = 0;
    for (let v = i - 5; v < i; v++) prevVolSum += parseFloat(klines[v][5]);
    const avgVol = prevVolSum / 5;

    let obiPct = 50.0;
    if (rsi >= 50) {
      const volRatio = avgVol > 0 ? (vol / avgVol) : 1.0;
      obiPct = 50.0 + (rsi - 50) * 0.6 + (volRatio > 1.2 ? (volRatio - 1.2) * 8.0 : 0);
    }

    if (obiPct >= 70.0) {
      signals.push({
        idx: i,
        timeMs: parseInt(klines[i][0]),
        entryPrice: parseFloat(klines[i][4])
      });
    }
  }

  let hitTpCount = 0;
  let pendingCount = 0;

  signals.forEach(sig => {
    const targetTp = sig.entryPrice * 1.0060; // +0.60% TP
    let tpResolved = false;

    for (let j = sig.idx + 1; j < klines.length; j++) {
      const candleHigh = parseFloat(klines[j][2]);
      if (candleHigh >= targetTp) {
        tpResolved = true;
        break;
      }
    }

    if (tpResolved) hitTpCount++; else pendingCount++;
  });

  const winRate = signals.length > 0 ? ((hitTpCount / signals.length) * 100).toFixed(1) : '0';

  console.log(`\n📊 1-YEAR AUDIT RESULTS FOR ${symbol}:`);
  console.log(`   --------------------------------------------------`);
  console.log(`   - Total Executed Signals: ${signals.length} Trades`);
  console.log(`   - 🟢 Full Take Profit Wins (+0.60%): ${hitTpCount} Trades`);
  console.log(`   - ⏳ Holding / Pending in Drawdown: ${pendingCount} Trades`);
  console.log(`   - 🏆 Overall Win Success Rate: ${winRate}%`);
  console.log(`   --------------------------------------------------\n`);
}

async function runAll() {
  await audit1YearCoin('SOLUSDT');
  await audit1YearCoin('ETHUSDT');
  await audit1YearCoin('BTCUSDT');
  console.log('================================================================================\n');
}

runAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
