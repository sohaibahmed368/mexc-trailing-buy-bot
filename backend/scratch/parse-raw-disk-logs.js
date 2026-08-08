const fs = require('fs');
const path = require('path');

function parseRawDiskLogs() {
  const auditLogPath = path.join(__dirname, '../data/scanner_audit.log');
  const jsonLogsPath = path.join(__dirname, '../data/logs.json');

  console.log("================================================================================");
  console.log("📂 REAL DISK LOGS AUDIT: READING DIRECTLY FROM backend/data/scanner_audit.log");
  console.log("================================================================================");

  let rawLinesCount = 0;
  const realConfirmedBuys = [];
  const realScans = [];

  if (fs.existsSync(auditLogPath)) {
    try {
      const stats = fs.statSync(auditLogPath);
      console.log(`📁 File Path: ${auditLogPath}`);
      console.log(`📁 File Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

      const content = fs.readFileSync(auditLogPath, 'utf8');
      const lines = content.split('\n');
      rawLinesCount = lines.length;

      lines.forEach((line, idx) => {
        if (!line.trim()) return;

        // Parse JSON log lines
        try {
          const entry = JSON.parse(line);
          const msg = entry.message || entry.msg || '';
          const symbol = entry.symbol || 'N/A';
          const timestamp = entry.timestamp || entry.time || new Date().toISOString();

          if (msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED')) {
            realConfirmedBuys.push({ symbol, timestamp, type: 'BUY_EXECUTED', msg });
          } else if (msg.includes('DUAL GATE SCAN') || msg.includes('DUAL GATE')) {
            realScans.push({ symbol, timestamp, type: 'SCAN', msg });
          }
        } catch (e) {
          // Plain text line
          if (line.includes('DUAL GATE ENTRY CONFIRMED') || line.includes('EXECUTING MARKET BUY')) {
            realConfirmedBuys.push({ symbol: 'RAW', timestamp: new Date().toISOString(), type: 'BUY_EXECUTED', msg: line });
          } else if (line.includes('DUAL GATE SCAN')) {
            realScans.push({ symbol: 'RAW', timestamp: new Date().toISOString(), type: 'SCAN', msg: line });
          }
        }
      });
    } catch (err) {
      console.log(`Error reading audit log: ${err.message}`);
    }
  } else {
    console.log(`❌ Audit log file not found at ${auditLogPath}`);
  }

  // Also check logs.json
  if (fs.existsSync(jsonLogsPath)) {
    try {
      const logs = JSON.parse(fs.readFileSync(jsonLogsPath, 'utf8'));
      logs.forEach(l => {
        const msg = l.message || '';
        const symbol = l.symbol || 'N/A';
        const timestamp = l.timestamp || new Date().toISOString();
        if (msg.includes('DUAL GATE ENTRY CONFIRMED') || msg.includes('EXECUTING MARKET BUY') || msg.includes('MARKET BUY FILLED')) {
          realConfirmedBuys.push({ symbol, timestamp, type: 'BUY_EXECUTED', msg });
        } else if (msg.includes('DUAL GATE SCAN')) {
          realScans.push({ symbol, timestamp, type: 'SCAN', msg });
        }
      });
    } catch (e) {}
  }

  console.log(`\n📊 Total Raw Log Lines Processed: ${rawLinesCount}`);
  console.log(`🟢 Real Dual Gate Confirmed Buys Found: ${realConfirmedBuys.length}`);
  console.log(`⚡ Real Dual Gate Scans Found: ${realScans.length}\n`);

  if (realConfirmedBuys.length > 0) {
    console.log("================================================================================");
    console.log("🟢 ACTUAL REAL LIVE EXECUTED BUYS IN DISK LOGS:");
    console.log("================================================================================");
    realConfirmedBuys.slice(0, 15).forEach((b, i) => {
      const pktTime = new Date(new Date(b.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`[#${i+1}] ${b.symbol} | PKT Time: ${pktTime} | Msg: "${b.msg}"`);
    });
  }

  if (realScans.length > 0) {
    console.log("\n================================================================================");
    console.log("⚡ RECENT LIVE DUAL GATE SCANS IN DISK LOGS (Scanning Phase):");
    console.log("================================================================================");
    // Unique latest scans
    const recentScansMap = {};
    realScans.forEach(s => {
      recentScansMap[s.symbol] = s;
    });

    Object.keys(recentScansMap).forEach((sym, i) => {
      const s = recentScansMap[sym];
      const pktTime = new Date(new Date(s.timestamp).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
      console.log(`[#${i+1}] ${sym} | PKT Time: ${pktTime}`);
      console.log(`     Raw Log Line: "${s.msg}"`);
    });
  }
}

parseRawDiskLogs();
