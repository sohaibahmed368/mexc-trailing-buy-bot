const fs = require('fs');
const path = require('path');

function searchTargetedLogs() {
  const stockSymbols = ['NVDA', 'TSLA', 'AAPL', 'AMZN', 'GOOGL', 'INTU', 'QBTS', 'SMCI', 'SBCX'];
  const filesToScan = [
    './backend/data/orders.json',
    './backend/data/stock-orders.json',
    './backend/data/logs.json',
    './backend/data/stock_logs.json',
    './backend/scratch/test-deep-stock-logs.json',
    './backend/scratch/tmp-sc2-logs.json',
    './backend/scratch/test-deep-stock-orders.json'
  ];

  // Also include recent task log files
  const taskDir = 'C:/Users/Hi/.gemini/antigravity/brain/cdfb16e8-d8e7-4868-967f-4d9834b72016/.system_generated/tasks';
  if (fs.existsSync(taskDir)) {
    const taskFiles = fs.readdirSync(taskDir).filter(f => f.endsWith('.log'));
    taskFiles.slice(-20).forEach(tf => filesToScan.push(path.join(taskDir, tf)));
  }

  console.log(`Scanning ${filesToScan.length} targeted log files for US Tokenized Stocks...`);

  const metrics = {};
  stockSymbols.forEach(s => {
    metrics[s] = {
      symbol: s,
      obiValues: [],
      rsiValues: [],
      maxObi: 0,
      minObi: 100,
      minRsi: 100,
      maxRsi: 0,
      logsFound: 0
    };
  });

  filesToScan.forEach(filePath => {
    if (!fs.existsSync(filePath)) return;
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');

      for (const line of lines) {
        for (const sym of stockSymbols) {
          if (line.toUpperCase().includes(sym)) {
            metrics[sym].logsFound++;

            // Extract OBI
            const obiMatch = line.match(/OBI[:\s=]+([\d.]+)/i);
            if (obiMatch) {
              const val = parseFloat(obiMatch[1]);
              if (val >= 0 && val <= 100) {
                metrics[sym].obiValues.push(val);
                if (val > metrics[sym].maxObi) metrics[sym].maxObi = val;
                if (val < metrics[sym].minObi) metrics[sym].minObi = val;
              }
            }

            // Extract RSI
            const rsiMatch = line.match(/RSI[:\s=]+([\d.]+)/i);
            if (rsiMatch) {
              const val = parseFloat(rsiMatch[1]);
              if (val >= 0 && val <= 100) {
                metrics[sym].rsiValues.push(val);
                if (val < metrics[sym].minRsi) metrics[sym].minRsi = val;
                if (val > metrics[sym].maxRsi) metrics[sym].maxRsi = val;
              }
            }
          }
        }
      }
    } catch (e) {}
  });

  console.log('\n========================================================================');
  console.log('📊 REAL LOG EMPIRICAL METRICS FOR US TOKENIZED STOCKS');
  console.log('========================================================================\n');

  stockSymbols.forEach(s => {
    const m = metrics[s];
    const avgObi = m.obiValues.length > 0 ? (m.obiValues.reduce((a, b) => a + b, 0) / m.obiValues.length).toFixed(1) : 'N/A';
    const avgRsi = m.rsiValues.length > 0 ? (m.rsiValues.reduce((a, b) => a + b, 0) / m.rsiValues.length).toFixed(1) : 'N/A';

    console.log(`📌 [${s}] Live Log Findings:`);
    console.log(`   - Total Mentions: ${m.logsFound}`);
    console.log(`   - Recorded OBI Range: Min ${m.minObi === 100 ? 'N/A' : m.minObi.toFixed(1)}% | Max ${m.maxObi.toFixed(1)}% | Avg ${avgObi}%`);
    console.log(`   - Recorded RSI Range (4h 15m): Min ${m.minRsi === 100 ? 'N/A' : m.minRsi.toFixed(1)} | Max ${m.maxRsi.toFixed(1)} | Avg ${avgRsi}`);
  });
}

searchTargetedLogs();
