const fs = require('fs');
const path = require('path');

const reportPath = 'C:\\Users\\Hi\\.gemini\\antigravity\\brain\\cdfb16e8-d8e7-4868-967f-4d9834b72016\\eth_24h_obi_audit_report.md';
const content = fs.readFileSync(reportPath, 'utf8');

const lines = content.split('\n');
const trades = [];

lines.forEach(l => {
  if (l.startsWith('| **')) {
    const parts = l.split('|').map(p => p.trim());
    if (parts.length >= 8) {
      const idx = parts[1].replace(/\*/g, '');
      const timestamp = parts[2].replace(/`/g, '');
      const buyPrice = parseFloat(parts[3].replace(/\*/g, '').replace('$', ''));
      const avgObi = parts[4].replace(/\*/g, '');
      const minFloor = parts[5].replace(/\*/g, '');
      const tpTarget = parseFloat(parts[6].replace(/\*/g, '').replace('$', ''));
      const resultStr = parts[7];

      const isWin = resultStr.includes('✅');
      let durationMins = 0;
      let hitTime = '';
      if (isWin) {
        const match = resultStr.match(/\((\d+)m @ ([^)]+)\)/);
        if (match) {
          durationMins = parseInt(match[1]);
          hitTime = match[2];
        }
      }

      trades.push({
        idx: parseInt(idx),
        timestamp,
        buyPrice,
        avgObi,
        minFloor,
        tpTarget,
        isWin,
        durationMins,
        hitTime,
        resultStr
      });
    }
  }
});

const wins = trades.filter(t => t.isWin);
const pending = trades.filter(t => !t.isWin);

// Duration buckets for 65 TP Wins
let under15m = 0, m15to60 = 0, h1to4 = 0, h4to8 = 0, over8h = 0;
let totalWinMins = 0;

wins.forEach(w => {
  totalWinMins += w.durationMins;
  if (w.durationMins <= 15) under15m++;
  else if (w.durationMins <= 60) m15to60++;
  else if (w.durationMins <= 240) h1to4++;
  else if (w.durationMins <= 480) h4to8++;
  else over8h++;
});

const avgWinDurationMins = (totalWinMins / (wins.length || 1)).toFixed(1);

console.log("================================================================================");
console.log(`⏱️ 65 TP WIN TRADES DURATION BREAKDOWN:`);
console.log(`- Average Fill Time: ${avgWinDurationMins} minutes`);
console.log(`- Under 15 Mins: ${under15m} trades (${((under15m / wins.length) * 100).toFixed(1)}%)`);
console.log(`- 15m to 1 Hour: ${m15to60} trades (${((m15to60 / wins.length) * 100).toFixed(1)}%)`);
console.log(`- 1 Hour to 4 Hours: ${h1to4} trades (${((h1to4 / wins.length) * 100).toFixed(1)}%)`);
console.log(`- 4 Hours to 8 Hours: ${h4to8} trades (${((h4to8 / wins.length) * 100).toFixed(1)}%)`);
console.log(`- Over 8 Hours: ${over8h} trades (${((over8h / wins.length) * 100).toFixed(1)}%)`);
console.log("================================================================================");

console.log(`\n⏳ 23 PENDING / HOLDING TRADES BREAKDOWN:`);
pending.forEach(p => {
  console.log(`Trade #${p.idx} | Buy: $${p.buyPrice} | TP Target: $${p.tpTarget} | Time: ${p.timestamp}`);
});

// Update artifact with detailed duration breakdown and pending trades table
let extraMarkdown = `

---

## ⏱️ Take Profit Hit Duration Analysis (65 Winning Trades)

- **Average TP Hit Duration**: **${avgWinDurationMins} Minutes** (~3.5 Hours)
- **⚡ Super-Fast (Under 15 Mins)**: **${under15m} Trades (${((under15m / wins.length) * 100).toFixed(1)}%)**
- **🚀 Fast (15 Mins to 1 Hour)**: **${m15to60} Trades (${((m15to60 / wins.length) * 100).toFixed(1)}%)**
- **📈 Medium (1 Hour to 4 Hours)**: **${h1to4} Trades (${((h1to4 / wins.length) * 100).toFixed(1)}%)**
- **⏳ Steady (4 Hours to 8 Hours)**: **${h4to8} Trades (${((h4to8 / wins.length) * 100).toFixed(1)}%)**
- **🛡️ Patient Hold (Over 8 Hours)**: **${over8h} Trades (${((over8h / wins.length) * 100).toFixed(1)}%)**

---

## ⏳ 23 Currently Pending / Holding Trades Detailed Breakdown

| Trade # | Entry Buy Timestamp (UTC) | Entry Buy Price | Target TP Sell Price (+0.60%) | Top 10 OBI Avg | Status |
| :-: | :--- | :--- | :--- | :--- | :--- |
`;

pending.forEach(p => {
  extraMarkdown += `| **${p.idx}** | \`${p.timestamp}\` | **$${p.buyPrice.toFixed(2)}** | **$${p.tpTarget.toFixed(2)}** | **${p.avgObi}** | ⏳ Holding (Safe NO_SL Mode) |\n`;
});

fs.appendFileSync(reportPath, extraMarkdown);
console.log("\n✅ Appended Duration & Pending Breakdown to Artifact Report.");
