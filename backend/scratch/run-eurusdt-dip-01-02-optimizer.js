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

async function fetchCandles(symbol, interval, intervalMinutes, days) {
  const batchSize = 1000;
  const totalCandles = Math.ceil((days * 24 * 60) / intervalMinutes);
  const batches = Math.ceil(totalCandles / batchSize);
  let allCandles = [];
  const now = Date.now();

  for (let b = batches - 1; b >= 0; b--) {
    const endTime = now - (b * batchSize * intervalMinutes * 60 * 1000);
    const startTime = endTime - (batchSize * intervalMinutes * 60 * 1000);

    let data = await fetchJson(`https://api.mexc.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${batchSize}`);
    if (!data || !Array.isArray(data) || data.length === 0) {
      data = await fetchJson(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${batchSize}`);
    }
    if (data && Array.isArray(data) && data.length > 0) allCandles = allCandles.concat(data);
    await new Promise(r => setTimeout(r, 80));
  }
  return allCandles;
}

// Full sim: 0% fee
function simulate(candles, dipPct, trailPct, tpPct, slPct) {
  const QUOTE = 100.0;
  const FEE = 0.0; // MEXC EURUSDT = 0%

  let status = 'PENDING';
  let peakPrice = null, activationPrice = null;
  let bottomPrice = null, triggerPrice = null;
  let execPrice = null, tpTarget = null, slTarget = null;
  let wins = 0, losses = 0, totalPnl = 0;

  for (const c of candles) {
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
        tpTarget = execPrice * (1 + tpPct / 100);
        slTarget = execPrice * (1 - slPct / 100);
        status = 'TP_SL_ACTIVE';
      }
    }

    if (status === 'TP_SL_ACTIVE') {
      const qty = QUOTE / execPrice;
      if (high >= tpTarget) {
        const pnl = qty * tpTarget - QUOTE;
        wins++; totalPnl += pnl;
        status = 'PENDING'; peakPrice = close;
        activationPrice = peakPrice * (1 - dipPct / 100);
        execPrice = null; tpTarget = null; slTarget = null; bottomPrice = null;
      } else if (low <= slTarget) {
        const pnl = qty * slTarget - QUOTE;
        losses++; totalPnl += pnl;
        status = 'PENDING'; peakPrice = close;
        activationPrice = peakPrice * (1 - dipPct / 100);
        execPrice = null; tpTarget = null; slTarget = null; bottomPrice = null;
      }
    }
  }

  const total = wins + losses;
  return {
    wins, losses, total,
    winRate: total > 0 ? parseFloat((wins / total * 100).toFixed(1)) : 0,
    totalPnl: parseFloat(totalPnl.toFixed(4)),
    pnlPer100: parseFloat(totalPnl.toFixed(4))
  };
}

function printTable(title, results) {
  console.log(`\n${title}`);
  console.log('  Rank | Trail% | TP%  | SL%  | Trades | WinRate | Net PnL ($100)');
  console.log('  -----+--------+------+------+--------+---------+---------------');
  results.slice(0, 15).forEach((r, i) => {
    const rank  = (i + 1).toString().padStart(4);
    const trail = r.trail.toFixed(2).padStart(6);
    const tp    = r.tp.toFixed(2).padStart(4);
    const sl    = r.sl.toFixed(2).padStart(4);
    const tot   = r.total.toString().padStart(6);
    const wr    = `${r.winRate}%`.padStart(7);
    const pnl   = `$${r.totalPnl >= 0 ? '+' : ''}${r.totalPnl.toFixed(4)}`.padStart(14);
    console.log(`  ${rank} | ${trail}% | ${tp}% | ${sl}% | ${tot} | ${wr} | ${pnl}`);
  });
}

async function run() {
  console.log('========================================================================');
  console.log('📊 EURUSDT — DIP 0.10% vs 0.20% BACKTEST (1 Year 1h — 0% Fee)');
  console.log('   Finding optimal Trail, TP, SL for Max Profit');
  console.log('========================================================================\n');

  console.log('⏳ Fetching 1 year of EURUSDT 1h candles from MEXC...');
  const candles = await fetchCandles('EURUSDT', '1h', 60, 365);
  console.log(`✅ Fetched ${candles.length} candles\n`);

  if (candles.length < 100) {
    console.log('❌ Insufficient data. Exiting.'); return;
  }

  // Grid params
  const trailValues = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30];
  const tpValues    = [0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
  const slValues    = [0.10, 0.15, 0.20, 0.30, 0.40, 0.50];

  const totalCombos = trailValues.length * tpValues.length * slValues.length;
  console.log(`🔄 Testing ${totalCombos} combinations per dip offset...\n`);

  // ─── DIP = 0.10% ────────────────────────────────────────────────────────────
  let results01 = [];
  for (const trail of trailValues) {
    for (const tp of tpValues) {
      for (const sl of slValues) {
        if (trail >= 0.10) continue;
        if (tp < trail) continue;
        const r = simulate(candles, 0.10, trail, tp, sl);
        if (r.total > 0) results01.push({ trail, tp, sl, ...r });
      }
    }
  }
  results01.sort((a, b) => b.totalPnl - a.totalPnl);

  printTable(
    '========================================================================\n🔵 DIP = 0.10% — TOP 15 COMBOS (Trail, TP, SL) — Max Profit\n========================================================================',
    results01
  );

  const best01 = results01[0];
  if (best01) {
    console.log(`\n  🏆 BEST for Dip 0.10%:`);
    console.log(`     Trail=${best01.trail}% | TP=${best01.tp}% | SL=${best01.sl}%`);
    console.log(`     Trades=${best01.total} (${best01.wins}W/${best01.losses}L) | Win=${best01.winRate}% | PnL=$${best01.totalPnl >= 0 ? '+' : ''}${best01.totalPnl}`);
  }

  // ─── DIP = 0.20% ────────────────────────────────────────────────────────────
  let results02 = [];
  for (const trail of trailValues) {
    for (const tp of tpValues) {
      for (const sl of slValues) {
        if (trail >= 0.20) continue;
        if (tp < trail) continue;
        const r = simulate(candles, 0.20, trail, tp, sl);
        if (r.total > 0) results02.push({ trail, tp, sl, ...r });
      }
    }
  }
  results02.sort((a, b) => b.totalPnl - a.totalPnl);

  printTable(
    '\n========================================================================\n🟢 DIP = 0.20% — TOP 15 COMBOS (Trail, TP, SL) — Max Profit\n========================================================================',
    results02
  );

  const best02 = results02[0];
  if (best02) {
    console.log(`\n  🏆 BEST for Dip 0.20%:`);
    console.log(`     Trail=${best02.trail}% | TP=${best02.tp}% | SL=${best02.sl}%`);
    console.log(`     Trades=${best02.total} (${best02.wins}W/${best02.losses}L) | Win=${best02.winRate}% | PnL=$${best02.totalPnl >= 0 ? '+' : ''}${best02.totalPnl}`);
  }

  console.log('\n========================================================================');
  console.log('📋 FINAL SUMMARY — DIP 0.10% vs 0.20% COMPARISON:');
  console.log('========================================================================');
  if (best01) console.log(`  Dip 0.10% → Trail=${best01.trail}% | TP=${best01.tp}% | SL=${best01.sl}% → ${best01.total} trades → $${best01.totalPnl >= 0 ? '+' : ''}${best01.totalPnl} total PnL`);
  if (best02) console.log(`  Dip 0.20% → Trail=${best02.trail}% | TP=${best02.tp}% | SL=${best02.sl}% → ${best02.total} trades → $${best02.totalPnl >= 0 ? '+' : ''}${best02.totalPnl} total PnL`);
  console.log('========================================================================\n');
}

run().catch(e => console.error(e));
