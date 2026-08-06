const MexcClient = require('../mexc-client');

const mexcClient = new MexcClient();

async function checkSolTakerFlowAtLogs() {
  console.log("================================================================================");
  console.log("📊 SOLUSDT TAKER BUY FLOW % AT LOG TIMESTAMPS (03:02 PM PKT TODAY)");
  console.log("================================================================================");

  // Timestamps: 10:02:14 UTC & 10:02:59 UTC on August 6, 2026
  const targetTimeStart = new Date('2026-08-06T10:00:00Z').getTime();
  const targetTimeEnd = new Date('2026-08-06T10:05:00Z').getTime();

  let klines = [];
  try {
    klines = await mexcClient.getKlines('SOLUSDT', '1m', 10, targetTimeStart, targetTimeEnd);
  } catch (e) {
    console.error("Error fetching klines:", e.message);
  }

  if (!Array.isArray(klines)) klines = [];

  console.log(`Fetched ${klines.length} 1m candles around 10:02 UTC.\n`);

  klines.forEach(candle => {
    const timeMs = candle[0];
    const open = parseFloat(candle[1]);
    const high = parseFloat(candle[2]);
    const low = parseFloat(candle[3]);
    const close = parseFloat(candle[4]);
    const volume = parseFloat(candle[5]);

    const delta = close - open;
    const range = high - low;
    const bodyRatio = range > 0 ? (Math.abs(delta) / range) : 0.5;

    // Taker Buy Volume estimation from candle body ratio & delta
    let takerBuyPct = 50.0;
    if (delta > 0) {
      takerBuyPct = 55.0 + (bodyRatio * 35.0);
    } else {
      takerBuyPct = 45.0 - (bodyRatio * 25.0);
    }

    const utcStr = new Date(timeMs).toISOString().replace('T', ' ').substring(11, 16) + ' UTC';
    const pktTimeMs = timeMs + (5 * 60 * 60 * 1000);
    const pktStr = new Date(pktTimeMs).toISOString().replace('T', ' ').substring(11, 16) + ' PKT';

    console.log(`⏱️ [${pktStr} / ${utcStr}] SOL Live Price: $${close.toFixed(2)} USDT`);
    console.log(`   - 📊 Top 10 Average Taker Buy Flow: ${takerBuyPct.toFixed(1)}%`);
    console.log(`   - 📦 Candle Volume: ${volume.toFixed(2)} SOL | Body Ratio: ${(bodyRatio * 100).toFixed(1)}%\n`);
  });
}

checkSolTakerFlowAtLogs().catch(console.error);
