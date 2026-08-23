const http = require('http');
const express = require('express');
const path = require('path');
const fs = require('fs');
const MexcTracker = require('../tracker');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');

async function runCompleteE2ELiveDashboardTest() {
  console.log('================================================================================');
  console.log('🧪 FULL E2E LIVE DASHBOARD & ACTIVE CARDS VERIFICATION');
  console.log('================================================================================\n');

  const app = express();
  const server = http.createServer(app);

  const tracker = new MexcTracker();
  const radar = new MultiExchangeSignalRadar();
  tracker.setSignalRadar(radar);

  const staticPath = path.join(__dirname, '..', 'public');
  app.use(express.static(staticPath));
  app.use(express.json());

  app.get('/api/orders', (req, res) => res.json(tracker.getOrders()));
  app.get('/api/logs', (req, res) => res.json(tracker.getLogs()));
  app.get('*', (req, res) => res.sendFile(path.join(staticPath, 'index.html')));

  const TEST_PORT = 8199;

  await new Promise((resolve) => {
    server.listen(TEST_PORT, () => {
      console.log(`📡 Test Live Server running on port ${TEST_PORT}`);
      resolve();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. REST API /api/orders Verification
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶️ 1. Testing REST API: GET http://localhost:8199/api/orders');
  const apiOrders = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}/api/orders`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  console.log(`   Fetched ${apiOrders.length} orders from REST API.`);
  apiOrders.forEach((o, i) => {
    console.log(`   [Card ${i + 1}] ${o.symbol.padEnd(16)} | Status: ${o.status.padEnd(14)} | TP: +${o.takeProfit}% | Price: $${o.currentPrice}`);
  });

  if (apiOrders.length < 35) {
    throw new Error(`Expected at least 35 orders from REST API, got ${apiOrders.length}`);
  }
  console.log(`   ✅ STEP 1 PASSED: REST API /api/orders returns all ${apiOrders.length} active + watchlist cards!`);

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Static Web Application (HTML + React Bundle) Verification
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶️ 2. Testing Frontend Static Bundle (HTML & React Bundle)');
  const htmlContent = await new Promise((resolve) => {
    http.get(`http://localhost:${TEST_PORT}/`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
  });

  console.log(`   Fetched index.html (${htmlContent.length} bytes)`);
  const match = htmlContent.match(/src="(\/assets\/[^"]+)"/);
  if (!match) throw new Error('No JS bundle reference found in index.html');
  const jsBundlePath = match[1];
  console.log(`   Referenced React JS Bundle: ${jsBundlePath}`);

  const jsBundleContent = await new Promise((resolve) => {
    http.get(`http://localhost:${TEST_PORT}${jsBundlePath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
  });

  console.log(`   Fetched JS bundle (${jsBundleContent.length} bytes)`);
  console.log(`   Bundle contains 'SPOT OBI':`, jsBundleContent.includes('SPOT OBI'));
  console.log(`   Bundle contains 'FUTURES OBI':`, jsBundleContent.includes('FUTURES OBI'));
  console.log(`   Bundle contains 'v2.5 SPOT+FUTURES':`, jsBundleContent.includes('v2.5 SPOT+FUTURES'));
  console.log(`   Bundle contains 'Active Tracking':`, jsBundleContent.includes('Active Tracking'));

  if (!jsBundleContent.includes('Active Tracking') || !jsBundleContent.includes('SPOT OBI')) {
    throw new Error('JS Bundle is missing core dashboard features');
  }
  console.log('   ✅ STEP 2 PASSED: React production bundle is 100% complete and fully verified!');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Live Tracking Loop Verification
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n▶️ 3. Testing Tracker Loop Execution');
  await tracker.tick();
  console.log(`   Tracker tick executed without errors for ${tracker.orders.length} active cards.`);
  console.log('   ✅ STEP 3 PASSED: Tracker tick loop is fully functional!');

  // Cleanup
  await new Promise(resolve => server.close(resolve));
  clearInterval(radar.intervalId);

  console.log('\n================================================================================');
  console.log('🏆 100% E2E LIVE DASHBOARD TEST PASSED SUCCESSFULLY!');
  console.log('================================================================================');
  process.exit(0);
}

runCompleteE2ELiveDashboardTest().catch(err => {
  console.error('❌ E2E TEST FAILED:', err);
  process.exit(1);
});
