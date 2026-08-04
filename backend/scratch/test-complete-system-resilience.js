const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('================================================================================');
console.log('🔬 SYSTEM RESILIENCE & FUNCTION CALLCHAIN QA AUDIT');
console.log('================================================================================\n');

async function testResilience() {
  const tracker = new OrderTracker({ emit: () => {} });

  console.log('1. TESTING 15M TREND GUARD NULL/UNDEFINED SAFETY...');
  const mockOrder = {
    id: 'resilience_test_order',
    symbol: 'XRPUSDT',
    status: 'TP_SL_ACTIVE',
    executionPrice: 0.50,
    takeProfit: 0.6,
    stopLoss: 0.3,
    adaptiveSlMode: 'NO_SL',
    activeSlPrice: null,
    dryRun: true
  };

  tracker.orders = [mockOrder];

  // Run tick with null activeSlPrice and NO_SL
  mockOrder.currentPrice = 0.49; // Price drops -2%
  await tracker.tick();

  assert.strictEqual(mockOrder.status, 'TP_SL_ACTIVE', 'NO_SL trade must remain ACTIVE during price drop');
  console.log('   ✅ NO_SL Null Safety PASSED! (Trade stayed active through -2% drop without crash).\n');

  console.log('2. TESTING TICK LOOP CONTINUITY...');
  mockOrder.currentPrice = 0.504; // Price reaches +0.80% TP
  await tracker.tick();

  assert.strictEqual(mockOrder.status, 'TRIGGERED', 'Trade must trigger TP when price crosses TP target');
  console.log('   ✅ Tick Loop Continuity PASSED! (Trade completed TP cycle smoothly).\n');

  console.log('================================================================================');
  console.log('🏆 SYSTEM RESILIENCE & CALLCHAIN AUDIT PASSED 100% PERFECT!');
  console.log('================================================================================\n');
}

testResilience().then(() => process.exit(0)).catch(err => {
  console.error('❌ Resilience Audit Failed:', err);
  process.exit(1);
});
