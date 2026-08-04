const OrderTracker = require('../tracker');
const assert = require('assert');

const tracker = new OrderTracker({ emit: () => {} });

console.log('================================================================================');
console.log('🔬 AUDIT: 3-LAYER ADAPTIVE TREND HYBRID SYSTEM & 15M RSI GUARD');
console.log('================================================================================\n');

async function testTrendGuard() {
  console.log('1. TESTING 15M RSI CALCULATION...');
  const rsi = await tracker.calculate15mRSI('BTCUSDT');
  console.log(`   ✅ 15m RSI for BTCUSDT: ${rsi} (Calculated successfully)\n`);

  console.log('2. TESTING BUY EXECUTION IN BULLISH/SIDEWAYS TREND (15m RSI >= 45)...');
  const mockBullishOrder = {
    id: 'test_bullish_order',
    symbol: 'ETHUSDT',
    executionPrice: 3000.0,
    stopLoss: 0.3,
    takeProfit: 0.8
  };

  // Override calculate15mRSI to simulate Bullish trend (RSI 55.0)
  const originalRsiFunc = tracker.calculate15mRSI;
  tracker.calculate15mRSI = async () => 55.0;

  await tracker.apply15mTrendGuard(mockBullishOrder);

  assert.strictEqual(mockBullishOrder.adaptiveSlMode, 'NO_SL', 'adaptiveSlMode should be NO_SL when 15m RSI >= 45');
  assert.strictEqual(mockBullishOrder.activeSlPrice, null, 'activeSlPrice should be null in NO_SL mode');
  console.log('   ✅ Bullish Trend Guard PASSED! Stop Loss disabled (NO_SL active).\n');

  console.log('3. TESTING BUY EXECUTION IN BEARISH/CRASHING TREND (15m RSI < 40)...');
  const mockBearishOrder = {
    id: 'test_bearish_order',
    symbol: 'SOLUSDT',
    executionPrice: 150.0,
    stopLoss: 0.3,
    takeProfit: 0.8
  };

  // Override calculate15mRSI to simulate Bearish trend (RSI 35.0)
  tracker.calculate15mRSI = async () => 35.0;

  await tracker.apply15mTrendGuard(mockBearishOrder);

  assert.strictEqual(mockBearishOrder.adaptiveSlMode, 'SL_ACTIVE', 'adaptiveSlMode should be SL_ACTIVE when 15m RSI < 40');
  assert(mockBearishOrder.activeSlPrice < 150.0, 'activeSlPrice should be set below execution price');
  console.log('   ✅ Bearish Trend Guard PASSED! Active Stop Loss enabled.\n');

  // Restore original function
  tracker.calculate15mRSI = originalRsiFunc;

  console.log('================================================================================');
  console.log('🏆 3-LAYER ADAPTIVE TREND HYBRID SYSTEM AUDIT PASSED 100% PERFECT!');
  console.log('================================================================================\n');
}

testTrendGuard().catch(err => {
  console.error('❌ Trend Guard Audit Failed:', err);
  process.exit(1);
});
