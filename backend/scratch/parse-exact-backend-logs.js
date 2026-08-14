const fs = require('fs');

function parseBackendStockLogs() {
  const files = [
    './backend/stock-logs.json',
    './backend/logs.json',
    './backend/test-master-stock-logs.json',
    './backend/test-ult-stock-logs.json',
    './backend/test-reg-stock-logs.json'
  ];

  const stockSymbols = ['NVDAON', 'TSLAON', 'AAPLON', 'AMZNON', 'GOOGLON', 'INTUON', 'QBTS', 'SMCION', 'SBCXON', 'SPCXON'];

  const metrics = {};
  stockSymbols.forEach(s => {
    metrics[s] = {
      symbol: s,
      logsCount: 0,
      obiList: [],
      rsiList: []
    };
  });

  files.forEach(file => {
    if (!fs.existsSync(file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(data)) {
        data.forEach(item => {
          const sym = (item.symbol || '').toUpperCase();
          const msg = item.message || '';
          
          for (const s of stockSymbols) {
            if (sym.includes(s) || msg.toUpperCase().includes(s)) {
              metrics[s].logsCount++;

              const obiM = msg.match(/(?:OBI|bidsRatio|Top 10 Avg OBI)[:\s=]+([\d.]+)/i);
              if (obiM) {
                const v = parseFloat(obiM[1]);
                if (v >= 0 && v <= 100) metrics[s].obiList.push(v);
              }

              const rsiM = msg.match(/(?:RSI|4h 15m RSI)[:\s=]+([\d.]+)/i);
              if (rsiM) {
                const v = parseFloat(rsiM[1]);
                if (v >= 0 && v <= 100) metrics[s].rsiList.push(v);
              }
            }
          }
        });
      }
    } catch (e) {}
  });

  console.log('========================================================================');
  console.log('📊 STORED LIVE LOG FILES DIRECT PARSE RESULTS');
  console.log('========================================================================\n');

  stockSymbols.forEach(s => {
    const m = metrics[s];
    const minObi = m.obiList.length > 0 ? Math.min(...m.obiList).toFixed(1) + '%' : 'N/A';
    const maxObi = m.obiList.length > 0 ? Math.max(...m.obiList).toFixed(1) + '%' : 'N/A';
    const avgObi = m.obiList.length > 0 ? (m.obiList.reduce((a, b) => a + b, 0) / m.obiList.length).toFixed(1) + '%' : 'N/A';

    const minRsi = m.rsiList.length > 0 ? Math.min(...m.rsiList).toFixed(1) : 'N/A';
    const maxRsi = m.rsiList.length > 0 ? Math.max(...m.rsiList).toFixed(1) : 'N/A';
    const avgRsi = m.rsiList.length > 0 ? (m.rsiList.reduce((a, b) => a + b, 0) / m.rsiList.length).toFixed(1) : 'N/A';

    console.log(`📌 [${s}] Stored Log Stats:`);
    console.log(`   - Log Entries Found: ${m.logsCount}`);
    console.log(`   - OBI Range: Min ${minObi} | Max ${maxObi} | Avg ${avgObi}`);
    console.log(`   - 4h 15m RSI Range: Min ${minRsi} | Max ${maxRsi} | Avg ${avgRsi}\n`);
  });
}

parseBackendStockLogs();
