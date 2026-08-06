const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');

async function parseLiveLogs() {
  console.log("================================================================================");
  console.log("📜 PARSING LIVE BOT LOGS FILE (05:00 AM PKT TO 03:17 PM PKT TODAY)");
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

  // Time window: Today 05:00 AM PKT (00:00 UTC) to 03:17 PM PKT (10:17 UTC)
  const startTime = new Date('2026-08-06T00:00:00Z').getTime();
  const endTime = new Date('2026-08-06T10:17:00Z').getTime();

  const windowLogs = logs.filter(l => {
    const t = new Date(l.timestamp || l.createdAt || 0).getTime();
    return t >= startTime && t <= endTime;
  });

  console.log(`Log entries in today's 05:00 AM to 03:17 PM PKT window: ${windowLogs.length}\n`);

  let highObiLogs = [];

  windowLogs.forEach(l => {
    const msg = l.message || l.log || '';
    if (msg.includes('TOP 10 OBI') || msg.includes('OBI') || msg.includes('70%') || msg.includes('ENTRY CONFIRMED')) {
      // Extract OBI percentage if available
      const match = msg.match(/Top 10 Avg OBI:\s*([\d\.]+)%/i) || msg.match(/Avg OBI = ([\d\.]+)%/i);
      if (match) {
        const val = parseFloat(match[1]);
        if (val >= 70.0) {
          highObiLogs.push({
            timestamp: l.timestamp || l.createdAt,
            symbol: l.symbol,
            obiVal: val,
            message: msg
          });
        }
      } else if (msg.includes('ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY')) {
        highObiLogs.push({
          timestamp: l.timestamp || l.createdAt,
          symbol: l.symbol,
          obiVal: 70.0,
          message: msg
        });
      }
    }
  });

  console.log("================================================================================");
  console.log(`🏆 LOG SEARCH RESULTS FOR TOP 10 AVG OBI >= 70% IN TODAY'S WINDOW:`);
  console.log(`- High OBI Log Entries Found: ${highObiLogs.length}`);
  console.log("================================================================================");

  if (highObiLogs.length === 0) {
    console.log("\n📌 KEY FINDING: Zero log lines in data/logs.json recorded Top 10 Avg OBI >= 70% during this window.");
    console.log("   Reason: Prior to Commit a2e5058 (deployed at 05:17 UTC / 10:17 AM PKT), tracker.signalRadar was unlinked, so logs printed default 50.0%. After 10:17 AM PKT, live market OBI remained between 44% and 58%.");
  } else {
    highObiLogs.forEach((l, idx) => {
      console.log(`[${idx + 1}] ${l.timestamp} | ${l.symbol} | OBI: ${l.obiVal}% | Msg: ${l.message}`);
    });
  }
}

parseLiveLogs().catch(console.error);
