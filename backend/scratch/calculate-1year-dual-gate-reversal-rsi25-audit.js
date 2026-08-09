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

function compute4HourRsi(closePrices, period = 16) {
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

function auditDualGateReversals(symbol, klines, tpPct = 0.60, rsiMax = 45.0, obiMin = 55.0) {
  const parsed = klines.map(c => ({
    timestamp: parseInt(c[0]),
    open: parseFloat(c[1]),
    high: parseFloat(c[2]),
    low: parseFloat(c[3]),
    close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    quoteVolume: parseFloat(c[7]),
    takerBuyQuoteVol: parseFloat(c[10])
  }));

  const closePrices = parsed.map(p => p.close);
  const rsiValues = compute4HourRsi(closePrices, 16);

  const trades = [];
  let inTrade = false;
  let currentTrade = null;

  for (let i = 100; i < parsed.length; i++) {
    const bar = parsed[i];
    const rsi = rsiValues[i];

    // Orderbook Taker Flow & Microstructure OBI Proxy
    const takerRatio = bar.quoteVolume > 0 ? (bar.takerBuyQuoteVol / bar.quoteVolume) * 100.0 : 50.0;
    const recentBars = parsed.slice(i - 4, i + 1);
    const upMoves = recentBars.filter(b => b.close >= b.open).length;

    let obiProxy = (takerRatio * 0.65) + (upMoves * 6.5) + ((55.0 - rsi) * 0.35);
    obiProxy = Math.min(Math.max(obiProxy, 35.0), 88.0);

    if (!inTrade) {
      // 🎯 DUAL GATE ENTRY SIGNAL: RSI < 45.0 AND OBI >= 55.0%
      if (rsi < rsiMax && obiProxy >= obiMin) {
        inTrade = true;
        const buyPrice = bar.close;
        const tpTarget = buyPrice * (1.0 + (tpPct / 100.0));
        currentTrade = {
          tradeId: trades.length + 1,
          symbol,
          entryIndex: i,
          entryTime: bar.timestamp,
          entryPrice: buyPrice,
          tpTarget,
          entryRsi: rsi,
          entryObi: obiProxy,
          status: 'OPEN',
          reversedWithRsiBelow25: false,
          minRsiDuringTrade: rsi,
          minPriceDuringTrade: buyPrice,
          exitTime: null,
          exitPrice: null,
          durationHours: 0
        };
      }
    } else {
      // Monitor adverse price & RSI movements during active trade
      if (rsi < currentTrade.minRsiDuringTrade) {
        currentTrade.minRsiDuringTrade = rsi;
      }
      if (bar.low < currentTrade.minPriceDuringTrade) {
        currentTrade.minPriceDuringTrade = bar.low;
      }

      // Check if price reversed & 4h RSI dropped below 25 during trade
      if (rsi < 25.0) {
        currentTrade.reversedWithRsiBelow25 = true;
      }

      // Check if TP Target (+0.60%) hit on high price
      if (bar.high >= currentTrade.tpTarget) {
        currentTrade.status = 'TP_HIT';
        currentTrade.exitTime = bar.timestamp;
        currentTrade.exitPrice = currentTrade.tpTarget;
        currentTrade.durationHours = (currentTrade.exitTime - currentTrade.entryTime) / (1000 * 3600);
        trades.push(currentTrade);
        inTrade = false;
        currentTrade = null;
      }
    }
  }

  if (inTrade && currentTrade) {
    currentTrade.durationHours = (parsed[parsed.length - 1].timestamp - currentTrade.entryTime) / (1000 * 3600);
    trades.push(currentTrade);
  }

  return trades;
}

async function runFullReversalScenarioAudit() {
  console.log("================================================================================");
  console.log("🏆 1-YEAR DUAL GATE TRADE REVERSAL & RSI < 25 SCENARIO AUDIT");
  console.log("   CRITERIA: 4h 15m RSI < 45.0 & OBI >= 55.0% | TP Target: +0.60%");
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
    const trades = auditDualGateReversals(asset.name, klines, 0.60, 45.0, 55.0);

    const totalEntries = trades.length;
    const tpHits = trades.filter(t => t.status === 'TP_HIT');
    const pendingTrades = trades.filter(t => t.status === 'OPEN');
    const reversedTrades = trades.filter(t => t.reversedWithRsiBelow25);
    const reversedAndHitTp = reversedTrades.filter(t => t.status === 'TP_HIT');

    const tpCount = tpHits.length;
    const pendingCount = pendingTrades.length;
    const reversedCount = reversedTrades.length;
    const reversedHitTpCount = reversedAndHitTp.length;
    const winRate = totalEntries > 0 ? ((tpCount / totalEntries) * 100.0) : 0;

    const summaryItem = {
      assetName: asset.name,
      symbol: asset.symbol,
      totalEntriesConfirmed: totalEntries,
      tpHitsCount: tpCount,
      pendingCount,
      winRatePct: parseFloat(winRate.toFixed(1)),
      reversedRsiBelow25Count: reversedCount,
      reversedHitTpCount: reversedHitTpCount,
      trades
    };

    fullReport.push(summaryItem);

    console.log(`\n📌 ASSET: ${asset.name}`);
    console.log(`   1️⃣ Total Times Entry Triggered (RSI < 45 & OBI >= 55%): ${totalEntries} Trades`);
    console.log(`   2️⃣ Total Take Profit (+0.60%) Hits: ${tpCount} Trades 🟢 (Win Rate: ${winRate.toFixed(1)}%)`);
    console.log(`   3️⃣ Total Currently Pending Trades: ${pendingCount} Trades ⏳`);
    console.log(`   4️⃣ Total Times Trade Reversed & RSI Dropped Below 25 (< 25): ${reversedCount} Trades (${((reversedCount / (totalEntries || 1)) * 100).toFixed(1)}%)`);
    console.log(`   5️⃣ Reversal Recovery Hits (+0.6% TP Hit after RSI < 25): ${reversedHitTpCount} of ${reversedCount} Trades (${((reversedHitTpCount / (reversedCount || 1)) * 100).toFixed(1)}% Recovered!)`);
    console.log("--------------------------------------------------------------------------------");

    if (reversedTrades.length > 0) {
      console.log("   Sample Reversal Trades (Where RSI dropped < 25 before TP):");
      reversedTrades.slice(0, 5).forEach((t, idx) => {
        const entryPkt = new Date(t.entryTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
        const exitPkt = t.exitTime ? new Date(t.exitTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT' : 'Pending';
        console.log(`      [#${t.tradeId}] Entry: ${entryPkt} | Buy: $${t.entryPrice.toFixed(2)} -> TP: $${t.tpTarget.toFixed(2)}`);
        console.log(`          Lowest RSI Reached: ${t.minRsiDuringTrade.toFixed(1)} | Lowest Price: $${t.minPriceDuringTrade.toFixed(2)}`);
        console.log(`          Result: ${t.status === 'TP_HIT' ? `🟢 TP HIT in ${t.durationHours.toFixed(1)}h (${exitPkt})` : '⏳ STILL OPEN'}`);
      });
    }
  }

  const reportPath = path.join(__dirname, '../1year_reversal_rsi25_scenario_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
  console.log(`\n✅ Saved complete Reversal & RSI < 25 Audit Report to ${reportPath}`);
}

runFullReversalScenarioAudit().catch(err => console.error("Reversal audit error:", err));
