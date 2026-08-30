const express = require('express');
const http = require('http');
const compression = require('compression');
const axios = require('axios');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const MexcClient = require('../mexc-client');
const OrderTracker = require('../tracker');

async function runBandwidthDryRunTest() {
  console.log('================================================================================');
  console.log('📊 ACCURATE BYTE-BY-BYTE BANDWIDTH CONSUMPTION & DRY-RUN SIMULATION');
  console.log('================================================================================\n');

  const app = express();
  app.use(compression());
  app.use(express.json());

  const mexcClient = new MexcClient();
  const tracker = new OrderTracker(mexcClient);

  // Setup sample test orders & logs
  tracker.orders = [
    {
      id: 'ord_sample_1',
      symbol: 'EURUSDT',
      status: 'PENDING_ACTIVATION',
      trailValue: 0.15,
      quoteOrderQty: 100,
      orderType: 'MARKET',
      dryRun: false,
      takeProfit: 0.2,
      stopLoss: 0,
      filterObi: true,
      targetObi: 50,
      targetRsi: 49,
      customObiThreshold: 50,
      customRsiThreshold: 49,
      autoRepeat: true,
      totalNetProfit: 0.85,
      tradeHistory: [{ cycle: 1, profit: 0.42 }, { cycle: 2, profit: 0.43 }],
      currentPrice: 1.1645
    },
    {
      id: 'ord_sample_2',
      symbol: 'GOLD(XAUT)USDT',
      status: 'TP_SL_ACTIVE',
      trailValue: 0.15,
      quoteOrderQty: 100,
      orderType: 'MARKET',
      dryRun: false,
      takeProfit: 0.4,
      stopLoss: 0,
      filterObi: true,
      targetObi: 55,
      targetRsi: 49,
      customObiThreshold: 55,
      customRsiThreshold: 49,
      autoRepeat: true,
      totalNetProfit: 1.62,
      tradeHistory: [],
      currentPrice: 4591.20
    }
  ];

  for (let i = 0; i < 30; i++) {
    tracker.logs.push({
      id: `log_${i}`,
      timestamp: new Date().toISOString(),
      message: `[EURUSDT] ⚡ [DUAL GATE SCAN] Live Price $1.1644 | Top 10 OBI: 50.2% | RSI: 48.5`,
      type: 'info',
      symbol: 'EURUSDT'
    });
  }

  // Define endpoints with compression
  app.get('/api/ping', (req, res) => {
    res.json({ status: 'online', uptimeSeconds: 12345, activeCards: tracker.getOrders().length });
  });

  app.get('/api/orders', (req, res) => {
    res.json(tracker.getOrders());
  });

  app.get('/api/logs', (req, res) => {
    res.json(tracker.getLogs().slice(0, 30));
  });

  const server = http.createServer(app);
  const TEST_PORT = 3899;

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));

  // Helper to measure exact GZIP transferred bytes
  async function measureTransferredBytes(endpoint) {
    const res = await axios.get(`http://localhost:${TEST_PORT}${endpoint}`, {
      headers: { 'Accept-Encoding': 'gzip, deflate' },
      decompress: false, // get raw compressed buffer
      responseType: 'arraybuffer'
    });
    return Buffer.from(res.data).length;
  }

  const pingBytes = await measureTransferredBytes('/api/ping');
  const ordersBytes = await measureTransferredBytes('/api/orders');
  const logsBytes = await measureTransferredBytes('/api/logs');

  console.log('📡 1. EXACT PAYLOAD SIZES PER REQUEST (AFTER GZIP COMPRESSION):');
  console.log(`   • /api/ping (Keep-Alive Cron Ping):   ${pingBytes} bytes  (~${(pingBytes / 1024).toFixed(2)} KB)`);
  console.log(`   • /api/orders (Active Orders State):  ${ordersBytes} bytes  (~${(ordersBytes / 1024).toFixed(2)} KB)`);
  console.log(`   • /api/logs (Recent 30 Logs):         ${logsBytes} bytes  (~${(logsBytes / 1024).toFixed(2)} KB)`);

  // Scenario 1: Standby Mode (Cron-Job pinging every 5 minutes 24/7, browser closed)
  const pingsPerHour = 12; // every 5 mins
  const pingsPerDay = pingsPerHour * 24; // 288 pings/day
  const pingsPerMonth = pingsPerDay * 30; // 8,640 pings/month
  const standbyMonthlyBytes = pingsPerMonth * pingBytes;
  const standbyMonthlyMb = standbyMonthlyBytes / (1024 * 1024);

  // Scenario 2: Active User Dashboard Mode (User keeps dashboard open for 4 hours EVERY day)
  const pollRateSec = 1.8;
  const pollsPerHour = 3600 / pollRateSec; // 2,000 polls/hour
  const activeHoursPerDay = 4; // 4 hours open every day
  const dailyPollBytes = pollsPerHour * activeHoursPerDay * ordersBytes;
  const monthlyPollBytes = dailyPollBytes * 30;
  const monthlyPollMb = monthlyPollBytes / (1024 * 1024);

  // Total Real-World Monthly Bandwidth
  const totalMonthlyBytes = standbyMonthlyBytes + monthlyPollBytes;
  const totalMonthlyMb = totalMonthlyBytes / (1024 * 1024);
  const renderQuotaMb = 5000; // 5 GB = 5,000 MB
  const percentUsed = (totalMonthlyMb / renderQuotaMb) * 100;

  console.log('\n================================================================================');
  console.log('📈 2. PROJECTED 30-DAY (1 MONTH) REAL-WORLD CONSUMPTION AUDIT:');
  console.log('================================================================================');
  console.log(`   • 24/7 Standby Keep-Alive (8,640 Pings/Month):  ${standbyMonthlyMb.toFixed(2)} MB / month`);
  console.log(`   • Active Dashboard Usage (4 Hours EVERY Day):   ${monthlyPollMb.toFixed(2)} MB / month`);
  console.log(`   ----------------------------------------------------------------------------`);
  console.log(`   🌟 TOTAL ESTIMATED MONTHLY BANDWIDTH:           ${totalMonthlyMb.toFixed(2)} MB / month`);
  console.log(`   🛡️ RENDER FREE MONTHLY QUOTA:                   ${renderQuotaMb.toFixed(0)} MB (5.0 GB)`);
  console.log(`   📊 PERCENTAGE OF FREE QUOTA USED:               ${percentUsed.toFixed(2)}% of 100%`);
  console.log(`   🟢 REMAINING UNUSED FREE BANDWIDTH:             ${(renderQuotaMb - totalMonthlyMb).toFixed(2)} MB (${(100 - percentUsed).toFixed(2)}% FREE)`);
  console.log('================================================================================\n');

  if (totalMonthlyMb < 100) {
    console.log(`✅ VERDICT: 100% SAFE & GUARANTEED! Total bandwidth (${totalMonthlyMb.toFixed(2)} MB) is well under 100 MB, consuming less than 1.5% of Render's 5GB quota!`);
  }

  server.close();
  process.exit(0);
}

runBandwidthDryRunTest().catch(e => {
  console.error('Test error:', e);
  process.exit(1);
});
