const https = require('https');

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Fetch 1 year of 1h candles in batches
async function fetchOneYearCandles(symbol, intervalLabel, intervalMinutes) {
  const batchSize = 1000;
  const totalCandles = Math.ceil((365 * 24 * 60) / intervalMinutes); // 1 year in candles
  const batches = Math.ceil(totalCandles / batchSize);
  let allCandles = [];
  const now = Date.now();

  console.log(`  ⏳ Fetching ~${totalCandles} candles (${intervalLabel}) in ${batches} batches...`);

  for (let b = batches - 1; b >= 0; b--) {
    const endTime = now - (b * batchSize * intervalMinutes * 60 * 1000);
    const startTime = endTime - (batchSize * intervalMinutes * 60 * 1000);

    // Try MEXC first
    const mexcUrl = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${intervalLabel}&startTime=${startTime}&endTime=${endTime}&limit=${batchSize}`;
    let data = await fetchJson(mexcUrl);

    // Fallback to Binance if MEXC fails
    if (!data || !Array.isArray(data) || data.length === 0) {
      const binUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${intervalLabel}&startTime=${startTime}&endTime=${endTime}&limit=${batchSize}`;
      data = await fetchJson(binUrl);
    }

    if (data && Array.isArray(data) && data.length > 0) {
      allCandles = allCandles.concat(data);
    }

    await new Promise(r => setTimeout(r, 80));
    if ((batches - b) % 3 === 0) process.stdout.write(`  Batch ${batches - b}/${batches} — ${allCandles.length} candles\r`);
  }

  return allCandles;
}

// Count trades triggered for a given dip offset + trail + reset logic
function countTrades(candles, dipPct, trailPct) {
  let status = 'PENDING';
  let peakPrice = null;
  let activationPrice = null;
  let bottomPrice = null;
  let triggerPrice = null;
  let trades = 0;

  for (let i = 0; i < candles.length; i++) {
    const high  = parseFloat(candles[i][2]);
    const low   = parseFloat(candles[i][3]);
    const close = parseFloat(candles[i][4]);

    if (status === 'PENDING') {
      if (!peakPrice || high > peakPrice) {
        peakPrice = high;
        activationPrice = peakPrice * (1 - dipPct / 100);
      }
      if (low <= activationPrice) {
        status = 'RUNNING';
        bottomPrice = low;
        triggerPrice = bottomPrice * (1 + trailPct / 100);
      }
    }

    if (status === 'RUNNING') {
      if (low < bottomPrice) {
        bottomPrice = low;
        triggerPrice = bottomPrice * (1 + trailPct / 100);
      }
      if (high >= triggerPrice) {
        trades++;
        // Reset immediately for next cycle
        status = 'PENDING';
        peakPrice = close;
        activationPrice = peakPrice * (1 - dipPct / 100);
        bottomPrice = null;
        triggerPrice = null;
      }
    }
  }

  return trades;
}

async function runDipFrequencyAudit() {
  console.log('========================================================================');
  console.log('📊 EURUSDT — DIP OFFSET FREQUENCY AUDIT (1 Year — 1h Candles)');
  console.log('   Finding: Which Dip% generates MAXIMUM Trades in 1 Year?');
  console.log('========================================================================\n');

  const symbol = 'EURUSDT';

  // Fetch 1h candles for 1 year
  const candles1h = await fetchOneYearCandles(symbol, '1h', 60);
  console.log(`\n  ✅ Fetched ${candles1h.length} 1h candles for ${symbol}\n`);

  const dipOffsets  = [0.10, 0.20, 0.30, 0.40, 0.50];
  const trailValue  = 0.10; // Fixed tight trail

  console.log('========================================================================');
  console.log('📊 TRADE FREQUENCY BY DIP OFFSET (1h Candles — 1 Year — Trail=0.10%)');
  console.log('========================================================================');
  console.log('  Dip%  | Trades in 1 Year | Avg per Month | Avg per Week');
  console.log('  ------+------------------+---------------+-------------');

  const results1h = [];
  for (const dip of dipOffsets) {
    const trades = countTrades(candles1h, dip, trailValue);
    const perMonth = (trades / 12).toFixed(1);
    const perWeek  = (trades / 52).toFixed(1);
    results1h.push({ dip, trades, perMonth: parseFloat(perMonth), perWeek: parseFloat(perWeek) });
    console.log(`  ${dip.toFixed(2)}%  | ${trades.toString().padStart(16)} | ${perMonth.padStart(13)} | ${perWeek.padStart(12)}`);
  }

  const best1h = results1h.sort((a, b) => b.trades - a.trades)[0];

  console.log(`\n  🏆 1h Chart Winner: Dip = ${best1h.dip}% → ${best1h.trades} trades/year (${best1h.perMonth}/month, ${best1h.perWeek}/week)\n`);

  // Summary
  console.log('========================================================================');
  console.log('🥇 FINAL RECOMMENDATION — MAX TRADES for EURUSDT:');
  console.log('========================================================================');
  console.log(`  Best Dip Offset (1h):   ${best1h.dip}% → ${best1h.trades} trades in 1 year`);
  console.log(`  Trail Value:             0.10% (tightest, catches earliest rebound)`);
  console.log(`  Avg Monthly Trades:      ${best1h.perMonth}`);
  console.log(`  Avg Weekly Trades:       ${best1h.perWeek}`);
  console.log('========================================================================\n');
}

runDipFrequencyAudit().catch(e => console.error(e));
