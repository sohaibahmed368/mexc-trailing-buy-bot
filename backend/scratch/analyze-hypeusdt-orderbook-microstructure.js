const MexcClient = require('../mexc-client');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');

const mexc = new MexcClient();
const radar = new MultiExchangeSignalRadar();

async function analyzeHypeMicrostructure() {
  console.log('========================================================================');
  console.log('🔍 HYPEUSDT LIVE ORDERBOOK & MARKET MICROSTRUCTURE ANALYSIS');
  console.log('========================================================================\n');

  const symbol = 'HYPEUSDT';

  // 1. Fetch MEXC Ticker Price
  try {
    const price = await mexc.getTickerPrice(symbol);
    console.log(`📌 Current MEXC Live Price for ${symbol}: $${price} USDT\n`);
  } catch (e) {
    console.log(`Could not fetch price from MEXC: ${e.message}`);
  }

  // 2. Fetch MEXC Orderbook at Depth 10, 50, 100, 500
  const depthsToTest = [10, 20, 50, 100, 500];
  console.log('------------------------------------------------------------------------');
  console.log('📊 MEXC ORDERBOOK BIDS VS ASKS DEPTH BREAKDOWN FOR HYPEUSDT:');
  console.log('------------------------------------------------------------------------');

  for (const limit of depthsToTest) {
    try {
      const depth = await mexc.getDepth(symbol, limit);
      if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
        let bidsVal = 0;
        let asksVal = 0;

        depth.bids.forEach(([p, q]) => bidsVal += (parseFloat(p) * parseFloat(q)));
        depth.asks.forEach(([p, q]) => asksVal += (parseFloat(p) * parseFloat(q)));

        const total = bidsVal + asksVal;
        const bidsRatio = total > 0 ? (bidsVal / total * 100).toFixed(1) : '50.0';
        const asksRatio = total > 0 ? (asksVal / total * 100).toFixed(1) : '50.0';

        console.log(`  Depth Limit ${limit.toString().padEnd(4)}: Bids Support = $${bidsVal.toFixed(2)} USDT (${bidsRatio}%) | Asks Resistance = $${asksVal.toFixed(2)} USDT (${asksRatio}%)`);
      }
    } catch (e) {
      console.log(`  Depth Limit ${limit}: Failed to fetch (${e.message})`);
    }
  }

  // 3. Multi-Exchange Signal Radar Metrics across Top Exchanges for HYPEUSDT
  console.log('\n------------------------------------------------------------------------');
  console.log('📡 MULTI-EXCHANGE RADAR SNAPSHOT FOR HYPEUSDT:');
  console.log('------------------------------------------------------------------------');

  try {
    const metrics = await radar.getMultiExchangeMetrics(symbol);
    if (metrics && Array.isArray(metrics.exchanges)) {
      metrics.exchanges.forEach(ex => {
        console.log(`  ${ex.name.padEnd(12)} (Rank #${ex.rank}): OBI (Bids) = ${ex.obiPct}% | 20s Taker Buy Flow = ${ex.takerBuyPct}% [${ex.status}]`);
      });
      console.log(`\n  👉 Consensus Summary: Avg OBI = ${metrics.consensus.avgObiPct}% | Avg 20s Taker Buy Flow = ${metrics.consensus.avgTakerBuyPct}%`);
    }
  } catch (e) {
    console.log(`Radar query failed: ${e.message}`);
  }

  console.log('\n========================================================================');
  console.log('🏆 ANALYSIS COMPLETE');
  console.log('========================================================================\n');
}

analyzeHypeMicrostructure().catch(e => console.error(e));
