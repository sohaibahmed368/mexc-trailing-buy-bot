const assert = require('assert');
const path = require('path');
const fs = require('fs');

const AlpacaClient = require('../alpaca-client');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

async function runAlpacaSuite() {
  console.log('========================================================================');
  console.log('🧪 DECOUPLED ALPACA STOCK BOT ENGINE QA TEST SUITE');
  console.log('========================================================================\n');

  // Initialize decoupled Alpaca client & tracker
  const alpacaClient = new AlpacaClient();
  alpacaClient.setCredentials('TEST_ALPACA_KEY_123', 'TEST_ALPACA_SECRET_456', true);
  
  const mockIo = { emit: () => {} };
  const tracker = new AlpacaStockOrderTracker(alpacaClient, mockIo);

  // Clear test state
  tracker.orders = [];
  tracker.logs = [];

  // TEST 1: Decoupled Alpaca Stock Order Creation
  console.log('--- TEST 1: Decoupled Alpaca Stock Order Creation ---');
  const order = await tracker.createStockOrder({
    symbol: 'NVDA',
    trailValue: 0.4,
    quoteOrderQty: 100,
    takeProfit: 1.0,
    stopLoss: 0.8,
    activationOffset: 0.5,
    autoRepeat: true,
    startImmediately: false,
    dryRun: true
  });

  assert.strictEqual(order.symbol, 'NVDA', 'Symbol should be clean NVDA');
  assert.strictEqual(order.status, 'PENDING_ACTIVATION', 'Order status should start in PENDING_ACTIVATION');
  console.log('  ✅ [PASS] Alpaca Stock Order created cleanly in PENDING_ACTIVATION state.');

  // TEST 2: Price Dip Activation
  console.log('\n--- TEST 2: Trailing Dip Activation ---');
  const dipPrice = order.activationPrice - 0.1;
  tracker.alpacaClient.getTickerPrice = async () => dipPrice;
  await tracker.tick();

  assert.strictEqual(order.status, 'RUNNING', 'Order status should transition to RUNNING on dip');
  console.log(`  ✅ [PASS] Stock order activated on dip to $${dipPrice}.`);

  // TEST 3: Trailing Buy Trigger & Market Execution
  console.log('\n--- TEST 3: Trailing Buy Trigger & Market Execution ---');
  const triggerPrice = order.triggerPrice + 0.1;
  tracker.alpacaClient.getTickerPrice = async () => triggerPrice;
  await tracker.tick();

  assert.strictEqual(order.status, 'TP_SL_ACTIVE', 'Order status should transition to TP_SL_ACTIVE');
  console.log(`  ✅ [PASS] Trailing buy triggered at $${triggerPrice}. Moved to TP_SL_ACTIVE.`);

  // TEST 4: Take Profit & Auto-Repeat Reset
  console.log('\n--- TEST 4: Take Profit & Auto-Repeat Cycle Reset ---');
  const buyPrice = order.executionPrice || triggerPrice;
  const tpTarget = buyPrice * 1.02; // +2% price jump
  tracker.alpacaClient.getTickerPrice = async () => tpTarget;
  await tracker.tick();

  assert.strictEqual(order.status, 'PENDING_ACTIVATION', 'Order should auto-reset to PENDING_ACTIVATION');
  assert.strictEqual(order.tradeHistory.length, 1, 'Trade history should contain 1 completed cycle');
  assert.strictEqual(order.tradeHistory[0].type, 'TAKE_PROFIT', 'Trade type should be TAKE_PROFIT');
  console.log('  ✅ [PASS] Take Profit executed and order cleanly reset for next cycle.');

  // TEST 5: Decoupled Order Cancellation
  console.log('\n--- TEST 5: Decoupled Order Cancellation ---');
  await tracker.cancelOrder(order.id);
  assert.strictEqual(order.status, 'CANCELLED', 'Order should be CANCELLED');
  console.log('  ✅ [PASS] Alpaca Stock Order cancelled successfully.');

  console.log('\n========================================================================');
  console.log('🏆 ALL DECOUPLED ALPACA STOCK BOT TESTS PASSED (100% PERFECT)!');
  console.log('========================================================================\n');
}

runAlpacaSuite().catch(err => {
  console.error('❌ Alpaca Test Suite Failed:', err);
  process.exit(1);
});
