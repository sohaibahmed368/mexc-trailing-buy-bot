const fs = require('fs');
const path = require('path');

console.log('================================================================================');
console.log('🔍 FORENSIC AUDIT — PARSING ALL LIVE ENGINE LOGS FOR EXACT OBI & RSI VALUES');
console.log('================================================================================\n');

async function parseLogs() {
  const dirs = [
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..', '..', 'mexc-bot-deploy', 'backend')
  ];

  let logFiles = [];

  dirs.forEach(d => {
    if (fs.existsSync(d)) {
      const files = fs.readdirSync(d);
      files.forEach(f => {
        if (f.endsWith('.json') && f.includes('log')) {
          logFiles.push(path.join(d, f));
        }
      });
    }
  });

  console.log(`Scanning ${logFiles.length} log files...\n`);

  let logsWithObi = [];

  logFiles.forEach(file => {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(entry => {
          const msg = typeof entry === 'string' ? entry : (entry.message || JSON.stringify(entry));
          if (msg.includes('OBI') || msg.includes('Bids Support') || msg.includes('RSI') || msg.includes('Stop Loss') || msg.includes('Take Profit')) {
            logsWithObi.push(msg);
          }
        });
      }
    } catch (e) {}
  });

  console.log(`Found ${logsWithObi.length} relevant OBI & Indicator log entries:\n`);

  logsWithObi.slice(0, 30).forEach((l, idx) => {
    console.log(` ${idx + 1}. ${l.substring(0, 120)}...`);
  });
}

parseLogs().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
