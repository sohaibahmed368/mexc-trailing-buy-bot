const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');

if (!fs.existsSync(logsPath)) {
  console.log('logs.json not found');
  process.exit(1);
}

const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));

console.log(`================================================================`);
console.log(`📜 PARSING LIVE LOG ENTRIES (${logs.length} Total Logs)`);
console.log(`================================================================\n`);

let tradeEvents = [];
let buyEvents = [];
let slEvents = [];
let tpEvents = [];
let indicatorEvents = [];

logs.forEach(log => {
  const msg = log.message || '';
  const sym = log.symbol || 'SYSTEM';
  const type = log.type || 'info';

  if (msg.includes('ENTRY CONFIRMED') || msg.includes('BUY Order placed') || msg.includes('MARKET BUY FILLED')) {
    buyEvents.push({ time: log.timestamp, sym, msg });
  } else if (msg.includes('Stop Loss hit') || msg.includes('IMMEDIATE SL MARKET SELL') || msg.includes('STOP LOSS')) {
    slEvents.push({ time: log.timestamp, sym, msg });
  } else if (msg.includes('Take Profit hit') || msg.includes('LIMIT SELL PLACED') || msg.includes('TAKE PROFIT')) {
    tpEvents.push({ time: log.timestamp, sym, msg });
  } else if (msg.includes('Metrics:') || msg.includes('OBI Support') || msg.includes('RSI') || msg.includes('BUY DEFERRED')) {
    indicatorEvents.push({ time: log.timestamp, sym, msg });
  }
});

console.log(`🛒 Total Buy Events Found: ${buyEvents.length}`);
console.log(`🎯 Total Take Profit Events Found: ${tpEvents.length}`);
console.log(`🚨 Total Stop Loss Events Found: ${slEvents.length}`);
console.log(`📊 Total Indicator Evaluation Logs: ${indicatorEvents.length}\n`);

console.log('📌 Sample Stop Loss Log Events:');
slEvents.slice(-10).forEach(e => console.log(`[${e.time}] ${e.sym}: ${e.msg}`));

console.log('\n📌 Sample Buy Confirmation Log Events:');
buyEvents.slice(-10).forEach(e => console.log(`[${e.time}] ${e.sym}: ${e.msg}`));

console.log('\n📌 Sample Indicator Alignment Log Events:');
indicatorEvents.slice(-10).forEach(e => console.log(`[${e.time}] ${e.sym}: ${e.msg}`));
