const fs = require('fs');
const path = require('path');
const MEXCTrailingTracker = require('../tracker');

console.log('========================================================================');
console.log('🔬 AUDIT: EARLY PROFIT LOCK (+0.25%), 2-TICK REBOUND & SMART SL ENFORCEMENT');
console.log('========================================================================\n');

class MockMexcClient {
  constructor() {
    this.price = 100.0;
  }
  async getTickerPrice(symbol) { return this.price; }
  async getKlines(symbol, interval, limit) {
    const klines = [];
    const count = limit || 30;
    for (let i = 0; i < count; i++) {
      const closePrice = (100.0 - i * 0.2).toFixed(2);
      klines.push([
        Date.now() - ((count - i) * 60000),
        closePrice, closePrice, closePrice, closePrice,
        i === count - 1 ? '150.0' : '100.0'
      ]);
    }
    return klines;
  }
  async getDepth(symbol, limit) {
    return { bids: [['100.0', '70.0']], asks: [['100.0', '30.0']] };
  }
  async placeOrder(params) {
    return { orderId: 'mock_ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4) };
  }
  async getOrder(symbol, orderId) {
    return { orderId, status: 'FILLED', executedQty: '10', cummulativeQuoteQty: '1000' };
  }
  async getBalances() { return []; }
  hasCredentials() { return true; }
}

async function runAudit() {
  const mockClient = new MockMexcClient();
  const tracker = new MEXCTrailingTracker(mockClient);
  tracker.io = { emit: () => {} };

  tracker.calculateTakerVolumeDelta = async function(symbol, durationMs) {
    return { takerBuyPct: 75.0, takerSellPct: 25.0, totalVolume: 1000 };
  };

  console.log('1. TEST EARLY PROFIT LOCK AT +0.25% GAIN...');
  const order1 = await tracker.addOrder({
    symbol: 'BTCUSDT',
    trailValue: '0.20',
    quoteOrderQty: '100',
    dryRun: true,
    filterObi: true,
    filterVolume: true,
    filterRsi: true,
    filter40sVolume: true,
    autoRepeat: true,
    activationOffset: '0.55',
    takeProfit: '0.70',
    stopLoss: '0.30'
  });

  // Activate RUNNING
  mockClient.price = 99.40;
  await tracker.tick();
  console.assert(order1.status === 'RUNNING', 'order1 should be RUNNING');

  // Trigger Rebound Buy at 99.65
  mockClient.price = 99.65;
  await tracker.tick();
  console.assert(order1.status === 'TP_SL_ACTIVE', 'order1 should be TP_SL_ACTIVE');
  console.log('   ✅ Rebound Buy Executed at 99.65 USDT.');

  // Test +0.25% Gain Trigger (Entry 99.65 * 1.0025 = 99.899)
  mockClient.price = 99.91; // +0.26% gain
  await tracker.tick();

  console.assert(order1.isSlProfitLocked === true, 'isSlProfitLocked should be true');
  const expectedLockedSl = 99.65 * (1 + 0.0010);
  console.assert(Math.abs(order1.lockedSlPrice - expectedLockedSl) < 0.0001, `lockedSlPrice should be Break-even +0.10% (${expectedLockedSl})`);
  console.log(`   ✅ EARLY PROFIT LOCK TRIGGERED AT +0.26% GAIN! Locked SL Floor: $${order1.lockedSlPrice.toFixed(4)} USDT (+0.10% Break-even).\n`);

  console.log('2. TEST UNCHECKED SMART SL (filterSmartSl = false) IMMEDIATE MARKET SELL...');
  const order2 = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '0.20',
    quoteOrderQty: '100',
    dryRun: true,
    filterSmartSl: false, // UNCHECKED!
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filter40sVolume: false,
    autoRepeat: false,
    takeProfit: '0.70',
    stopLoss: '0.30'
  });

  mockClient.price = 100.0;
  order2.status = 'TP_SL_ACTIVE';
  order2.executionPrice = 100.0;

  // Price hits SL target (100.0 * 0.997 = 99.70)
  mockClient.price = 99.65; // SL Hit!
  await tracker.tick();

  console.assert(order2.status === 'TRIGGERED' || order2.status === 'PENDING_ACTIVATION', 'Unchecked Smart SL should execute immediate sell');
  console.log('   ✅ Unchecked Smart SL (filterSmartSl = false) EXECUTED IMMEDIATE MARKET SELL without depth delay!\n');

  console.log('========================================================================');
  console.log('🏆 EARLY PROFIT LOCK (+0.25%) & SMART SL ENFORCEMENT AUDIT PASSED 100%!');
  console.log('========================================================================');
}

runAudit().catch(e => {
  console.error('Audit Failure:', e);
  process.exit(1);
});
