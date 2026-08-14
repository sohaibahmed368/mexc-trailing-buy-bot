const fs = require('fs');
const path = require('path');

function scanLineByLine() {
  const filePaths = [
    path.join(__dirname, '../stock-logs.json'),
    path.join(__dirname, '../data/logs.json'),
    path.join(__dirname, '../data/orders.json'),
    path.join(__dirname, 'tmp-sc2-logs.json'),
    path.join(__dirname, 'tmp-test-BTCUSDT-logs.json'),
    path.join(__dirname, 'tmp-test-ETHUSDT-logs.json'),
    path.join(__dirname, 'tmp-test-XAUTUSDT-logs.json'),
    path.join(__dirname, '../test-master-stock-logs.json'),
    path.join(__dirname, '../test-ult-stock-logs.json')
  ];

  let totalSizeBytes = 0;
  let totalLinesCount = 0;
  const records = [];

  filePaths.forEach(fp => {
    if (!fs.existsSync(fp)) return;
    const stat = fs.statSync(fp);
    totalSizeBytes += stat.size;

    const content = fs.readFileSync(fp, 'utf8');
    const lines = content.split('\n');
    totalLinesCount += lines.length;

    lines.forEach(line => {
      if (!line || line.trim().length === 0) return;
      if (line.includes('DeepAuditMock') || line.includes('MockMexcClient')) return; // ignore unit test mock setup

      const obiM = line.match(/(?:OBI|bidsRatio|Top 10 Avg OBI)[:\s=]+([\d.]+)/i);
      const rsiM = line.match(/(?:RSI|4h 15m RSI)[:\s=]+([\d.]+)/i);
      const timeM = line.match(/"timestamp":\s*"([^"]+)"/i) || line.match(/"time":\s*"([^"]+)"/i) || line.match(/\[([\d\-\:\.\sTZA]+)\]/i);

      if (obiM || rsiM) {
        records.push({
          file: path.basename(fp),
          timestamp: timeM ? timeM[1] : 'N/A',
          obi: obiM ? parseFloat(obiM[1]) : null,
          rsi: rsiM ? parseFloat(rsiM[1]) : null,
          raw: line.trim()
        });
      }
    });
  });

  const sizeKB = (totalSizeBytes / 1024).toFixed(2);
  const sizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  console.log('========================================================================');
  console.log(`📦 PRODUCTION LOG FILES SYSTEM STORAGE METRICS`);
  console.log(`Total Log Files Size: ${sizeMB} MB (${sizeKB} KB)`);
  console.log(`Total Stored Log Lines: ${totalLinesCount} Lines`);
  console.log(`Total Log Records Parsed: ${records.length} Records`);
  console.log('========================================================================\n');

  const obi55Rsi50Matches = records.filter(r => r.obi !== null && r.obi >= 55.0 && (r.rsi === null || r.rsi <= 50.0));

  console.log(`🎯 EXACT MATCHES IN SYSTEM LOGS (OBI >= 55.0% AND RSI <= 50.0):`);
  console.log(`Total Matches Found: ${obi55Rsi50Matches.length} Matches\n`);

  if (obi55Rsi50Matches.length > 0) {
    console.log('📜 LIST OF MATCHED LIVE LOG RECORDS:');
    obi55Rsi50Matches.forEach((rec, idx) => {
      console.log(`   [Record #${idx + 1}] Timestamp: ${rec.timestamp} | Source File: ${rec.file}`);
      console.log(`      -> OBI Value: ${rec.obi}% | RSI Value: ${rec.rsi}`);
      console.log(`      -> Log Text: "${rec.raw.substring(0, 140)}..."\n`);
    });
  } else {
    console.log('🔍 Checking logs where OBI >= 55% was recorded in live scan logs:');
    const highObiLogs = records.filter(r => r.obi !== null && r.obi >= 55.0);
    console.log(`Found ${highObiLogs.length} live log records with OBI >= 55.0%:\n`);
    highObiLogs.slice(0, 10).forEach((rec, idx) => {
      console.log(`   [Record #${idx + 1}] Timestamp: ${rec.timestamp} | File: ${rec.file}`);
      console.log(`      -> OBI Value: ${rec.obi}% | RSI Value: ${rec.rsi || 'N/A'}`);
      console.log(`      -> Log Text: "${rec.raw.substring(0, 140)}..."\n`);
    });
  }
}

scanLineByLine();
