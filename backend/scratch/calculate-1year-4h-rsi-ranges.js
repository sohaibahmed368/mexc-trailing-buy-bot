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
  const targetCount = 365 * 24 * 4; // ~35,040 15m candles

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

function compute4HourRsiSeries(closePrices, period = 16) {
  const rsis = new Array(closePrices.length).fill(null);
  if (closePrices.length < period + 1) return rsis;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsis[period] = avgLoss === 0 ? 100.0 : 100.0 - (100.0 / (1.0 + (avgGain / avgLoss)));

  for (let i = period + 1; i < closePrices.length; i++) {
    const diff = closePrices[i] - closePrices[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = ((avgGain * (period - 1)) + gain) / period;
    avgLoss = ((avgLoss * (period - 1)) + loss) / period;

    if (avgLoss === 0) {
      rsis[i] = 100.0;
    } else {
      const rs = avgGain / avgLoss;
      rsis[i] = 100.0 - (100.0 / (1.0 + rs));
    }
  }
  return rsis;
}

async function runRsiRangeAudit() {
  console.log("================================================================================");
  console.log("📊 1-YEAR 4-HOUR RSI RANGE & DISTRIBUTION BACKTEST");
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
    const closePrices = klines.map(c => parseFloat(c[4]));
    const timestamps = klines.map(c => parseInt(c[0]));

    const rsiValues = compute4HourRsiSeries(closePrices, 16);

    let minRsi = 100;
    let maxRsi = 0;
    let minRsiIndex = 0;
    let maxRsiIndex = 0;
    let rsiSum = 0;
    let validCount = 0;

    let rangeUnder30 = 0;
    let range30to40 = 0;
    let range40to50 = 0;
    let range50to60 = 0;
    let range60to70 = 0;
    let rangeAbove70 = 0;

    for (let i = 17; i < rsiValues.length; i++) {
      const rsi = rsiValues[i];
      if (rsi === null) continue;

      validCount++;
      rsiSum += rsi;

      if (rsi < minRsi) {
        minRsi = rsi;
        minRsiIndex = i;
      }
      if (rsi > maxRsi) {
        maxRsi = rsi;
        maxRsiIndex = i;
      }

      if (rsi < 30.0) rangeUnder30++;
      else if (rsi >= 30.0 && rsi < 40.0) range30to40++;
      else if (rsi >= 40.0 && rsi < 50.0) range40to50++;
      else if (rsi >= 50.0 && rsi < 60.0) range50to60++;
      else if (rsi >= 60.0 && rsi < 70.0) range60to70++;
      else if (rsi >= 70.0) rangeAbove70++;
    }

    const avgRsi = rsiSum / validCount;

    const minTimePkt = new Date(timestamps[minRsiIndex] + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
    const maxTimePkt = new Date(timestamps[maxRsiIndex] + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';

    const item = {
      assetName: asset.name,
      symbol: asset.symbol,
      totalCandles: validCount,
      minRsi: parseFloat(minRsi.toFixed(2)),
      minRsiPrice: closePrices[minRsiIndex],
      minRsiTimePkt: minTimePkt,
      maxRsi: parseFloat(maxRsi.toFixed(2)),
      maxRsiPrice: closePrices[maxRsiIndex],
      maxRsiTimePkt: maxTimePkt,
      avgRsi: parseFloat(avgRsi.toFixed(2)),
      distribution: {
        under30Pct: parseFloat(((rangeUnder30 / validCount) * 100).toFixed(2)),
        between30and40Pct: parseFloat(((range30to40 / validCount) * 100).toFixed(2)),
        between40and50Pct: parseFloat(((range40to50 / validCount) * 100).toFixed(2)),
        between50and60Pct: parseFloat(((range50to60 / validCount) * 100).toFixed(2)),
        between60and70Pct: parseFloat(((range60to70 / validCount) * 100).toFixed(2)),
        above70Pct: parseFloat(((rangeAbove70 / validCount) * 100).toFixed(2))
      }
    };

    fullReport.push(item);

    console.log(`\n📌 ASSET: ${asset.name}`);
    console.log(`   Total 15m Candles Audited: ${validCount.toLocaleString()}`);
    console.log(`   📉 MINIMUM 4h RSI Value: ${minRsi.toFixed(2)} (Recorded at ${minTimePkt} @ $${closePrices[minRsiIndex].toFixed(2)} USDT)`);
    console.log(`   📈 MAXIMUM 4h RSI Value: ${maxRsi.toFixed(2)} (Recorded at ${maxTimePkt} @ $${closePrices[maxRsiIndex].toFixed(2)} USDT)`);
    console.log(`   ⚖️ AVERAGE 4h RSI Value: ${avgRsi.toFixed(2)}`);
    console.log(`   📊 Time Distribution breakdown:`);
    console.log(`      - Deep Panic Dip (RSI < 30.0): ${item.distribution.under30Pct}% of the time`);
    console.log(`      - Oversold Dip (RSI 30.0 - 40.0): ${item.distribution.between30and40Pct}% of the time`);
    console.log(`      - Neutral Low (RSI 40.0 - 50.0): ${item.distribution.between40and50Pct}% of the time`);
    console.log(`      - Neutral High (RSI 50.0 - 60.0): ${item.distribution.between50and60Pct}% of the time`);
    console.log(`      - Bullish Trend (RSI 60.0 - 70.0): ${item.distribution.between60and70Pct}% of the time`);
    console.log(`      - Overbought Peak (RSI >= 70.0): ${item.distribution.above70Pct}% of the time`);
    console.log("--------------------------------------------------------------------------------");
  }

  const reportPath = path.join(__dirname, '../1year_4h_rsi_range_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`\n✅ Saved complete 4h RSI Range Report to ${reportPath}`);
}

runRsiRangeAudit().catch(err => console.error("RSI audit error:", err));
