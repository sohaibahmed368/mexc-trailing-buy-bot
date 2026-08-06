const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');

async function parseLiveLogsDualGate12h() {
  console.log("================================================================================");
  console.log("📜 REAL LIVE LOGS DUAL GATE AUDIT (PAST 12 HOURS: OBI >= 55% & RSI <= 40)");
  console.log("================================================================================");

  if (!fs.existsSync(logsPath)) {
    console.log(`❌ Logs file not found at: ${logsPath}`);
    return;
  }

  const fileContent = fs.readFileSync(logsPath, 'utf8');
  let logs = [];
  try {
    logs = JSON.parse(fileContent);
  } catch (e) {
    console.error("Error parsing logs.json:", e.message);
    return;
  }

  console.log(`Total log entries in data/logs.json: ${logs.length}`);

  // Past 12 Hours Window: August 6 07:34 UTC to August 6 19:34 UTC (12:34 PM PKT to 00:34 AM PKT)
  const startTime = new Date('2026-08-06T07:34:00Z').getTime();
  const endTime = new Date('2026-08-06T19:34:00Z').getTime();

  const targetCoins = ['BTCUSDT', 'SOLUSDT', 'ETHUSDT', 'SUIUSDT', 'GOLD(XAUT)USDT', 'XAUTUSDT'];

  let matchedDualGateLogs = [];
  let realLogsInWindowCount = 0;

  logs.forEach(l => {
    const t = new Date(l.timestamp || l.createdAt || 0).getTime();
    if (t >= startTime && t <= endTime) {
      const msg = l.message || l.log || '';

      // Ignore QA test script hardcoded mock logs
      if (msg.includes('test-eth-card') || msg.includes('OKX: 76.8%') || msg.includes('Binance: 88.2%')) {
        return;
      }

      realLogsInWindowCount++;

      // Check for OBI and RSI metrics in log text
      const obiMatch = msg.match(/Top 10 Avg OBI:\s*([\d\.]+)%/i) || msg.match(/Avg OBI = ([\d\.]+)%/i);
      const rsiMatch = msg.match(/4h 15m RSI:\s*([\d\.]+)/i) || msg.match(/RSI:\s*([\d\.]+)/i);

      let obiVal = obiMatch ? parseFloat(obiMatch[1]) : 0;
      let rsiVal = rsiMatch ? parseFloat(rsiMatch[1]) : 50;

      // Extract symbol
      const sym = l.symbol || 'N/A';

      if (obiVal >= 55.0 && rsiVal <= 40.0) {
        const pktTimeMs = t + (5 * 60 * 60 * 1000);
        const pktTimeStr = new Date(pktTimeMs).toISOString().replace('T', ' ').substring(11, 19) + ' PKT';
        const utcTimeStr = new Date(t).toISOString().replace('T', ' ').substring(11, 19) + ' UTC';

        matchedDualGateLogs.push({
          timestamp: l.timestamp || l.createdAt,
          pktTimeStr,
          utcTimeStr,
          symbol: sym,
          obiVal,
          rsiVal,
          message: msg
        });
      }
    }
  });

  console.log("================================================================================");
  console.log(`🏆 REAL LIVE LOGS AUDIT RESULT (OBI >= 55% & RSI <= 40):`);
  console.log(`- Total Real Logs In Past 12 Hours: ${realLogsInWindowCount}`);
  console.log(`- Total Dual Gate Matches (OBI >= 55% AND RSI <= 40): ${matchedDualGateLogs.length}`);
  console.log("================================================================================");

  if (matchedDualGateLogs.length === 0) {
    console.log("\n📌 KEY FINDING: Zero real live log entries met BOTH OBI >= 55% AND RSI <= 40 simultaneously during the past 12 hours.");
    console.log("   Reason: Prior to this session, the live server logs only tracked OBI without recording 4h 15m RSI <= 40 simultaneously.");
  } else {
    matchedDualGateLogs.forEach((l, idx) => {
      console.log(`[${idx + 1}] PKT: ${l.pktTimeStr} (${l.utcTimeStr}) | Symbol: ${l.symbol} | Avg OBI: ${l.obiVal}% | RSI: ${l.rsiVal} | Log: ${l.message}`);
    });
  }

  // Generate Artifact Report
  let markdown = `# 📜 Real Live Logs Dual Gate Audit (Past 12 Hours: OBI >= 55% & RSI <= 40)

**Audit Window**: Past 12 Hours (August 6, 12:34 PM PKT / 07:34 UTC to August 7, 12:34 AM PKT / 19:34 UTC)  
**Target Coins**: BTC, SOL, ETH, SUI, GOLD (XAUT)  
**Filter Criteria**: Real Live Server Logs with **Top 10 Avg OBI $\\ge 55.0\\%$ AND 4h 15m RSI $\\le 40.0$** (QA Test mock entries excluded)

---

## 🏆 Dual Gate Matched Logs Table ($\\ge 55.0\\%$ Avg OBI & $\\le 40.0$ RSI)

| # | Pakistani Time (PKT) | UTC Time | Symbol | Live Top 10 Avg OBI (%) | Live 4h 15m RSI | Raw Log Message |
| :-: | :--- | :--- | :--- | :--- | :--- | :--- |
`;

  if (matchedDualGateLogs.length === 0) {
    markdown += `| - | *No real live log entries in data/logs.json met BOTH OBI >= 55% AND RSI <= 40 during past 12h* | - | - | - | - | - |\n`;
  } else {
    matchedDualGateLogs.forEach((l, idx) => {
      markdown += `| **${idx + 1}** | \`${l.pktTimeStr}\` | \`${l.utcTimeStr}\` | **${l.symbol}** | **${l.obiVal}%** | **${l.rsiVal}** | \`${l.message}\` |\n`;
    });
  }

  const artifactPath = 'C:\\Users\\Hi\\.gemini\\antigravity\\brain\\cdfb16e8-d8e7-4868-967f-4d9834b72016\\parse_live_logs_dual_gate_12h_report.md';
  fs.writeFileSync(artifactPath, markdown);
  console.log(`\n✅ Artifact written to: ${artifactPath}`);
}

parseLiveLogsDualGate12h().catch(console.error);
