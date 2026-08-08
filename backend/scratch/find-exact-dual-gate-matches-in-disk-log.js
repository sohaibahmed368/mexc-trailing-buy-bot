const fs = require('fs');
const path = require('path');

function findExactMatchesFast() {
  const auditLogPath = path.join(__dirname, '../data/scanner_audit.log');
  const jsonLogsPath = path.join(__dirname, '../data/logs.json');

  console.log("================================================================================");
  console.log("🔍 AUDIT FILE SEARCH: ALL EXACT RAW LOG LINES WHERE OBI ≥ 55.0% AND RSI ≤ 40.0");
  console.log("================================================================================");

  const exactMatches = [];

  // Read newest 10,000 lines from scanner_audit.log
  if (fs.existsSync(auditLogPath)) {
    try {
      const content = fs.readFileSync(auditLogPath, 'utf8');
      const lines = content.split('\n');
      const recentLines = lines.slice(-10000);

      recentLines.forEach((line, idx) => {
        if (!line.includes('OBI') || !line.includes('RSI')) return;

        const obiMatch = line.match(/OBI[:\s]+([0-9]+\.[0-9]+)%/i) || line.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)/i);
        const rsiMatch = line.match(/RSI[:\s]+([0-9]+\.[0-9]+)/i);
        const priceMatch = line.match(/\$([0-9]+\.[0-9]+)/);
        const symMatch = line.match(/\[([A-Z0-9]+USDT)\]/);
        const timeMatch = line.match(/"timestamp":"([^"]+)"/) || line.match(/"time":"([^"]+)"/);

        if (obiMatch && rsiMatch) {
          const obi = parseFloat(obiMatch[1]);
          const rsi = parseFloat(rsiMatch[1]);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;
          const symbol = symMatch ? symMatch[1] : 'COIN';
          const timestamp = timeMatch ? timeMatch[1] : new Date().toISOString();

          // EXACT MATCH: OBI >= 55.0% AND RSI <= 40.0
          if (obi >= 55.0 && rsi <= 40.0) {
            exactMatches.push({ symbol, timestamp, price, obi, rsi, rawLog: line.trim() });
          }
        }
      });
    } catch (e) {}
  }

  // Also parse logs.json
  if (fs.existsSync(jsonLogsPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(jsonLogsPath, 'utf8'));
      logs.forEach(l => {
        const msg = l.message || '';
        const symbol = l.symbol || 'COIN';
        const timestamp = l.timestamp || new Date().toISOString();

        if (msg.includes('OBI') && msg.includes('RSI')) {
          const obiMatch = msg.match(/OBI[:\s]+([0-9]+\.[0-9]+)%/i) || msg.match(/Avg OBI[:\s=]+([0-9]+\.[0-9]+)/i);
          const rsiMatch = msg.match(/RSI[:\s]+([0-9]+\.[0-9]+)/i);
          const priceMatch = msg.match(/\$([0-9]+\.[0-9]+)/);

          if (obiMatch && rsiMatch) {
            const obi = parseFloat(obiMatch[1]);
            const rsi = parseFloat(rsiMatch[1]);
            const price = priceMatch ? parseFloat(priceMatch[1]) : null;

            if (obi >= 55.0 && rsi <= 40.0) {
              const exists = exactMatches.some(m => m.symbol === symbol && Math.abs(new Date(m.timestamp) - new Date(timestamp)) < 2000);
              if (!exists) {
                exactMatches.push({ symbol, timestamp, price, obi, rsi, rawLog: msg });
              }
            }
          }
        }
      });
    } catch (e) {}
  }

  console.log(`📊 Found ${exactMatches.length} Total Matches for (OBI ≥ 55.0% AND RSI ≤ 40.0)\n`);

  // Group unique occurrences by 1-minute window
  const uniqueMap = {};
  exactMatches.forEach(m => {
    const timeKey = `${m.symbol}_${new Date(m.timestamp).toISOString().substring(0, 16)}`;
    if (!uniqueMap[timeKey]) {
      uniqueMap[timeKey] = m;
    }
  });

  const uniquePoints = Object.values(uniqueMap);
  console.log(`🎯 Unique Dual Gate Trigger Signal Points (${uniquePoints.length} Points):\n`);

  uniquePoints.forEach((p, idx) => {
    const pktTime = new Date(new Date(p.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
    console.log(`📌 [EXACT DUAL GATE MATCH #${idx + 1}]`);
    console.log(`   🪙 Coin Symbol: ${p.symbol}`);
    console.log(`   ⏰ Timestamp (PKT): ${pktTime} (${new Date(p.timestamp).toUTCString()})`);
    console.log(`   💵 Price at Signal: ${p.price ? '$' + p.price.toFixed(4) + ' USDT' : 'N/A'}`);
    console.log(`   📊 OBI Index: ${p.obi.toFixed(1)}% (≥ 55.0% ✅)`);
    console.log(`   📉 4h 15m RSI: ${p.rsi.toFixed(1)} (≤ 40.0 ✅)`);
    console.log(`   📄 Raw Log Line: "${p.rawLog.substring(0, 180)}"`);
    console.log("--------------------------------------------------------------------------------");
  });
}

findExactMatchesFast();
