const https = require('https');

// Fetch JSON from URL
function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// Try to discover EUR pair on MEXC - prefer EURUSDT
async function discoverEurPair() {
  console.log('🔍 Checking MEXC for EUR trading pairs...');
  const data = await fetchJson('https://api.mexc.com/api/v3/ticker/price');
  if (!data || !Array.isArray(data)) {
    console.log('  Could not fetch ticker list from MEXC.');
    return null;
  }
  const eurPairs = data.filter(t => t.symbol && t.symbol.includes('EUR'));
  if (eurPairs.length === 0) {
    console.log('  ❌ No EUR trading pairs found on MEXC SPOT.');
    return null;
  }
  console.log(`  Found EUR pairs on MEXC: ${eurPairs.map(p => p.symbol).join(', ')}`);
  // Prefer EURUSDT over others
  const preferred = eurPairs.find(p => p.symbol === 'EURUSDT');
  return preferred ? preferred.symbol : eurPairs[0].symbol;
}

// Fetch klines in batches - 1m candles for N days
async function fetchKlinesBatched(symbol, days) {
  const batchSize = 1000;
  const totalMinutes = days * 24 * 60;
  const batches = Math.ceil(totalMinutes / batchSize);
  let allCandles = [];
  const now = Date.now();

  for (let b = batches - 1; b >= 0; b--) {
    const endTime = now - (b * batchSize * 60 * 1000);
    const startTime = endTime - (batchSize * 60 * 1000);
    const url = `https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=${batchSize}`;
    const data = await fetchJson(url);
    if (data && Array.isArray(data) && data.length > 0) {
      allCandles = allCandles.concat(data);
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return allCandles;
}

// Trailing Buy Bot Backtest Simulator — 0% Fee (MEXC EURUSDT Zero-Fee Spot)
function simulateTrailingBot(candles, dipPct, trailPct, tpPct, slPct) {
  const TRADE_FEE = 0.0; // MEXC EURUSDT: 0% Maker AND 0% Taker
  const QUOTE_AMOUNT = 100;

  let status = 'PENDING';
  let peakPrice = null;
  let activationPrice = null;
  let bottomPrice = null;
  let triggerPrice = null;
  let execPrice = null;
  let entryWithFee = null;
  let tpTarget = null;
  let slTarget = null;

  let wins = 0, losses = 0, totalPnl = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const open  = parseFloat(c[1]);
    const high  = parseFloat(c[2]);
    const low   = parseFloat(c[3]);
    const close = parseFloat(c[4]);

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
        execPrice = triggerPrice;
        entryWithFee = execPrice * (1 + TRADE_FEE);
        tpTarget = entryWithFee * (1 + tpPct / 100);
        slTarget = entryWithFee * (1 - slPct / 100);
        status = 'TP_SL_ACTIVE';
      }
    }

    if (status === 'TP_SL_ACTIVE') {
      const qty = QUOTE_AMOUNT / entryWithFee;
      if (high >= tpTarget) {
        const pnl = qty * tpTarget * (1 - TRADE_FEE) - QUOTE_AMOUNT;
        wins++;
        totalPnl += pnl;
        // Reset
        status = 'PENDING';
        peakPrice = close;
        activationPrice = peakPrice * (1 - dipPct / 100);
        execPrice = null; entryWithFee = null; tpTarget = null; slTarget = null; bottomPrice = null;
      } else if (low <= slTarget) {
        const pnl = qty * slTarget * (1 - TRADE_FEE) - QUOTE_AMOUNT;
        losses++;
        totalPnl += pnl;
        // Reset
        status = 'PENDING';
        peakPrice = close;
        activationPrice = peakPrice * (1 - dipPct / 100);
        execPrice = null; entryWithFee = null; tpTarget = null; slTarget = null; bottomPrice = null;
      }
    }
  }

  const total = wins + losses;
  return {
    wins, losses, total,
    winRate: total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : 0,
    totalPnl: parseFloat(totalPnl.toFixed(4))
  };
}

