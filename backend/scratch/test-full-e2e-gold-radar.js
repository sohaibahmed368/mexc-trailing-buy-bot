const assert = require('assert');
const http = require('http');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function testFullE2E() {
  console.log('🧪 Starting Full E2E Verification of Gold Radar Server...');

  // Start the actual express server on a test port
  process.env.PORT = '8105';
  
  // Require server module
  const serverModule = require('../server');

  // Wait 3 seconds for server boot and initial aggregation
  await new Promise(r => setTimeout(r, 3000));

  console.log('📡 Testing GET http://127.0.0.1:8105/api/gold-radar/metrics ...');
  const metricsRes = await fetchJson('http://127.0.0.1:8105/api/gold-radar/metrics');
  assert(metricsRes.success === true, 'Response must be success: true');
  assert(metricsRes.data.venuesCount >= 20, `Venues count should be >= 20, got ${metricsRes.data.venuesCount}`);
  assert(metricsRes.data.averagePrice > 1000, `Average price should be > 1000, got ${metricsRes.data.averagePrice}`);
  console.log(`✅ /api/gold-radar/metrics PASSED: ${metricsRes.data.venuesCount} Venues, Avg Price: $${metricsRes.data.averagePrice.toFixed(2)}, Consensus OBI: ${metricsRes.data.consensusObiPct}%`);

  console.log('\n📡 Testing GET http://127.0.0.1:8105/api/gold-radar/orderbook ...');
  const bookRes = await fetchJson('http://127.0.0.1:8105/api/gold-radar/orderbook');
  assert(bookRes.success === true, 'Response must be success: true');
  assert(bookRes.data.bids.length > 0, 'Bids must be populated');
  assert(bookRes.data.asks.length > 0, 'Asks must be populated');
  console.log(`✅ /api/gold-radar/orderbook PASSED: ${bookRes.data.bids.length} Bid Levels, ${bookRes.data.asks.length} Ask Levels, Spread: $${bookRes.data.spreadUsd}`);

  console.log('\n📡 Testing Static Web App Bundle index.html ...');
  const htmlRes = await new Promise((resolve) => {
    http.get('http://127.0.0.1:8105/', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
  });

  assert(htmlRes.includes('index-CMCfgOdR.js') || htmlRes.includes('assets/index-'), 'index.html must include compiled React bundle');
  console.log('✅ Static React Bundle is actively served by Express!');

  console.log('\n================================================================================');
  console.log('🏆 100% GOLD LIQUIDITY RADAR E2E LIVE SYSTEM TEST PASSED!');
  console.log('================================================================================\n');

  process.exit(0);
}

testFullE2E().catch(err => {
  console.error('❌ E2E Test Failed:', err);
  process.exit(1);
});
