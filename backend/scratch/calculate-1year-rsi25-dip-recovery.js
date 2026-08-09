const https = require('https');
const fs = require('fs');
const path = require('path');

function fetchJson(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function get1YearKlines(symbol) {
  console.log(`📥 Fetching 1 Year (365 Days) 15m candles for ${symbol}...`);
  let allCandles = [];
  let endTime = Date.now();
  const targetCount = 365 * 24 * 4;

  while (allCandles.length < targetCount) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=1000&endTime=${endTime}`;
    const candles = await fetchJson(url);
    if (!Array.isArray(candles) || candles.length === 0) break;
    allCandles = candles.concat(allCandles);
    endTime = candles[0][0] - 1;
    if (candles.length < 1000) break;
    await new Promise(r => setTimeout(r, 50));
  }

  const startDate = new Date(allCandles[0][0]).toISOString().substring(0, 10);
  const endDate = new Date(allCandles[allCandles.length - 1][0]).toISOString().substring(0, 10);
  console.log(`   Fetched ${allCandles.length} candles for ${symbol} (${startDate} to ${endDate})`);
  return allCandles;
}

// Compute RSI 14 over 4-hour window (16 x 15m candles = 4 hours)
function compute4HourRsi14(closePrices, period = 14) {
  const rsis = new Array(closePrices.length).fill(null);
  const candleWindow = period * 1; // 14 period 4h rolling RSI

  if (closePrices.length < candleWindow + 1) return rsis;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= candleWindow; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / candleWindow;
  let avgLoss = losses / candleWindow;
  rsis[candleWindow] = avgLoss === 0 ? 100.0 : 100.0 - (100.0 / (1.0 + (avgGain / avgLoss)));

  for (let i = candleWindow + 1; i < closePrices.length; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = ((avgGain * (candleWindow - 1)) + gain) / candleWindow;
    avgLoss = ((avgLoss * (candleWindow - 1)) + loss) / candleWindow;

    if (avgLoss === 0) {
      rsis[i] = 100.0;
    } else {
      const rs = avgGain / avgLoss;
      rsis[i] = 100.0 - (100.0 / (1.0 + rs));
    }
  }
  return rsis;
}

function auditRsiBelow25Events(symbol, klines) {
  const closePrices = klines.map(c => parseFloat(c[4]));
  const timestamps = klines.map(c => parseInt(c[0]));
  const rsiValues = compute4HourRsi14(closePrices, 14);

  const events = [];
  let isBelow25 = false;
  let currentEvent = null;

  for (let i = 20; i < rsiValues.length; i++) {
    const rsi = rsiValues[i];
    if (rsi === null) continue;

    if (!isBelow25) {
      // 🚨 Detected RSI dropping below 25.0
      if (rsi < 25.0) {
        isBelow25 = true;
        currentEvent = {
          eventId: events.length + 1,
          symbol,
          dipStartTime: timestamps[i],
          dipStartPrice: closePrices[i],
          dipStartRsi: rsi,
          lowestRsi: rsi,
          lowestPrice: closePrices[i],
          lowestRsiTime: timestamps[i],
          recoveryTime: null,
          recoveryPrice: null,
          recoveryRsi: null,
          durationBars: 1,
          durationHours: 0
        };
      }
    } else {
      // Currently inside RSI < 25.0 zone
      currentEvent.durationBars++;
      if (rsi < currentEvent.lowestRsi) {
        currentEvent.lowestRsi = rsi;
        currentEvent.lowestPrice = closePrices[i];
        currentEvent.lowestRsiTime = timestamps[i];
      }

      // 🟢 Detected RSI crossing BACK UP ABOVE 25.0
      if (rsi >= 25.0) {
        isBelow25 = false;
        currentEvent.recoveryTime = timestamps[i];
        currentEvent.recoveryPrice = closePrices[i];
        currentEvent.recoveryRsi = rsi;
        currentEvent.durationHours = (currentEvent.recoveryTime - currentEvent.dipStartTime) / (1000 * 3600);
        events.push(currentEvent);
        currentEvent = null;
      }
    }
  }

  // Handle ongoing event if still below 25 at end of data
  if (isBelow25 && currentEvent) {
    currentEvent.recoveryTime = timestamps[timestamps.length - 1];
    currentEvent.recoveryPrice = closePrices[closePrices.length - 1];
    currentEvent.recoveryRsi = rsiValues[rsiValues.length - 1];
    currentEvent.durationHours = (currentEvent.recoveryTime - currentEvent.dipStartTime) / (1000 * 3600);
    events.push(currentEvent);
  }

  return events;
}

async function runRsi25Audit() {
  console.log("================================================================================");
  console.log("📊 1-YEAR 4-HOUR RSI < 25 DIP & RECOVERY TIME AUDIT");
  console.log("   ASSETS: BTC, ETH, SOL, GOLD | 15-MINUTE CANDLES (35,000+ per Asset)");
  console.log("================================================================================");

  const assetList = [
    { name: 'BTC (Bitcoin)', symbol: 'BTCUSDT' },
    { name: 'ETH (Ethereum)', symbol: 'ETHUSDT' },
    { name: 'SOL (Solana)', symbol: 'SOLUSDT' },
    { name: 'GOLD (XAUT/PAXG)', symbol: 'PAXGUSDT' }
  ];

  const fullReport = [];

  for (const asset of assetList) {
    const klines = await get1YearKlines(asset.symbol);
    const events = auditRsiBelow25Events(asset.name, klines);

    const totalEvents = events.length;
    const durations = events.map(e => e.durationHours);
    const lowestRsis = events.map(e => e.lowestRsi);

    const avgDurationH = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const minDurationH = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDurationH = durations.length > 0 ? Math.max(...durations) : 0;
    const absoluteMinRsi = lowestRsis.length > 0 ? Math.min(...lowestRsis) : 25;

    const summaryItem = {
      assetName: asset.name,
      symbol: asset.symbol,
      totalEventsCount: totalEvents,
      absoluteMinRsi: parseFloat(absoluteMinRsi.toFixed(2)),
      avgRecoveryHours: parseFloat(avgDurationH.toFixed(2)),
      avgRecoveryMinutes: Math.round(avgDurationH * 60),
      minRecoveryMinutes: Math.round(minDurationH * 60),
      maxRecoveryHours: parseFloat(maxDurationH.toFixed(1)),
      events
    };

    fullReport.push(summaryItem);

    console.log(`\n📌 ASSET: ${asset.name}`);
    console.log(`   Total Times RSI Dropped Below 25 (< 25.0): ${totalEvents} Times`);
    console.log(`   📉 Lowest RSI Level Reached in Dips: ${absoluteMinRsi.toFixed(2)}`);
    console.log(`   ⏱️ Average Time to Recover Above 25: ${avgDurationH.toFixed(2)} Hours (${Math.round(avgDurationH * 60)} Minutes)`);
    console.log(`   ⚡ Fastest Recovery Above 25: ${Math.round(minDurationH * 60)} Minutes | Slowest Recovery: ${maxDurationH.toFixed(1)} Hours`);
    console.log("--------------------------------------------------------------------------------");

    console.log("   Individual Dip & Recovery Events (Chronological):");
    events.slice(0, 10).forEach((e, idx) => {
      const dipPkt = new Date(e.dipStartTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
      const recPkt = new Date(e.recoveryTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
      const durMins = Math.round(e.durationHours * 60);
      console.log(`      [#${e.eventId}] Dip Start: ${dipPkt} ($${e.dipStartPrice.toFixed(2)} | RSI ${e.dipStartRsi.toFixed(1)})`);
      console.log(`          Lowest Point: RSI ${e.lowestRsi.toFixed(1)} @ $${e.lowestPrice.toFixed(2)}`);
      console.log(`          Recovered >25: ${recPkt} ($${e.recoveryPrice.toFixed(2)} | RSI ${e.recoveryRsi.toFixed(1)}) in ${e.durationHours.toFixed(1)}h (${durMins} mins)`);
    });
  }

  const reportPath = path.join(__dirname, '../1year_rsi25_dip_recovery_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`\n✅ Saved complete RSI < 25 Dip & Recovery Report to ${reportPath}`);
}

runRsi25Audit().catch(err => console.error("RSI 25 audit error:", err));
