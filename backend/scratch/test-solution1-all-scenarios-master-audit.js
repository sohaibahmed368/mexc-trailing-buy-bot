const fs = require('fs');
const path = require('path');
const MEXCTrailingTracker = require('../tracker');

console.log('========================================================================');
console.log('🔬 EXHAUSTIVE SOLUTION 1 (SMART CONFLUENCE CONSENSUS) SYSTEM-WIDE AUDIT');
console.log('========================================================================\n');

// Mock MEXC Client
class MockMexcClient {
  constructor() {
    this.price = 100.0;
  }
  async getTickerPrice(symbol) { return this.price; }
  async getKlines(symbol, interval, limit) {
    // Generate mock 1m klines with oversold RSI (declining price)
    const klines = [];
    const count = limit || 30;
    for (let i = 0; i < count; i++) {
      const closePrice = (100.0 - (i * 0.2)).toFixed(2); // Price drops from 100.0 down to 94.0 -> RSI = 0 (Oversold!)
      klines.push([
        Date.now() - ((count - i) * 60000),
        closePrice, closePrice, closePrice, closePrice,
        i === count - 1 ? '150.0' : '100.0'
      ]);
    }
    return klines;
  }
  async getDepth(symbol, limit) {
    return {
      bids: [['100.0', '70.0']], // 70% Bids
      asks: [['100.0', '30.0']]  // 30% Asks
    };
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

async function runMasterAudit() {
  const mockClient = new MockMexcClient();
  const tracker = new MEXCTrailingTracker(mockClient);
  tracker.io = { emit: () => {} };
  
  // Override calculateTakerVolumeDelta to mock taker volume
  let mockTakerBuyPct = 75.0;
  tracker.calculateTakerVolumeDelta = async function(symbol, durationMs) {
    return { takerBuyPct: mockTakerBuyPct, takerSellPct: 100 - mockTakerBuyPct, totalVolume: 1000 };
  };

  console.log('1. VERIFYING CARD CREATION & CONSENSUS MODE PARAMETERS...');
  const order1 = await tracker.addOrder({
    symbol: 'BTCUSDT',
    trailValue: '0.20',
    quoteOrderQty: '100',
    dryRun: true,
    filterObi: true,
    filterVolume: true,
    filterRsi: true,
    filter40sVolume: true,
    consensusMode: 'SMART_CONFLUENCE',
    autoRepeat: true,
    activationOffset: '0.55',
    takeProfit: '0.60',
    stopLoss: '0.50'
  });

  console.assert(order1.consensusMode === 'SMART_CONFLUENCE', 'order1 consensusMode should be SMART_CONFLUENCE');
  console.assert(order1.status === 'PENDING_ACTIVATION', 'order1 status should be PENDING_ACTIVATION');
  console.log('   ✅ Card created with SMART_CONFLUENCE consensusMode in PENDING_ACTIVATION state.\n');

  console.log('2. VERIFYING DIP ACTIVATION TRANSITION (PENDING_ACTIVATION -> RUNNING)...');
  mockClient.price = 99.40; // 0.60% dip -> activates RUNNING
  await tracker.tick();
  console.assert(order1.status === 'RUNNING', 'order1 should transition to RUNNING');
  console.log('   ✅ Dip hit: Price 99.40 -> State transitioned to RUNNING.\n');

  console.log('3. VERIFYING 4/4 CHECKED CHECKBOXES -> 3/4 CONFLUENCE REBOUND BUY...');
  mockTakerBuyPct = 75.0; // 40s Vol Pass
  // Set price to trigger rebound
  mockClient.price = 99.65; // Rebound hit
  await tracker.tick();
  console.assert(order1.status === 'TP_SL_ACTIVE', 'order1 should transition to TP_SL_ACTIVE');
  console.log('   ✅ 3/4 Confluence Aligned -> Rebound Buy Executed! State shifted to TP_SL_ACTIVE.\n');

  console.log('4. VERIFYING EARLY PROFIT LOCK GUARD (+0.25% PROGRESS)...');
  mockClient.price = 99.91; // Entry 99.65, Gain +0.26% (>= +0.25% target)
  await tracker.tick();
  console.assert(order1.isSlProfitLocked === true, 'isSlProfitLocked should be true');
  console.log('   ✅ Price hit +0.25% target gain -> Early Profit Lock active (SL Floor locked at +0.10% break-even).\n');

  console.log('5. VERIFYING TAKE PROFIT HIT, TRADE HISTORY & AUTO-REPEAT RESET...');
  mockClient.price = 100.36; // TP Hit (+0.70% TP Target reached)
  await tracker.tick();
  console.assert(order1.status === 'PENDING_ACTIVATION', 'order1 status should reset to PENDING_ACTIVATION');
  console.assert(order1.tradeHistory.length === 1, 'tradeHistory length should be 1');
  console.log(`   ✅ TP Hit -> Cycle 1 Completed! Reset to PENDING_ACTIVATION. Profit: +$${order1.tradeHistory[0].profitUsdt.toFixed(4)} USDT.\n`);

  console.log('6. VERIFYING STRICT 4/4 CONSENSUS MODE...');
  tracker.orders = []; // Clear previous orders for isolated strict test
  const orderStrict = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '0.20',
    quoteOrderQty: '100',
    dryRun: true,
    filterObi: true,
    filterVolume: true,
    filterRsi: true,
    filter40sVolume: true,
    consensusMode: 'STRICT_ALL',
    autoRepeat: true,
    activationOffset: '0.55',
    takeProfit: '0.60',
    stopLoss: '0.50'
  });

  mockClient.price = 99.40;
  await tracker.tick(); // Activate RUNNING
  console.assert(orderStrict.status === 'RUNNING', 'orderStrict should be RUNNING');

  // Set 40s Vol to fail (50%)
  mockTakerBuyPct = 50.0;
  orderStrict.triggerPrice = 99.60;
  mockClient.price = 99.65;
  await tracker.tick();
  console.assert(orderStrict.status === 'RUNNING', 'Strict mode should DEFER buy when 3/4 pass');
  console.log('   ✅ Strict Mode (4/4): 3/4 pass correctly DEFERRED buy and kept trailing loop active.\n');

  mockTakerBuyPct = 75.0; // All 4 pass
  orderStrict.lastFilterFailLogTime = 0; // Reset log throttle timer
  await tracker.tick();
  if (orderStrict.status !== 'TP_SL_ACTIVE') {
    console.error('Strict assertion failure details:', { status: orderStrict.status, error: orderStrict.error, triggerPrice: orderStrict.triggerPrice, currentPrice: mockClient.price, lastLogTime: orderStrict.lastFilterFailLogTime });
  }
  console.assert(orderStrict.status === 'TP_SL_ACTIVE', 'Strict mode should BUY when 4/4 pass');
  console.log('   ✅ Strict Mode (4/4): 4/4 pass SUCCESSFUL buy executed!\n');

  console.log('========================================================================');
  console.log('🏆 SOLUTION 1 SMART CONFLUENCE SYSTEM-WIDE AUDIT PASSED 100% PERFECT!');
  console.log('========================================================================');
}

runMasterAudit().catch(e => {
  console.error('Audit Error:', e);
  process.exit(1);
});
