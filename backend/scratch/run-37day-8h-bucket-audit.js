const MexcClient = require('../mexc-client');
const fs = require('fs');
const path = require('path');

const mexcClient = new MexcClient();

const symbols = [
  { symbol: 'ETHUSDT', name: 'Ethereum (ETH)', dec: 2 },
  { symbol: 'SOLUSDT', name: 'Solana (SOL)', dec: 2 },
  { symbol: 'GOLD(XAUT)USDT', name: 'Tether Gold (XAUT)', dec: 2 }
];

async function run37Day8hBucketAudit() {
  console.log("================================================================================");
  console.log("📊 37-DAY 1-CARD SEQUENTIAL AUDIT: UNDER 8 HOURS vs OVER 8 HOURS (ETH, SOL, GOLD)");
  console.log("================================================================================");

  const endTime = Date.now();
  const startTime = new Date('2026-07-01T00:00:00Z').getTime();

  let assetResults = {};

  for (const asset of symbols) {
    const sym = asset.symbol;
    console.log(`\n⏳ Fetching 37-Day 1m candles for ${asset.name} (${sym})...`);

    let allKlines = [];
    let currentStart = startTime;

    while (currentStart < endTime) {
      try {
        const nextEnd = Math.min(endTime, currentStart + (1000 * 60 * 1000));
        const klines = await mexcClient.getKlines(sym, '1m', 1000, currentStart, nextEnd);
        if (!Array.isArray(klines) || klines.length === 0) {
          currentStart += (1000 * 60 * 1000);
          continue;
        }
        allKlines = allKlines.concat(klines);
        const lastTime = klines[klines.length - 1][0];
        currentStart = lastTime + 60000;
        await new Promise(r => setTimeout(r, 40));
      } catch (e) {
        currentStart += (1000 * 60 * 1000);
      }
    }

    console.log(`   Fetched ${allKlines.length} candles for ${sym}.`);

    let cardState = 'SCANNING';
    let completedTrades = [];
    let currentTrade = null;

    for (let i = 0; i < allKlines.length; i++) {
      const candle = allKlines[i];
      const timeMs = candle[0];
      const open = parseFloat(candle[1]);
      const high = parseFloat(candle[2]);
      const low = parseFloat(candle[3]);
      const close = parseFloat(candle[4]);

      if (cardState === 'SCANNING') {
        const delta = close - open;
        const range = high - low;
        const bodyPct = range > 0 ? (Math.abs(delta) / range) : 0.5;
        let baseObi = 50.0;
        if (delta > 0) baseObi = 58.0 + (bodyPct * 34.0);
        else baseObi = 42.0 - (bodyPct * 22.0);
        const minFloor = Math.max(35.0, baseObi * 0.88);

        if (baseObi >= 70.0 && minFloor >= 55.0) {
          const buyPrice = close;
          const tpPrice = buyPrice * 1.006;
          currentTrade = {
            tradeNo: completedTrades.length + 1,
            entryTimeMs: timeMs,
            entryTimeStr: new Date(timeMs).toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
            buyPrice,
            tpPrice: parseFloat(tpPrice.toFixed(asset.dec)),
            obiPct: parseFloat(baseObi.toFixed(1)),
            minFloorPct: parseFloat(minFloor.toFixed(1)),
            status: 'PENDING_TP'
          };
          cardState = 'HOLDING';
        }
      } else if (cardState === 'HOLDING' && currentTrade) {
        if (high >= currentTrade.tpPrice) {
          const exitTimeMs = timeMs;
          const durationMins = Math.round((exitTimeMs - currentTrade.entryTimeMs) / 60000);
          currentTrade.exitTimeMs = exitTimeMs;
          currentTrade.exitTimeStr = new Date(exitTimeMs).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
          currentTrade.durationMins = durationMins;
          currentTrade.status = 'TP_HIT';

          completedTrades.push(currentTrade);
          currentTrade = null;
          cardState = 'SCANNING';
        }
      }
    }

    if (currentTrade) {
      completedTrades.push(currentTrade);
    }

    const wins = completedTrades.filter(t => t.status === 'TP_HIT');
    const pending = completedTrades.filter(t => t.status === 'PENDING_TP');

    let under8h = 0;
    let over8h = 0;

    wins.forEach(w => {
      if (w.durationMins <= 480) { // 480 mins = 8 hours
        under8h++;
      } else {
        over8h++;
      }
    });

    assetResults[sym] = {
      asset,
      totalTrades: completedTrades.length,
      winsCount: wins.length,
      pendingCount: pending.length,
      under8h,
      over8h,
      trades: completedTrades
    };

    console.log(`   ${asset.name}: Wins Total = ${wins.length} | Under 8h = ${under8h} | Over 8h = ${over8h} | Pending = ${pending.length}`);
  }

  let grandWins = 0, grandUnder8h = 0, grandOver8h = 0, grandPending = 0, grandTotal = 0;
  Object.values(assetResults).forEach(res => {
    grandTotal += res.totalTrades;
    grandWins += res.winsCount;
    grandUnder8h += res.under8h;
    grandOver8h += res.over8h;
    grandPending += res.pendingCount;
  });

  console.log("\n================================================================================");
  console.log(`🏆 8-HOUR DURATION BREAKDOWN GRAND TOTAL (ETH, SOL, GOLD):`);
  console.log(`- Grand Total Trades: ${grandTotal}`);
  console.log(`- Total TP Wins: ${grandWins}`);
  console.log(`- Wins Under 8 Hours: ${grandUnder8h} (${((grandUnder8h / grandWins) * 100).toFixed(1)}%)`);
  console.log(`- Wins Over 8 Hours: ${grandOver8h} (${((grandOver8h / grandWins) * 100).toFixed(1)}%)`);
  console.log(`- Currently Pending: ${grandPending}`);
  console.log("================================================================================");

  let markdown = `# 📊 37-Day 1-Card Execution Audit: Under 8 Hours vs Over 8 Hours TP Hits

**Audit Scope**: 37 Days (July 1, 2026 to August 6, 2026 UTC)  
**Target Assets**: \`ETHUSDT\`, \`SOLUSDT\`, \`GOLD (XAUTUSDT)\`  
**Execution Model**: 1 Single Card Real Live Sequential Lifecycle (1 Active Trade at a time)  

---

## 🏆 8-Hour Fill Time Grand Summary Table

| Asset | Total TP Wins | Hits Under 8 Hours (<= 8h) | Hits Over 8 Hours (> 8h) | % Under 8 Hours | Currently Pending |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 🪙 **Ethereum (ETH)** | **${assetResults['ETHUSDT'].winsCount}** | **${assetResults['ETHUSDT'].under8h} Trades** | **${assetResults['ETHUSDT'].over8h} Trades** | **${((assetResults['ETHUSDT'].under8h / assetResults['ETHUSDT'].winsCount) * 100).toFixed(1)}%** | **${assetResults['ETHUSDT'].pendingCount} Trade** |
| 🪙 **Solana (SOL)** | **${assetResults['SOLUSDT'].winsCount}** | **${assetResults['SOLUSDT'].under8h} Trades** | **${assetResults['SOLUSDT'].over8h} Trades** | **${((assetResults['SOLUSDT'].under8h / assetResults['SOLUSDT'].winsCount) * 100).toFixed(1)}%** | **${assetResults['SOLUSDT'].pendingCount} Trade** |
| 🥇 **Gold (XAUT)** | **${assetResults['GOLD(XAUT)USDT'].winsCount}** | **${assetResults['GOLD(XAUT)USDT'].under8h} Trades** | **${assetResults['GOLD(XAUT)USDT'].over8h} Trades** | **${((assetResults['GOLD(XAUT)USDT'].under8h / assetResults['GOLD(XAUT)USDT'].winsCount) * 100).toFixed(1)}%** | **${assetResults['GOLD(XAUT)USDT'].pendingCount} Trade** |
| 🔥 **GRAND TOTAL** | **${grandWins}** | **${grandUnder8h} Trades** | **${grandOver8h} Trades** | **${((grandUnder8h / grandWins) * 100).toFixed(1)}%** | **${grandPending} Trades** |

---

## 📅 Detailed Trade Duration Breakdown per Asset

`;

  for (const asset of symbols) {
    const res = assetResults[asset.symbol];
    markdown += `### 🪙 ${asset.name} (Under 8h: ${res.under8h} | Over 8h: ${res.over8h})\n\n`;
    markdown += `| Trade # | Entry Timestamp (UTC) | Buy Price | TP Target | Fill Duration | 8-Hour Bucket Status |\n`;
    markdown += `| :-: | :--- | :--- | :--- | :--- | :--- |\n`;
    res.trades.forEach(t => {
      if (t.status === 'TP_HIT') {
        const isUnder8 = t.durationMins <= 480;
        const bucketTag = isUnder8 ? `⚡ UNDER 8 HOURS (${(t.durationMins / 60).toFixed(1)}h)` : `⏳ OVER 8 HOURS (${(t.durationMins / 60).toFixed(1)}h)`;
        markdown += `| **Trade #${t.tradeNo}** | \`${t.entryTimeStr}\` | **$${t.buyPrice.toFixed(asset.dec)}** | **$${t.tpPrice}** | **${t.durationMins} Mins** | ${bucketTag} |\n`;
      } else {
        markdown += `| **Trade #${t.tradeNo}** | \`${t.entryTimeStr}\` | **$${t.buyPrice.toFixed(asset.dec)}** | **$${t.tpPrice}** | *Active...* | ⏳ PENDING SAFE HOLD |\n`;
      }
    });
    markdown += `\n`;
  }

  const artifactPath = 'C:\\Users\\Hi\\.gemini\\antigravity\\brain\\cdfb16e8-d8e7-4868-967f-4d9834b72016\\three_assets_37day_8h_bucket_audit_report.md';
  fs.writeFileSync(artifactPath, markdown);
  console.log(`\n✅ Artifact written to: ${artifactPath}`);
}

run37Day8hBucketAudit().catch(console.error);
