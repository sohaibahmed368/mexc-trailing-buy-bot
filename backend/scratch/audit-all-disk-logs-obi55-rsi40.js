const fs = require('fs');
const path = require('path');

function auditAllDiskLogs() {
  const auditLogPath = path.join(__dirname, '../data/scanner_audit.log');
  const jsonLogsPath = path.join(__dirname, '../data/logs.json');

  console.log("================================================================================");
  console.log("📂 FULL AUDIT OF DISK LOG FILES (scanner_audit.log & logs.json)");
  console.log("   CRITERIA: Top 10 Avg OBI > 55.0% AND 4h 15m RSI <= 40.0");
  console.log("================================================================================");

  const matchedEntries = [];

  // Parse scanner_audit.log
  if (fs.existsSync(auditLogPath)) {
    try {
      const stats = fs.statSync(auditLogPath);
      console.log(`📁 Inspection File: ${auditLogPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);

      const content = fs.readFileSync(auditLogPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, lineIdx) => {
        if (!line.includes('OBI') || !line.includes('RSI')) return;

        let msg = line;
        let symbol = 'COIN';
        let timestamp = new Date().toISOString();

        try {
          const parsed = JSON.parse(line);
          msg = parsed.message || parsed.msg || line;
          symbol = parsed.symbol || symbol;
          timestamp = parsed.timestamp || parsed.time || timestamp;
        } catch (e) {}

        const obiMatch = msg.match(/OBI[:\s]+([0-9]+\.[0-9]+)%/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)/i);
        const rsiMatch = msg.match(/RSI[:\s]+([0-9]+\.[0-9]+)/i);
        const priceMatch = msg.match(/\$([0-9]+\.[0-9]+)/);
        const symMatch = msg.match(/\[([A-Z0-9]+USDT)\]/);

        if (obiMatch && rsiMatch) {
          const obi = parseFloat(obiMatch[1]);
          const rsi = parseFloat(rsiMatch[1]);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;
          const coinSym = symbol !== 'COIN' ? symbol : (symMatch ? symMatch[1] : 'COIN');

          // STRICT CONDITION: OBI > 55.0% AND RSI <= 40.0
          if (obi > 55.0 && rsi <= 40.0) {
            const entryConfirmed = msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED');

            matchedEntries.push({
              lineNo: lineIdx + 1,
              symbol: coinSym,
              timestamp,
              price,
              obi,
              rsi,
              entryConfirmed,
              rawLog: msg.trim()
            });
          }
        }
      });
    } catch (err) {
      console.log(`Error reading scanner_audit.log: ${err.message}`);
    }
  }

  // Parse logs.json
  if (fs.existsSync(jsonLogsPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(jsonLogsPath, 'utf8'));
      logs.forEach((l, index) => {
        const msg = l.message || '';
        const symbol = l.symbol || 'COIN';
        const timestamp = l.timestamp || new Date().toISOString();

        const obiMatch = msg.match(/OBI[:\s]+([0-9]+\.[0-9]+)%/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)/i);
        const rsiMatch = msg.match(/RSI[:\s]+([0-9]+\.[0-9]+)/i);
        const priceMatch = msg.match(/\$([0-9]+\.[0-9]+)/);

        if (obiMatch && rsiMatch) {
          const obi = parseFloat(obiMatch[1]);
          const rsi = parseFloat(rsiMatch[1]);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;

          if (obi > 55.0 && rsi <= 40.0) {
            const entryConfirmed = msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED');
            const exists = matchedEntries.some(m => m.symbol === symbol && Math.abs(new Date(m.timestamp) - new Date(timestamp)) < 2000);
            if (!exists) {
              matchedEntries.push({
                lineNo: `logs.json #${index + 1}`,
                symbol,
                timestamp,
                price,
                obi,
                rsi,
                entryConfirmed,
                rawLog: msg
              });
            }
          }
        }
      });
    } catch (e) {}
  }

  console.log(`\n📊 Total Matched Log Lines Found: ${matchedEntries.length}`);

  // Group entries by unique coin symbol and timeframe
  const coinSummaryMap = {};
  matchedEntries.forEach(m => {
    if (!coinSummaryMap[m.symbol]) {
      coinSummaryMap[m.symbol] = {
        totalMatches: 0,
        buyExecutions: 0,
        recentPoints: []
      };
    }
    coinSummaryMap[m.symbol].totalMatches++;
    if (m.entryConfirmed) coinSummaryMap[m.symbol].buyExecutions++;

    // Keep unique 1-minute timepoints
    const timeKey = m.timestamp.substring(0, 16);
    if (!coinSummaryMap[m.symbol].recentPoints.some(p => p.timestamp.substring(0, 16) === timeKey)) {
      coinSummaryMap[m.symbol].recentPoints.push(m);
    }
  });

  console.log("\n================================================================================");
  console.log("🪙 COIN-BY-COIN BREAKDOWN OF DUAL GATE MATCHES IN DISK LOGS:");
  console.log("================================================================================");

  Object.keys(coinSummaryMap).forEach(sym => {
    const data = coinSummaryMap[sym];
    console.log(`\n📌 COIN SYMBOL: ${sym}`);
    console.log(`   Total Log Scans Matching (OBI > 55% & RSI <= 40): ${data.totalMatches}`);
    console.log(`   Confirmed Market Buy Executions: ${data.buyExecutions}`);
    console.log(`   Sample Real Signal Timepoints:`);

    data.recentPoints.slice(0, 5).forEach((pt, i) => {
      const pktTime = new Date(new Date(pt.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`      [#${i + 1}] Time (PKT): ${pktTime}`);
      console.log(`          💵 Price at Signal: ${pt.price ? '$' + pt.price.toFixed(4) + ' USDT' : 'N/A'}`);
      console.log(`          📊 OBI Index: ${pt.obi.toFixed(1)}% | 📉 4h 15m RSI: ${pt.rsi.toFixed(1)}`);
      console.log(`          🟢 Entry Taken: ${pt.entryConfirmed ? 'YES (Market Buy Executed & TP Placed!)' : 'NO (Scan Heartbeat / Holding Position)'}`);
      console.log(`          📜 Raw Log: "${pt.rawLog.substring(0, 140)}"`);
    });
    console.log("--------------------------------------------------------------------------------");
  });
}

auditAllDiskLogs();
