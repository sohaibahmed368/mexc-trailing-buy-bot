const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');

async function parseRealLiveLogsAbove55() {
  console.log("================================================================================");
  console.log("📜 REAL LIVE LOGS AUDIT: AVG OBI >= 55% (06:00 AM PKT TO 05:36 PM PKT TODAY)");
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

  // Window: Today 06:00 AM PKT (01:00 UTC) to 05:36 PM PKT (12:36 UTC)
  const startTime = new Date('2026-08-06T01:00:00Z').getTime();
  const endTime = new Date('2026-08-06T12:36:00Z').getTime();

  let realLogsAbove55 = [];

  logs.forEach(l => {
    const t = new Date(l.timestamp || l.createdAt || 0).getTime();
    if (t >= startTime && t <= endTime) {
      const msg = l.message || l.log || '';

      // EXCLUDE TEST SCRIPT MOCK LOGS (hardcoded test values: 83.5%, 76.8%, test-eth-card-001)
      if (msg.includes('test-eth-card') || msg.includes('OKX: 76.8%') || msg.includes('Binance: 88.2%')) {
        return; // Ignore QA test script logs
      }

      // Check for real live heartbeat logs with Top 10 Avg OBI
      const match = msg.match(/Top 10 Avg OBI:\s*([\d\.]+)%/i) || msg.match(/Avg OBI = ([\d\.]+)%/i);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 55.0) {
          const pktTimeMs = t + (5 * 60 * 60 * 1000);
          const pktTimeStr = new Date(pktTimeMs).toISOString().replace('T', ' ').substring(11, 19) + ' PKT';
          const utcTimeStr = new Date(t).toISOString().replace('T', ' ').substring(11, 19) + ' UTC';

          realLogsAbove55.push({
            timestamp: l.timestamp || l.createdAt,
            pktTimeStr,
            utcTimeStr,
            symbol: l.symbol || 'N/A',
            obiVal: val,
            message: msg
          });
        }
      }
    }
  });

  console.log("================================================================================");
  console.log(`🏆 REAL LIVE LOGS RESULT (TOP 10 AVG OBI >= 55.0%):`);
  console.log(`- Total Real Live Logs Found: ${realLogsAbove55.length}`);
  console.log("================================================================================");

  if (realLogsAbove55.length === 0) {
    console.log("\n📌 RESULT: No REAL live log lines in data/logs.json recorded Top 10 Avg OBI >= 55% during this window.");
    console.log("   (Note: Server was restarted/running with standby logs or OBI remained below 55% during scanned heartbeats).");
  } else {
    realLogsAbove55.forEach((l, idx) => {
      console.log(`[${idx + 1}] PKT: ${l.pktTimeStr} (${l.utcTimeStr}) | ${l.symbol} | Avg OBI: ${l.obiVal}% | Log: ${l.message}`);
    });
  }

  let markdown = `# 📜 Real Live Bot Logs Audit (Top 10 Avg OBI >= 55.0% Today)

**Audit Window**: Today, August 6, 2026 (06:00 AM PKT / 01:00 UTC to 05:36 PM PKT / 12:36 UTC)  
**Filter Criteria**: Real Live Server Logs with **Top 10 Avg OBI $\\ge 55.0\\%$** (QA Test logs excluded)

---

## 🏆 Real Live Logs Table ($\ge 55.0\%$ Avg OBI)

| # | Pakistani Time (PKT) | UTC Time | Symbol | Live Top 10 Avg OBI (%) | Raw Log Message |
| :-: | :--- | :--- | :--- | :--- | :--- |
`;

  if (realLogsAbove55.length === 0) {
    markdown += `| - | *No real live logs >= 55% found in data/logs.json during this window* | - | - | - | - |\n`;
  } else {
    realLogsAbove55.forEach((l, idx) => {
      markdown += `| **${idx + 1}** | \`${l.pktTimeStr}\` | \`${l.utcTimeStr}\` | **${l.symbol}** | **${l.obiVal}%** | \`${l.message}\` |\n`;
    });
  }

  const artifactPath = 'C:\\Users\\Hi\\.gemini\\antigravity\\brain\\cdfb16e8-d8e7-4868-967f-4d9834b72016\\real_live_logs_above_55_report.md';
  fs.writeFileSync(artifactPath, markdown);
  console.log(`\n✅ Artifact written to: ${artifactPath}`);
}

parseRealLiveLogsAbove55().catch(console.error);
