const fs = require('fs');
const path = require('path');

function searchStockLogs() {
  console.log('🔍 SEARCHING ALL SYSTEM LOGS FOR US TOKENIZED STOCKS OBI & RSI VALUES...\n');

  const stockSymbols = ['NVDA', 'TSLA', 'AAPL', 'AMZN', 'GOOGL', 'INTU', 'QBTS', 'SMCI', 'SBCX'];
  const logFiles = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (!full.includes('node_modules') && !full.includes('.git')) {
          walk(full);
        }
      } else if (f.endsWith('.json') || f.endsWith('.log') || f.endsWith('.txt')) {
        logFiles.push(full);
      }
    }
  }

  walk('./backend');
  walk('C:/Users/Hi/.gemini/antigravity/brain/cdfb16e8-d8e7-4868-967f-4d9834b72016');

  console.log(`Found ${logFiles.length} log/json files to inspect.\n`);

  const stockMetrics = {};
  stockSymbols.forEach(s => {
    stockMetrics[s] = {
      symbol: s,
      obiValues: [],
      rsiValues: [],
      maxObi: 0,
      minObi: 100,
      minRsi: 100,
      maxRsi: 0,
      logCount: 0
    };
  });

  for (const file of logFiles) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (!content) continue;

      const lines = content.split('\n');
      for (const line of lines) {
        for (const sym of stockSymbols) {
          if (line.toUpperCase().includes(sym)) {
            stockMetrics[sym].logCount++;

            // Extract OBI value e.g. "OBI: 48.5%" or "OBI = 52.0%" or "OBI: 52%"
            const obiMatch = line.match(/OBI[:\s=]+([\d.]+)/i);
            if (obiMatch) {
              const val = parseFloat(obiMatch[1]);
              if (val >= 0 && val <= 100) {
                stockMetrics[sym].obiValues.push(val);
                if (val > stockMetrics[sym].maxObi) stockMetrics[sym].maxObi = val;
                if (val < stockMetrics[sym].minObi) stockMetrics[sym].minObi = val;
              }
            }

            // Extract RSI value e.g. "RSI: 44.2" or "RSI = 48.0" or "RSI: 48"
            const rsiMatch = line.match(/RSI[:\s=]+([\d.]+)/i);
            if (rsiMatch) {
              const val = parseFloat(rsiMatch[1]);
              if (val >= 0 && val <= 100) {
                stockMetrics[sym].rsiValues.push(val);
                if (val < stockMetrics[sym].minRsi) stockMetrics[sym].minRsi = val;
                if (val > stockMetrics[sym].maxRsi) stockMetrics[sym].maxRsi = val;
              }
            }
          }
        }
      }
    } catch (e) {}
  }

  console.log('========================================================================');
  console.log('📊 LIVE LOG ANALYSIS RESULTS FOR US TOKENIZED STOCKS');
  console.log('========================================================================\n');

  stockSymbols.forEach(s => {
    const m = stockMetrics[s];
    const avgObi = m.obiValues.length > 0 ? (m.obiValues.reduce((a, b) => a + b, 0) / m.obiValues.length).toFixed(1) : 'N/A';
    const avgRsi = m.rsiValues.length > 0 ? (m.rsiValues.reduce((a, b) => a + b, 0) / m.rsiValues.length).toFixed(1) : 'N/A';

    console.log(`📌 [${s}] Analysis:`);
    console.log(`   - Log Mentions Count: ${m.logCount}`);
    console.log(`   - OBI Range: Min ${m.minObi === 100 ? 'N/A' : m.minObi.toFixed(1)}% | Max ${m.maxObi.toFixed(1)}% | Avg ${avgObi}%`);
    console.log(`   - RSI Range (4h 15m): Min ${m.minRsi === 100 ? 'N/A' : m.minRsi.toFixed(1)} | Max ${m.maxRsi.toFixed(1)} | Avg ${avgRsi}`);
    console.log(`   - Reason Entry Not Taken: ${m.maxObi < 55 ? `Max OBI (${m.maxObi.toFixed(1)}%) < required 55%/60%` : ''} ${m.minRsi > 45 ? `Min RSI (${m.minRsi.toFixed(1)}) > required 40/45` : ''}\n`);
  });
}

searchStockLogs();
