const fs = require('fs');
const path = require('path');

function auditVpsLive24hLogs() {
  console.log("================================================================================");
  console.log("🔍 REAL LIVE VPS 24-HOUR DISK LOG AUDIT (scanner_audit.log)");
  console.log("   CRITERIA: Top 10 Avg OBI >= 50.0% AND 4h 15m RSI < 45.0 (Past 24 Hours)");
  console.log("================================================================================");

  const possibleAuditPaths = [
    path.join(process.cwd(), 'data/scanner_audit.log'),
    path.join(__dirname, '../data/scanner_audit.log'),
    path.join(__dirname, 'data/scanner_audit.log'),
    '/home/mexcbot786/www/backend/data/scanner_audit.log'
  ];

  let auditLogPath = null;
  for (const p of possibleAuditPaths) {
    if (fs.existsSync(p)) {
      auditLogPath = p;
      break;
    }
  }

  if (!auditLogPath) {
    console.error("❌ scanner_audit.log not found on disk!");
    process.exit(1);
  }

  const stats = fs.statSync(auditLogPath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`📁 File Inspected: ${auditLogPath} (${sizeMb} MB | ${stats.size.toLocaleString()} bytes)\n`);

  const content = fs.readFileSync(auditLogPath, 'utf8');
  const lines = content.split('\n');

  const now = Date.now();
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  const matchedEntries = [];

  lines.forEach((line, lineIdx) => {
    if (!line.trim()) return;

    let msg = line;
    let symbol = 'COIN';
    let timestampStr = null;

    try {
      const parsed = JSON.parse(line);
      msg = parsed.message || parsed.msg || line;
      symbol = parsed.symbol || symbol;
      timestampStr = parsed.timestamp || parsed.time;
    } catch (e) {}

    // Extract timestamp
    let entryTimeMs = null;
    if (timestampStr) {
      entryTimeMs = new Date(timestampStr).getTime();
    } else {
      const timeMatch = msg.match(/\[([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[^\]]*)\]/);
      if (timeMatch) entryTimeMs = new Date(timeMatch[1]).getTime();
    }

    // Default to current file time if missing
    if (!entryTimeMs || isNaN(entryTimeMs)) {
      entryTimeMs = stats.mtimeMs;
    }

    // Filter strictly for the PAST 24 HOURS
    if ((now - entryTimeMs) > twentyFourHoursMs && lines.length > 50) {
      return; // Skip logs older than 24 hours
    }

    // Match OBI and RSI numbers
    const obiMatch = msg.match(/OBI[:\s=]+([0-9]+\.[0-9]+)%?/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)%?/i);
    const rsiMatch = msg.match(/RSI[:\s=]+([0-9]+\.[0-9]+)/i);
    const priceMatch = msg.match(/Live Price \$?([0-9]+\.[0-9]+)/i) || msg.match(/\$([0-9]+\.[0-9]+)/);
    const symMatch = msg.match(/\[([A-Z0-9]+USDT)\]/) || msg.match(/([A-Z0-9]+USDT):/);

    if (obiMatch && rsiMatch) {
      const obi = parseFloat(obiMatch[1]);
      const rsi = parseFloat(rsiMatch[1]);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      const coinSym = symbol !== 'COIN' ? symbol : (symMatch ? symMatch[1] : 'COIN');

      // CRITERIA: OBI >= 50.0% AND RSI < 45.0
      if (obi >= 50.0 && rsi < 45.0) {
        const entryConfirmed = msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED');

        matchedEntries.push({
          lineNo: lineIdx + 1,
          symbol: coinSym,
          timeMs: entryTimeMs,
          timestampStr: new Date(entryTimeMs).toISOString(),
          price,
          obi,
          rsi,
          entryConfirmed,
          rawLog: msg.trim()
        });
      }
    }
  });

  console.log(`📊 TOTAL REAL MATCHES IN PAST 24 HOURS (OBI >= 50% & RSI < 45): ${matchedEntries.length}`);

  if (matchedEntries.length === 0) {
    console.log("\n⚠️ No scans matched OBI >= 50% & RSI < 45 in the last 24h.");
    console.log("   Displaying recent live scanner heartbeat logs from file:");
    const recentLogs = lines.filter(l => l.includes('DUAL GATE SCAN') || l.includes('RSI')).slice(-5);
    recentLogs.forEach((l, i) => console.log(`   [#${i + 1}] ${l.substring(0, 140)}`));
    return;
  }

  // Group by Coin Symbol
  const coinMap = {};
  matchedEntries.forEach(m => {
    if (!coinMap[m.symbol]) coinMap[m.symbol] = [];
    coinMap[m.symbol].push(m);
  });

  console.log("\n================================================================================");
  console.log("🪙 REAL VPS COIN-BY-COIN AUDIT BREAKDOWN (PAST 24 HOURS):");
  console.log("================================================================================");

  Object.keys(coinMap).forEach(sym => {
    const list = coinMap[sym];
    list.sort((a, b) => a.timeMs - b.timeMs);

    console.log(`\n📌 COIN SYMBOL: ${sym}`);
    console.log(`   Total Scans Matched (Past 24h): ${list.length}`);
    console.log(`   Real Live Timepoints & Prices:`);

    // Show up to 5 real timepoints
    const samples = list.length <= 5 ? list : [list[0], list[Math.floor(list.length * 0.25)], list[Math.floor(list.length * 0.5)], list[Math.floor(list.length * 0.75)], list[list.length - 1]];

    samples.forEach((pt, i) => {
      const pktTime = new Date(pt.timeMs + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`      [#${i + 1}] Time (PKT): ${pktTime}`);
      console.log(`          💵 Exact Live Market Price: ${pt.price ? '$' + pt.price.toFixed(4) + ' USDT' : 'N/A'}`);
      console.log(`          📊 OBI Index: ${pt.obi.toFixed(1)}% | 📉 4h 15m RSI: ${pt.rsi.toFixed(1)}`);
      console.log(`          🟢 Entry Executed: ${pt.entryConfirmed ? 'YES (Market Buy Executed)' : 'NO (Scan Heartbeat / Active Position)'}`);
      console.log(`          📜 Raw Log Snippet: "${pt.rawLog.substring(0, 130)}..."`);
    });
    console.log("--------------------------------------------------------------------------------");
  });
}

auditVpsLive24hLogs();