async function runBacktest() {
  console.log('========================================================================');
  console.log('📊 EUR/USDT MEXC BACKTEST OPTIMIZER — 3 Weeks of Data');
  console.log('========================================================================\n');

  // Step 1: Discover EUR pair
  const eurSymbol = await discoverEurPair();

  let candles = [];
  let usedSymbol = '';

  if (eurSymbol) {
    console.log(`\n⏳ Fetching 1-min klines for ${eurSymbol} (21 days)...`);
    candles = await fetchKlinesBatched(eurSymbol, 21);
    usedSymbol = eurSymbol;
    console.log(`  Got ${candles.length} candles for ${eurSymbol}`);
  }

  if (!candles || candles.length < 100) {
    // Fallback: try Binance EURUSDT as proxy
    console.log('\n  MEXC does not list EUR/USDT spot. Falling back to Binance EURUSDT as market proxy...');
    usedSymbol = 'EURUSDT (Binance as MEXC proxy)';
    const batches = 21; // 21 batches × 1000 = 21,000 candles ≈ 21 days
    for (let b = batches - 1; b >= 0; b--) {
      const now = Date.now();
      const endTime = now - (b * 1000 * 60 * 1000);
      const startTime = endTime - (1000 * 60 * 1000);
      const url = `https://api.binance.com/api/v3/klines?symbol=EURUSDT&interval=1m&startTime=${startTime}&endTime=${endTime}&limit=1000`;
      const data = await fetchJson(url);
      if (data && Array.isArray(data)) candles = candles.concat(data);
      await new Promise(r => setTimeout(r, 100));
      process.stdout.write(`  Batch ${batches - b}/${batches} — ${candles.length} candles\r`);
    }
    console.log(`\n✅ Fetched ${candles.length} candles for ${usedSymbol}`);
  }

  if (candles.length < 100) {
    console.log('❌ Still insufficient data. Cannot run backtest.');
    return;
  }

  // Grid Search — 0% Fee (MEXC Zero-Fee Spot)
  const dipOffsets  = [0.10, 0.20, 0.30, 0.40, 0.50, 0.60];
  const trailValues = [0.10, 0.20, 0.30];
  const tpValues    = [0.10, 0.20, 0.30, 0.40, 0.50];
  const slValues    = [0.30, 0.40, 0.50]; // Reasonable SL options

  console.log(`\n🔄 Grid Search across ${dipOffsets.length * trailValues.length * tpValues.length * slValues.length} combinations on ${candles.length} 1-min candles (${usedSymbol})...\n`);

  let results = [];
  for (const dip of dipOffsets) {
    for (const trail of trailValues) {
      for (const tp of tpValues) {
        for (const sl of slValues) {
          if (trail >= dip) continue;
          if (tp < trail) continue;
          const res = simulateTrailingBot(candles, dip, trail, tp, sl);
          if (res.total > 0) {
            results.push({ dip, trail, tp, sl, ...res });
          }
        }
      }
    }
  }

  results.sort((a, b) => b.totalPnl - a.totalPnl);
  const top = results.slice(0, 25);

  console.log('========================================================================');
  console.log(`🏆 TOP 25 BEST COMBOS — EUR/USDT (${usedSymbol}) — Ranked by Net Profit on $100`);
  console.log('========================================================================');
  console.log('  Rank | Dip%  | Trail% | TP%  | SL%  | Trades | WinRate | Net PnL ($100)');
  console.log('  -----+-------+--------+------+------+--------+---------+---------------');

  top.forEach((r, i) => {
    const rank  = (i+1).toString().padStart(4);
    const dip   = r.dip.toFixed(2).padStart(5);
    const trail = r.trail.toFixed(2).padStart(5);
    const tp    = r.tp.toFixed(2).padStart(4);
    const sl    = r.sl.toFixed(2).padStart(4);
    const tot   = r.total.toString().padStart(6);
    const wr    = `${r.winRate}%`.padStart(7);
    const pnl   = `$${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(4)}`.padStart(14);
    console.log(`  ${rank} | ${dip}% | ${trail}% | ${tp}% | ${sl}% | ${tot} | ${wr} | ${pnl}`);
  });

  const best = results[0];
  if (!best) {
    console.log('\n⚠️  No trades triggered with any combination. EUR/USDT market may be too stable for these small offsets.');
    return;
  }

  console.log('\n========================================================================');
  console.log('🥇 OPTIMAL SETTINGS FOR EUR/USDT ON MEXC (Max Net Profit):');
  console.log('========================================================================');
  console.log(`  📌 Dip Offset:   ${best.dip}%`);
  console.log(`  📌 Trail Value:  ${best.trail}%`);
  console.log(`  📌 Take Profit:  ${best.tp}%`);
  console.log(`  📌 Stop Loss:    ${best.sl}%`);
  console.log(`  📊 Total Trades: ${best.total} (${best.wins} Wins / ${best.losses} Losses)`);
  console.log(`  📊 Win Rate:     ${best.winRate}%`);
  console.log(`  💰 Net PnL:      $${best.totalPnl >= 0 ? '+' : ''}${best.totalPnl.toFixed(4)} per $100 invested`);
  console.log('========================================================================\n');
}

runBacktest().catch(e => console.error(e));
