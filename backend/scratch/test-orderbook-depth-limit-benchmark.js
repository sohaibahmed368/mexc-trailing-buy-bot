const MexcClient = require('../mexc-client');
const mexc = new MexcClient();

async function benchmarkDepthLimits() {
  console.log('========================================================================');
  console.log('🧪 MEXC ORDER BOOK DEPTH LIMIT BENCHMARK & ACCURACY TEST');
  console.log('========================================================================\n');

  const symbol = 'SOLUSDT';
  const limits = [20, 100, 200, 500];
  const currentPrice = await mexc.getTickerPrice(symbol).catch(() => 140.0);
  const rangeLower = currentPrice * 0.985;
  const rangeUpper = currentPrice * 1.015;

  console.log(`📌 Target Symbol: ${symbol} | Current Price: $${currentPrice.toFixed(2)} USDT`);
  console.log(`📌 Filtering Window (±1.5%): $${rangeLower.toFixed(2)} -> $${rangeUpper.toFixed(2)}\n`);

  for (const limit of limits) {
    const startTime = Date.now();
    let depth;
    try {
      depth = await mexc.getDepth(symbol, limit);
    } catch (e) {
      console.log(`  ❌ Limit ${limit} query failed: ${e.message}`);
      continue;
    }
    const latency = Date.now() - startTime;

    let totalBidsVal = 0;
    let totalAsksVal = 0;
    let bidsCountFiltered = 0;
    let asksCountFiltered = 0;

    if (depth && Array.isArray(depth.bids)) {
      depth.bids.forEach(([p, q]) => {
        const pr = parseFloat(p);
        if (pr >= rangeLower && pr <= rangeUpper) {
          totalBidsVal += (pr * parseFloat(q));
          bidsCountFiltered++;
        }
      });
    }

    if (depth && Array.isArray(depth.asks)) {
      depth.asks.forEach(([p, q]) => {
        const pr = parseFloat(p);
        if (pr >= rangeLower && pr <= rangeUpper) {
          totalAsksVal += (pr * parseFloat(q));
          asksCountFiltered++;
        }
      });
    }

    const totalVal = totalBidsVal + totalAsksVal;
    const obiPct = totalVal > 0 ? ((totalBidsVal / totalVal) * 100) : 50.0;

    console.log(`🔹 Depth Limit = ${limit}:`);
    console.log(`    - API Latency: ${latency} ms`);
    console.log(`    - Orders inside ±1.5% Window: Bids=${bidsCountFiltered}, Asks=${asksCountFiltered}`);
    console.log(`    - Total Liquidity Evaluated: $${totalVal.toFixed(2)} USDT`);
    console.log(`    - Calculated OBI Ratio: ${obiPct.toFixed(2)}%\n`);
  }

  console.log('========================================================================');
  console.log('🏆 DEPTH BENCHMARK COMPLETE!');
  console.log('========================================================================\n');
}

benchmarkDepthLimits().catch(e => console.error(e));
