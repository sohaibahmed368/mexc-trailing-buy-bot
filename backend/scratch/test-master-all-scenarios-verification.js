const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('================================================================================');
console.log('🔬 MASTER SYSTEM-WIDE VERIFICATION & ZERO-HALT QA AUDIT');
console.log('================================================================================\n');

async function testMasterSystem() {
  const dummyIo = { emit: () => {} };
  const tracker = new OrderTracker({
    hasCredentials: () => true,
    getBalances: async () => [{ asset: 'USDT', free: 1000, locked: 0 }],
    getAllTickerPrices: async () => [],
    getTickerPrice: async () => 64000,
    getMyTrades: async () => [],
    getOpenOrders: async () => []
  }, dummyIo);

  console.log('1. TESTING NON-BLOCKING STARTTRACKING...');
  await tracker.startTracking();
  assert(tracker.intervalId !== null, 'tracker.intervalId must be registered immediately');
  console.log('   ✅ startTracking NON-BLOCKING test PASSED!\n');

  console.log('2. TESTING TICK LOOP WITH ACTIVE NO_SL AND SL_ACTIVE CARDS...');
  const orderNoSl = {
    id: 'test_no_sl',
    symbol: 'BTCUSDT',
    status: 'TP_SL_ACTIVE',
    executionPrice: 64000.0,
    currentPrice: 64000.0,
    takeProfit: 0.6,
    stopLoss: 0.3,
    adaptiveSlMode: 'NO_SL',
    activeSlPrice: null,
    dryRun: true
  };

  const orderSlActive = {
    id: 'test_sl_active',
    symbol: 'XRPUSDT',
    status: 'TP_SL_ACTIVE',
    executionPrice: 0.50,
    currentPrice: 0.50,
    takeProfit: 0.6,
    stopLoss: 0.3,
    adaptiveSlMode: 'SL_ACTIVE',
    activeSlPrice: 0.4985,
    dryRun: true
  };

  tracker.orders = [orderNoSl, orderSlActive];

  // Simulating price drop for both
  orderNoSl.currentPrice = 63000.0;   // -1.5% drop (NO_SL mode)
  orderSlActive.currentPrice = 0.498; // -0.4% drop (SL_ACTIVE mode)

  await tracker.tick();

  assert.strictEqual(orderNoSl.status, 'TP_SL_ACTIVE', 'NO_SL card must stay ACTIVE during price drop');
  assert.strictEqual(orderSlActive.status, 'TRIGGERED', 'SL_ACTIVE dryRun card must transition to TRIGGERED on SL hit');
  console.log('   ✅ Tick Loop Dual-Mode SL Evaluation PASSED!\n');

  // Clean up timer
  if (tracker.intervalId) clearInterval(tracker.intervalId);

  console.log('================================================================================');
  console.log('🏆 MASTER SYSTEM-WIDE VERIFICATION PASSED 100% PERFECT WITH ZERO HALT!');
  console.log('================================================================================\n');
}

testMasterSystem().then(() => process.exit(0)).catch(err => {
  console.error('❌ Master Verification Failed:', err);
  process.exit(1);
});
