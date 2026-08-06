const fs = require('fs');
const path = require('path');

const logsPath = path.join(__dirname, '..', 'data', 'logs.json');
const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');

async function findExact07747PnlTrades() {
  console.log("================================================================================");
  console.log("🔍 DEEP LOG & HISTORY AUDIT: EXPLAINING THE 2 WINS (+0.7747 USDT) BANNER");
  console.log("================================================================================");

  let logs = [];
  if (fs.existsSync(logsPath)) {
    try { logs = JSON.parse(fs.readFileSync(logsPath, 'utf8')); } catch (e) {}
  }

  let orders = [];
  if (fs.existsSync(ordersPath)) {
    try { orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8')); } catch (e) {}
  }

  console.log("📜 Searching data/logs.json for Take Profit Fill Logs...");
  const tpLogs = logs.filter(l => {
    const msg = l.message || l.log || '';
    return msg.includes('TAKE PROFIT FILLED') || msg.includes('PROFIT') || msg.includes('LIMIT SELL') || msg.includes('executed on MEXC');
  });

  console.log(`Found ${tpLogs.length} TP/Sell log messages:\n`);
  tpLogs.forEach((l, i) => {
    const pktTimeStr = new Date(new Date(l.timestamp || l.createdAt).getTime() + (5 * 60 * 60 * 1000)).toISOString().replace('T', ' ').substring(0, 19) + ' PKT';
    console.log(`[LOG #${i + 1}] ${pktTimeStr} (${l.timestamp}) | Symbol: ${l.symbol || 'N/A'} | Msg: ${l.message}`);
  });

  console.log("\n================================================================================");
  console.log("📋 ORDERS.JSON OBJECTS ANALYSIS:");
  console.log("================================================================================");
  orders.forEach((o, i) => {
    console.log(`Order #${i + 1}: ID=${o.id}, Symbol=${o.symbol}, Status=${o.status}, ExecutionPrice=${o.executionPrice}, SellPrice=${o.sellExecutionPrice}, TotalNetProfit=${o.totalNetProfit || 0}`);
  });
}

findExact07747PnlTrades().catch(console.error);
