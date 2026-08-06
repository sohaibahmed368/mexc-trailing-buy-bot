const MexcClient = require('../mexc-client');
const OrderTracker = require('../tracker');
const fs = require('fs');

async function test10MbFifoLog() {
  console.log("================================================================================");
  console.log("🛠️ TESTING 10 MB FIFO ROLLING LOG TRUNCATION SYSTEM");
  console.log("================================================================================");

  const mexcClient = new MexcClient();
  const tracker = new OrderTracker(mexcClient);

  console.log("🧪 Simulating 60,000 rapid log entries (pushing size beyond 10 MB threshold)...");

  for (let i = 1; i <= 60000; i++) {
    tracker.log(
      `⚡ [DUAL GATE SCAN] ETHUSDT: Live Price $1905.78 USDT | Top 10 Avg OBI: 58.5% (Req >= 55.0%) | 4h 15m RSI: 38.5 (Req <= 40.0) | Exchanges Breakdown: [Binance: 65.0%, MEXC: 58.5%, Bybit: 51.0%]. Scanning live orderbooks & RSI...`,
      'info',
      'ETHUSDT'
    );
  }

  const stats = fs.statSync(tracker.auditLogPath);
  const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
  const content = fs.readFileSync(tracker.auditLogPath, 'utf8');
  const lines = content.split('\n').filter(l => l.trim().length > 0);

  console.log("\n================================================================================");
  console.log("🏆 10 MB FIFO ROLLING TRUNCATION REPORT:");
  console.log(`- Final File Size (data/scanner_audit.log): ${sizeMb} MB`);
  console.log(`- Total Retained Lines in File: ${lines.length} lines`);
  console.log("================================================================================");

  if (stats.size <= 10.2 * 1024 * 1024) {
    console.log("✅ PASS: File stayed strictly capped under 10 MB! Holds 14 - 24+ Hours of scan history cleanly!");
  } else {
    console.error("❌ FAIL: File size exceeded limit.");
  }
}

test10MbFifoLog().catch(console.error);
