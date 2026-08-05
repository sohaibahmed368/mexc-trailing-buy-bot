const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '../data/logs.json');
const ordersPath = path.join(__dirname, '../data/orders.json');

if (fs.existsSync(ordersPath)) {
  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  console.log('--------------------------------------------------------------------------------');
  console.log('CURRENT ACTIVE & HISTORICAL ORDER CARDS IN SYSTEM:');
  console.log('--------------------------------------------------------------------------------');
  orders.forEach(o => {
    console.log(`📌 Symbol: ${o.symbol} | Status: ${o.status} | Mode: ${o.adaptiveSlMode || 'N/A'}`);
    console.log(`   Config: TP=${o.takeProfit}%, SL=${o.stopLoss}%, Trail=${o.trailValue}%, SmartSL=${o.filterSmartSl}, RSIFilter=${o.filterRsi}, VolFilter=${o.filterVolume}`);
    console.log(`   Prices: Initial=$${o.initialPrice}, Entry=$${o.executionPrice}, ActiveSL=$${o.activeSlPrice || 'N/A'}\n`);
  });
}

if (fs.existsSync(logsPath)) {
  const logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
  console.log('--------------------------------------------------------------------------------');
  console.log('LOG MESSAGES CONTAINING [ENTRY CONFIRMED], [15M TREND GUARD], OR [STOP LOSS]:');
  console.log('--------------------------------------------------------------------------------');
  const relevantLogs = logs.filter(l => {
    const m = l.message || '';
    return m.includes('ENTRY CONFIRMED') || m.includes('15M TREND GUARD') || m.includes('Stop Loss') || m.includes('BUY Order placed') || m.includes('Limit Sell') || m.includes('CANCELLED');
  });

  relevantLogs.slice(0, 30).forEach(l => {
    console.log(`[${l.timestamp}] [${l.type.toUpperCase()}] ${l.symbol ? `[${l.symbol}] ` : ''}${l.message}`);
  });
}
