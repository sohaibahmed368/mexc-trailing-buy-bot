const fs = require('fs');
const path = require('path');

function parseExactStoredLiveLogs() {
  console.log('🔍 EXHAUSTIVE PARSING OF ALL STORED LIVE LOG FILES IN SYSTEM...\n');

  const stockSymbols = [
    'NVDAON', 'NVDA',
    'TSLAON', 'TSLA',
    'AAPLON', 'AAPL',
    'AMZNON', 'AMZN',
    'GOOGLON', 'GOOGL',
    'INTUON', 'INTU',
    'QBTS',
    'SMCION', 'SMCI',
    'SBCXON', 'SBCX',
    'SPCXON'
  ];

  const logFilesToScan = [
    './backend/stock-logs.json',
    './backend/logs.json',
    './backend/data/logs.json',
    './backend/data/stock_logs.json',
    './backend/test-master-stock-logs.json',
    './backend/test-ult-stock-logs.json',
    './backend/test-reg-stock-logs.json',
    './backend/scratch/tmp-sc2-logs.json',
    './backend/scratch/test-deep-stock-logs.json'
  ];

  // Also include system task log files
  const taskDir = 'C:/Users/Hi/.gemini/antigravity/brain/cdfb16e8-d8e7-4868-967f-4d9834b72016/.system_generated/tasks';
  if (fs.existsSync(taskDir)) {
    const files = fs.readdirSync(taskDir).filter(f => f.endsWith('.log'));
    files.forEach(f => logFilesToScan.push(path.join(taskDir, f)));
  }

  const results = {};
  stockSymbols.forEach(sym => {
    results[sym] = {
      symbol: sym,
      logHitsCount: 0,
      obiEntries: [],
      rsiEntries: [],
      minObi: 100,
      maxObi: 0,
      minRsi: 100,
      maxRsi: 0,
      sampleLogs: []
    };
  });

  let totalFilesScanned = 0;
  let totalLinesScanned = 0;

  for (const filePath of logFilesToScan) {
    if (!fs.existsSync(filePath)) continue;
    totalFilesScanned++;

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (!content) continue;

      let entries = [];
      if (filePath.endsWith('.json')) {
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            entries = parsed.map(item => (typeof item === 'string' ? item : JSON.stringify(item)));
          }
        } catch (e) {
          entries = content.split('\n');
        }
      } else {
        entries = content.split('\n');
      }

      totalLinesScanned += entries.length;

      for (const line of entries) {
        if (!line || typeof line !== 'string') continue;
        const upperLine = line.toUpperCase();

        for (const sym of stockSymbols) {
          if (upperLine.includes(sym)) {
            const res = results[sym];
            res.logHitsCount++;

            if (res.sampleLogs.length < 3) {
              res.sampleLogs.push(line.substring(0, 140));
            }

            // RegEx for OBI: "OBI: 52.5%", "OBI = 48.0%", "bidsRatio: 55%", "OBI 45.0%"
            const obiMatch = line.match(/(?:OBI|bidsRatio|Top 10 Avg OBI)[:\s=]+([\d.]+)/i);
            if (obiMatch) {
              const val = parseFloat(obiMatch[1]);
              if (val >= 0 && val <= 100) {
                res.obiEntries.push(val);
                if (val < res.minObi) res.minObi = val;
                if (val > res.maxObi) res.maxObi = val;
              }
            }

            // RegEx for RSI: "RSI: 44.5", "RSI = 48.2", "4h 15m RSI: 42.0"
            const rsiMatch = line.match(/(?:RSI|4h 15m RSI)[:\s=]+([\d.]+)/i);
            if (rsiMatch) {
              const val = parseFloat(rsiMatch[1]);
              if (val >= 0 && val <= 100) {
                res.rsiEntries.push(val);
                if (val < res.minRsi) res.minRsi = val;
                if (val > res.maxRsi) res.maxRsi = val;
              }
            }
          }
        }
      }
    } catch (err) {
      console.log(`Error reading ${filePath}: ${err.message}`);
    }
  }

  console.log('========================================================================');
  console.log(`📊 STORED LIVE LOGS DIRECT EMPIRICAL PARSE REPORT`);
  console.log(`Scanned Files: ${totalFilesScanned} | Total Lines Scanned: ${totalLinesScanned}`);
  console.log('========================================================================\n');

  stockSymbols.forEach(sym => {
    const res = results[sym];
    if (res.logHitsCount > 0 || res.obiEntries.length > 0 || res.rsiEntries.length > 0) {
      const avgObi = res.obiEntries.length > 0 ? (res.obiEntries.reduce((a, b) => a + b, 0) / res.obiEntries.length).toFixed(1) : 'N/A';
      const avgRsi = res.rsiEntries.length > 0 ? (res.rsiEntries.reduce((a, b) => a + b, 0) / res.rsiEntries.length).toFixed(1) : 'N/A';

      console.log(`📌 [${sym}] Stored Live Log Parse Results:`);
      console.log(`   - Log Mentions in System: ${res.logHitsCount}`);
      console.log(`   - Minimum OBI Touched in Live Logs: ${res.minObi === 100 ? 'N/A' : res.minObi.toFixed(1) + '%'}`);
      console.log(`   - Maximum OBI Touched in Live Logs: ${res.maxObi === 0 ? 'N/A' : res.maxObi.toFixed(1) + '%'}`);
      console.log(`   - Average OBI in Live Logs: ${avgObi}%`);
      console.log(`   - Minimum 4h 15m RSI Touched in Live Logs: ${res.minRsi === 100 ? 'N/A' : res.minRsi.toFixed(1)}`);
      console.log(`   - Maximum 4h 15m RSI Touched in Live Logs: ${res.maxRsi === 0 ? 'N/A' : res.maxRsi.toFixed(1)}`);
      console.log(`   - Average 4h 15m RSI in Live Logs: ${avgRsi}`);
      if (res.sampleLogs.length > 0) {
        console.log(`   - Sample Live Log snippet: "${res.sampleLogs[0]}"`);
      }
      console.log('');
    }
  });
}

parseExactStoredLiveLogs();
