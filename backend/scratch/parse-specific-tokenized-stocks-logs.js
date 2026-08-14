const fs = require('fs');
const path = require('path');

function parseTokenizedStockLogs() {
  const stockSymbols = ['NVDA', 'AAPL', 'AMZN', 'GOOGL', 'TSLA', 'SPCX', 'APPLEX', 'GOOGLEX', 'AMZX', 'NVDAX'];
  const logFilePath = path.join(__dirname, '../stock-logs.json');

  if (!fs.existsSync(logFilePath)) {
    console.log('stock-logs.json not found!');
    return;
  }

  const stat = fs.statSync(logFilePath);
  const content = fs.readFileSync(logFilePath, 'utf8');
  let data = [];
  try {
    data = JSON.parse(content);
  } catch (e) {
    console.log('Error parsing JSON:', e.message);
    return;
  }

  console.log('========================================================================');
  console.log(`📦 STORED PRODUCTION LOG FILE METRICS: stock-logs.json`);
  console.log(`File Size: ${(stat.size / 1024).toFixed(2)} KB | Total Log Records: ${data.length}`);
  console.log('========================================================================\n');

  const stockMetrics = {};
  stockSymbols.forEach(sym => {
    stockMetrics[sym] = {
      symbol: sym,
      logCount: 0,
      obiValues: [],
      rsiValues: [],
      sampleLogs: []
    };
  });

  data.forEach((item, index) => {
    const symStr = (item.symbol || '').toUpperCase();
    const msgStr = (item.message || '').toUpperCase();

    stockSymbols.forEach(sym => {
      if (symStr.includes(sym) || msgStr.includes(sym)) {
        const m = stockMetrics[sym];
        m.logCount++;

        // Extract Bid/Ask prices or OBI if recorded
        const bidAskMatch = item.message.match(/Best Bid:\s*([\d.]+),\s*Best Ask:\s*([\d.]+)/i);
        if (bidAskMatch) {
          const bid = parseFloat(bidAskMatch[1]);
          const ask = parseFloat(bidAskMatch[2]);
          // Micro OBI estimation from orderbook top spread
          const obiEst = Math.round((bid / (bid + ask)) * 100 * 10) / 10;
          m.obiValues.push(obiEst);
        }

        const obiM = item.message.match(/OBI[:\s=]+([\d.]+)/i);
        if (obiM) m.obiValues.push(parseFloat(obiM[1]));

        const rsiM = item.message.match(/RSI[:\s=]+([\d.]+)/i);
        if (rsiM) m.rsiValues.push(parseFloat(rsiM[1]));

        if (m.sampleLogs.length < 3) {
          m.sampleLogs.push({ timestamp: item.timestamp, text: item.message });
        }
      }
    });
  });

  console.log('📊 SPECIFIC TOKENIZED STOCKS LIVE LOG PARSE RESULTS:\n');

  stockSymbols.forEach(sym => {
    const m = stockMetrics[sym];
    if (m.logCount > 0) {
      const minObi = m.obiValues.length > 0 ? Math.min(...m.obiValues).toFixed(1) + '%' : 'N/A';
      const maxObi = m.obiValues.length > 0 ? Math.max(...m.obiValues).toFixed(1) + '%' : 'N/A';
      const avgObi = m.obiValues.length > 0 ? (m.obiValues.reduce((a, b) => a + b, 0) / m.obiValues.length).toFixed(1) + '%' : 'N/A';

      const minRsi = m.rsiValues.length > 0 ? Math.min(...m.rsiValues).toFixed(1) : 'N/A';
      const maxRsi = m.rsiValues.length > 0 ? Math.max(...m.rsiValues).toFixed(1) : 'N/A';

      console.log(`📌 [${sym}] Tokenized Stock Live Log Data:`);
      console.log(`   - Live Log Records Found: ${m.logCount} Entries`);
      console.log(`   - Minimum OBI Recorded: ${minObi}`);
      console.log(`   - Maximum OBI Recorded: ${maxObi}`);
      console.log(`   - Average OBI Recorded: ${avgObi}`);
      console.log(`   - Minimum RSI Recorded: ${minRsi}`);
      console.log(`   - Maximum RSI Recorded: ${maxRsi}`);
      if (m.sampleLogs.length > 0) {
        console.log(`   - Live Timestamp: "${m.sampleLogs[0].timestamp}" -> "${m.sampleLogs[0].text}"`);
      }
      console.log('');
    } else {
      console.log(`ℹ️ [${sym}] No records found in stock-logs.json.\n`);
    }
  });
}

parseTokenizedStockLogs();
