const fs = require('fs');
const path = require('path');

function auditAllDiskLogsRsi45() {
  const auditLogPath = path.join(__dirname, '../data/scanner_audit.log');
  const jsonLogsPath = path.join(__dirname, '../data/logs.json');

  console.log("================================================================================");
  console.log("📂 FULL AUDIT OF SERVER DISK LOG FILES");
  console.log("   CRITERIA: Top 10 Avg OBI >= 55.0% AND 4h 15m RSI < 45.0");
  console.log("================================================================================");

  let auditLogSizeMb = 0;
  let jsonLogSizeMb = 0;

  if (fs.existsSync(auditLogPath)) {
    const stats = fs.statSync(auditLogPath);
    auditLogSizeMb = parseFloat((stats.size / (1024 * 1024)).toFixed(2));
    console.log(`📁 File 1: scanner_audit.log | Size: ${auditLogSizeMb} MB (${stats.size.toLocaleString()} bytes)`);
  } else {
    console.log(`📁 File 1: scanner_audit.log | NOT FOUND`);
  }

  if (fs.existsSync(jsonLogsPath)) {
    const stats = fs.statSync(jsonLogsPath);
    jsonLogSizeMb = parseFloat((stats.size / (1024 * 1024)).toFixed(2));
    console.log(`📁 File 2: logs.json | Size: ${jsonLogSizeMb} MB (${stats.size.toLocaleString()} bytes)`);
  } else {
    console.log(`📁 File 2: logs.json | NOT FOUND`);
  }

  console.log(`📦 TOTAL LOG FILES DISK SIZE: ${(auditLogSizeMb + jsonLogSizeMb).toFixed(2)} MB`);

  const matchedEntries = [];

  // 1. Parse scanner_audit.log
  if (fs.existsSync(auditLogPath)) {
    try {
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

        const obiMatch = msg.match(/OBI[:\s=]+([0-9]+\.[0-9]+)%?/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)%?/i);
        const rsiMatch = msg.match(/RSI[:\s=]+([0-9]+\.[0-9]+)/i);
        const priceMatch = msg.match(/\$([0-9]+\.[0-9]+)/);
        const symMatch = msg.match(/\[([A-Z0-9]+USDT)\]/);

        if (obiMatch && rsiMatch) {
          const obi = parseFloat(obiMatch[1]);
          const rsi = parseFloat(rsiMatch[1]);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;
          const coinSym = symbol !== 'COIN' ? symbol : (symMatch ? symMatch[1] : 'COIN');

          // STRICT CONDITION: OBI >= 55.0% AND RSI < 45.0
          if (obi >= 55.0 && rsi < 45.0) {
            const entryConfirmed = msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED');

            matchedEntries.push({
              source: 'scanner_audit.log',
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

  // 2. Parse logs.json
  if (fs.existsSync(jsonLogsPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(jsonLogsPath, 'utf8'));
      logs.forEach((l, index) => {
        const msg = l.message || '';
        const symbol = l.symbol || 'COIN';
        const timestamp = l.timestamp || new Date().toISOString();

        const obiMatch = msg.match(/OBI[:\s=]+([0-9]+\.[0-9]+)%?/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)%?/i);
        const rsiMatch = msg.match(/RSI[:\s=]+([0-9]+\.[0-9]+)/i);
        const priceMatch = msg.match(/\$([0-9]+\.[0-9]+)/);

        if (obiMatch && rsiMatch) {
          const obi = parseFloat(obiMatch[1]);
          const rsi = parseFloat(rsiMatch[1]);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;

          if (obi >= 55.0 && rsi < 45.0) {
            const entryConfirmed = msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED');
            const exists = matchedEntries.some(m => m.symbol === symbol && Math.abs(new Date(m.timestamp) - new Date(timestamp)) < 2000);
            if (!exists) {
              matchedEntries.push({
                source: 'logs.json',
                lineNo: index + 1,
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

  console.log(`\n📊 TOTAL LOG SCANS MATCHING (OBI >= 55.0% AND RSI < 45.0): ${matchedEntries.length}`);

  // Group entries by symbol
  const coinMap = {};
  matchedEntries.forEach(m => {
    if (!coinMap[m.symbol]) {
      coinMap[m.symbol] = [];
    }
    coinMap[m.symbol].push(m);
  });

  console.log("\n================================================================================");
  console.log("🪙 BREAKDOWN BY COIN (OBI >= 55.0% & RSI < 45.0):");
  console.log("================================================================================");

  Object.keys(coinMap).forEach(sym => {
    const list = coinMap[sym];
    console.log(`\n📌 COIN SYMBOL: ${sym}`);
    console.log(`   Total Matching Entries: ${list.length}`);
    
    // Sort chronologically
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    console.log(`   Sample Real Matches (Chronological):`);
    
    // Pick first, middle, and latest timepoints
    const sampleIndices = [0, Math.floor(list.length / 2), list.length - 1];
    const uniqueSamples = Array.from(new Set(sampleIndices)).map(idx => list[idx]);

    uniqueSamples.forEach((pt, i) => {
      const pktTime = new Date(new Date(pt.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`      [#${i + 1}] Time (PKT): ${pktTime}`);
      console.log(`          💵 Price at Signal: ${pt.price ? '$' + pt.price.toFixed(4) + ' USDT' : 'N/A'}`);
      console.log(`          📊 OBI Index: ${pt.obi.toFixed(1)}% | 📉 RSI: ${pt.rsi.toFixed(1)}`);
      console.log(`          🟢 Entry Taken: ${pt.entryConfirmed ? 'YES (Market Buy Executed)' : 'NO (Scan Heartbeat / Position Open)'}`);
      console.log(`          📜 Log Snippet: "${pt.rawLog.substring(0, 120)}..."`);
    });
    console.log("--------------------------------------------------------------------------------");
  });
}

auditAllDiskLogsRsi45();
