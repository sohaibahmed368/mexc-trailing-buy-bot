const assert = require('assert');
const GlobalGoldLiquidityRadar = require('../gold-liquidity-radar');
const createGoldRadarRouter = require('../routes/gold-radar-routes');
const express = require('express');
const http = require('http');

async function testGoldRadar() {
  console.log('🧪 Testing GlobalGoldLiquidityRadar Backend...');
  const radar = new GlobalGoldLiquidityRadar();
  
  const metrics = await radar.refreshGoldMetrics();
  assert(metrics !== null, 'Metrics must not be null');
  assert(metrics.venuesCount >= 20, `Expected >= 20 venues, got ${metrics.venuesCount}`);
  assert(metrics.consensusObiPct > 0, 'Consensus OBI must be > 0');
  assert(metrics.averagePrice > 1000, `Expected price > 1000, got ${metrics.averagePrice}`);
  
  console.log(`✅ Loaded ${metrics.venuesCount} venues! Average Price: $${metrics.averagePrice.toFixed(2)} | Consensus OBI: ${metrics.consensusObiPct}%`);
  console.log(`   Session: ${metrics.currentSession} | Sentiment: ${metrics.sentimentBadge}`);
  
  const orderBook = radar.getOrderBook();
  assert(orderBook !== null, 'OrderBook must not be null');
  assert(orderBook.bids.length > 0, 'Bids must be populated');
  assert(orderBook.asks.length > 0, 'Asks must be populated');
  console.log(`✅ OrderBook Ladder: ${orderBook.bids.length} Bids, ${orderBook.asks.length} Asks, Spread: $${orderBook.spreadUsd}`);

  console.log('\n🏆 ALL GOLD RADAR BACKEND TESTS PASSED!');
  process.exit(0);
}

testGoldRadar().catch(err => {
  console.error('❌ Gold Radar Test Failed:', err);
  process.exit(1);
});
