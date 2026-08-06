const MexcClient = require('../mexc-client');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');

const mexcClient = new MexcClient();
const signalRadar = new MultiExchangeSignalRadar(mexcClient);

async function verifyTop10TakerFlowAggregation() {
  console.log("================================================================================");
  console.log("🔍 CORE AUDIT: TOP 10 EXCHANGES TAKER BUY FLOW AGGREGATION CHECK");
  console.log("================================================================================");

  const symbols = ['GOLD(XAUT)USDT', 'SUIUSDT', 'SOLUSDT', 'ETHUSDT'];

  for (const sym of symbols) {
    console.log(`\n⏳ Fetching live multi-exchange metrics for ${sym}...`);
    const metrics = await signalRadar.getMultiExchangeMetrics(sym);

    console.log(`\n🏆 ${sym} AGGREGATED METRICS:`);
    console.log(`- Top 10 Average Taker Buy Flow: ${metrics.averageTakerBuyPct}%`);
    console.log(`- Top 10 Average OBI Index: ${metrics.averageObiPct}%`);
    console.log(`- Active Exchanges Count: ${metrics.exchangesCount} of ${metrics.exchanges.length}`);

    console.log(`\n📌 INDIVIDUAL EXCHANGES TAKER BUY BREAKDOWN:`);
    metrics.exchanges.forEach((ex, idx) => {
      console.log(`  [${idx + 1}] ${ex.name.padEnd(15, ' ')} -> Taker Buy Flow: ${ex.takerBuyPct !== undefined ? ex.takerBuyPct.toFixed(1) + '%' : 'N/A'} | OBI: ${ex.obiPct.toFixed(1)}%`);
    });
  }
}

verifyTop10TakerFlowAggregation().catch(console.error);
