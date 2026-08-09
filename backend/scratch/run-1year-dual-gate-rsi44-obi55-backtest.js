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
    await new Promise(r => setTimeout(r, 60)); // Rate limit safety
  }

  const startDate = new Date(allCandles[0][0]).toISOString().substring(0, 10);
  const endDate = new Date(allCandles[allCandles.length - 1][0]).toISOString().substring(0, 10);
  console.log(`   Fetched ${allCandles.length} candles for ${symbol} (Span: ${startDate} to ${endDate})`);
  return allCandles;
}

function computeRsi(prices, period = 16) {
  const rsis = new Array(prices.length).fill(50.0);
  if (prices.length < period + 1) return rsis;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;
  rsis[period] = avgLoss === 0 ? 100.0 : 100.0 - (100.0 / (1.0 + (avgGain / avgLoss)));

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
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

function simulate1YearDualGate(symbol, klines, tpPct = 0.60, rsiMax = 44.0, obiMin = 55.0) {
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
  const rsiValues = computeRsi(closePrices, 16);

  const trades = [];
  let inTrade = false;
  let currentTrade = null;

  for (let i = 100; i < parsed.length; i++) {
    const bar = parsed[i];
    const rsi = rsiValues[i];

    // Microstructure Taker Buy Ratio Proxy
    const takerRatio = bar.quoteVolume > 0 ? (bar.takerBuyQuoteVol / bar.quoteVolume) * 100.0 : 50.0;
    const recentBars = parsed.slice(i - 4, i + 1);
    const upMoves = recentBars.filter(b => b.close >= b.open).length;

    let obiProxy = (takerRatio * 0.65) + (upMoves * 6.5) + ((55.0 - rsi) * 0.35);
    obiProxy = Math.min(Math.max(obiProxy, 35.0), 88.0);

    if (!inTrade) {
      // 🎯 DUAL GATE SIGNAL: RSI <= 44.0 AND OBI >= 55.0%
      if (rsi <= rsiMax && obiProxy >= obiMin) {
        inTrade = true;
        const buyPrice = bar.close;
        const tpTarget = buyPrice * (1.0 + (tpPct / 100.0));
        currentTrade = {
          symbol,
          entryIndex: i,
          entryTime: bar.timestamp,
          entryPrice: buyPrice,
          tpTarget,
          rsi,
          obi: obiProxy,
          status: 'OPEN',
          exitTime: null,
          exitPrice: null,
          durationHours: 0
        };
      }
    } else {
      // Check if TP Target hit on High price
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

async function runMaster1YearBacktest() {
  console.log("================================================================================");
  console.log("🏆 1-YEAR MASTER BACKTEST: BTC, ETH, SOL & GOLD (PAXG)");
  console.log("   CRITERIA: 4h 15m RSI <= 44.0 & Top 10 Avg OBI >= 55.0% | TP Target: +0.60%");
  console.log("================================================================================");

  const assetList = [
    { name: 'BTC (Bitcoin)', symbol: 'BTCUSDT' },
    { name: 'ETH (Ethereum)', symbol: 'ETHUSDT' },
    { name: 'SOL (Solana)', symbol: 'SOLUSDT' },
    { name: 'GOLD (XAUT/PAXG)', symbol: 'PAXGUSDT' }
  ];

  const summary = [];

  for (const asset of assetList) {
    const klines = await get1YearKlines(asset.symbol);
    const trades = simulate1YearDualGate(asset.name, klines, 0.60, 44.0, 55.0);

    const totalTrades = trades.length;
    const tpHits = trades.filter(t => t.status === 'TP_HIT');
    const pendingTrades = trades.filter(t => t.status === 'OPEN');

    const tpCount = tpHits.length;
    const pendingCount = pendingTrades.length;
    const winRate = totalTrades > 0 ? ((tpCount / totalTrades) * 100.0) : 0;

    const durations = tpHits.map(t => t.durationHours);
    const avgDurH = durations.length > 0 ? (durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const minDurH = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDurH = durations.length > 0 ? Math.max(...durations) : 0;

    const netProfitUsdt = tpCount * 0.60; // $0.60 profit per $100 trade

    summary.push({
      assetName: asset.name,
      symbol: asset.symbol,
      totalEntries: totalTrades,
      tpHitsCount: tpCount,
      pendingCount,
      winRate: parseFloat(winRate.toFixed(1)),
      avgDurH: parseFloat(avgDurH.toFixed(2)),
      minDurM: parseFloat((minDurH * 60).toFixed(1)),
      maxDurH: parseFloat(maxDurH.toFixed(1)),
      netProfitUsdt: parseFloat(netProfitUsdt.toFixed(2)),
      trades
    });

    console.log(`\n📌 ASSET: ${asset.name}`);
    console.log(`   Total Entries Confirmed: ${totalTrades}`);
    console.log(`   Take Profit (+0.6%) Hits: ${tpCount} 🟢`);
    console.log(`   Currently Pending Trades: ${pendingCount} ⏳`);
    console.log(`   Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`   Avg Time to Hit TP: ${avgDurH.toFixed(2)} Hours (${(avgDurH * 60).toFixed(0)} Minutes)`);
    console.log(`   Fastest TP Hit: ${(minDurH * 60).toFixed(1)} Minutes | Slowest TP Hit: ${maxDurH.toFixed(1)} Hours`);
    console.log(`   Total Net Profit ($100/trade): +$${netProfitUsdt.toFixed(2)} USDT`);
    console.log("--------------------------------------------------------------------------------");

    console.log("   Sample Individual Executed Trades (Chronological):");
    const sampleList = trades.slice(0, 5).concat(trades.slice(-3));
    sampleList.forEach((t, i) => {
      const entryPkt = new Date(t.entryTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT';
      const exitPkt = t.exitTime ? new Date(t.exitTime + (5 * 3600 * 1000)).toISOString().replace('T', ' ').substring(0, 16) + ' PKT' : 'Pending';
      const durationStr = t.status === 'TP_HIT' ? `TP HIT in ${t.durationHours.toFixed(1)}h` : 'STILL OPEN';
      console.log(`      [#${i + 1}] Entry (PKT): ${entryPkt} | Buy: $${t.entryPrice.toFixed(2)} -> TP Target: $${t.tpTarget.toFixed(2)} | RSI: ${t.rsi.toFixed(1)} | OBI: ${t.obi.toFixed(1)}% | Result: ${durationStr}`);
    });
  }

  // Save report to disk
  const reportPath = path.join(__dirname, '../1year_backtest_rsi44_obi55_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  console.log(`\n✅ Saved complete 1-Year Backtest Report to ${reportPath}`);
}

runMaster1YearBacktest().catch(err => console.error("Backtest error:", err));
