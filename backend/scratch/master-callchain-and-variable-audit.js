const fs = require('fs');
const path = require('path');
const OrderTracker = require('../tracker');

// Mock MEXC Client to simulate all market scenarios and trace call-chains
class MockMexcClient {
  constructor() {
    this.prices = {};
    this.trades = {};
    this.depths = {};
    this.klines = {};
    this.placedOrders = [];
  }
  hasCredentials() { return true; }
  async getTickerPrice(sym) { return this.prices[sym] || 100.0; }
  async getDepth(sym) {
    return this.depths[sym] || {
      bids: [['100.0', '10.0'], ['99.9', '10.0']],
      asks: [['100.1', '10.0'], ['100.2', '10.0']]
    };
  }
  async getRecentTrades(sym) {
    return this.trades[sym] || [
      { price: '100.0', qty: '1.0', isBuyerMaker: false, time: Date.now() - 5000 }
    ];
  }
  async getKlines(sym) {
    return this.klines[sym] || Array(30).fill([Date.now(), '100', '101', '99', '100', '500']);
  }
  async placeOrder(params) {
    const orderId = 'mexc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    this.placedOrders.push({ ...params, orderId });
    return { orderId };
  }
  async getOrder(sym, id) {
    return { status: 'FILLED', executedQty: '10.0', cummulativeQuoteQty: '1000.0', price: '100.0' };
  }
  async cancelOrder() { return true; }
  async getBalances() { return [{ asset: 'USDT', free: 1000, locked: 0 }]; }
}

async function runMasterCallchainAndVariableAudit() {
  console.log('========================================================================');
  console.log('🧪 MASTER EXHAUSTIVE CALL-CHAIN & VARIABLE MUTATION AUDIT SUITE');
  console.log('   Testing: Function Call Chains, State Transitions & Variable Updates');
  console.log('========================================================================\n');

  const mexcMock = new MockMexcClient();
  const mockIo = { emit: () => {} };
  const tracker = new OrderTracker(mexcMock, mockIo);
  tracker.orders = [];

  let auditPassed = true;
  let testCount = 0;

  function assert(condition, message) {
    testCount++;
    if (!condition) {
      console.error(`  ❌ FAILED Test #${testCount}: ${message}`);
      auditPassed = false;
      throw new Error(`Assertion Failed: ${message}`);
    } else {
      console.log(`  ✅ PASSED Test #${testCount}: ${message}`);
    }
  }

  // ─── SCENARIO 1: ORDER CREATION & PENDING_ACTIVATION STATE MUTATION ─────────────
  console.log('\n--- SCENARIO 1: Order Creation & Initial Variables Check ---');
  mexcMock.prices['ETHUSDT'] = 3500.0;
  
  const order = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '0.25',
    quoteOrderQty: '50',
    dryRun: true,
    autoRepeat: true,
    activationOffset: '0.5',
    takeProfit: '0.6',
    stopLoss: '0.5',
    filter40sVolume: true
  });

  assert(order.status === 'PENDING_ACTIVATION', 'Order status must be PENDING_ACTIVATION');
  assert(order.peakPrice === 3500.0, 'peakPrice must be set to initialPrice 3500.0');
  assert(order.activationPrice === 3500.0 * (1 - 0.005), `activationPrice must be 3482.5, got ${order.activationPrice}`);
  assert(order.activationDirection === 'DOWN', 'activationDirection must be DOWN');
  assert(order.filter40sVolume === true, 'filter40sVolume flag must be true');

  // ─── SCENARIO 2: ACTIVATION DIP REACHED -> TRANSITION TO RUNNING ───────────────
  console.log('\n--- SCENARIO 2: Activation Dip Hit -> Transition to RUNNING ---');
  mexcMock.prices['ETHUSDT'] = 3480.0; // Dip below 3482.5
  await tracker.tick();

  const activeOrder = tracker.orders.find(o => o.id === order.id);
  assert(activeOrder.status === 'RUNNING', 'State transition to RUNNING on dip');
  assert(activeOrder.bottomPrice === 3480.0, 'bottomPrice updated to 3480.0');
  assert(activeOrder.triggerPrice === 3480.0 * 1.0025, `triggerPrice set to bottom + 0.25% (3488.7), got ${activeOrder.triggerPrice}`);

  // ─── SCENARIO 3: TRAILING BOTTOM UPDATE ─────────────────────────────────────────
  console.log('\n--- SCENARIO 3: Price Dips Further -> bottomPrice & triggerPrice Update ---');
  mexcMock.prices['ETHUSDT'] = 3470.0; // Deeper dip
  await tracker.tick();

  assert(activeOrder.bottomPrice === 3470.0, 'bottomPrice updated to 3470.0');
  assert(Math.abs(activeOrder.triggerPrice - (3470.0 * 1.0025)) < 0.0001, `triggerPrice updated to 3478.675, got ${activeOrder.triggerPrice}`);

  // ─── SCENARIO 4: 40s BUYER VOLUME FILTER DEFERRAL ─────────────────────────────
  console.log('\n--- SCENARIO 4: Rebound Hit but 40s Buyer Volume < 60% -> BUY DEFERRED ---');
  mexcMock.prices['ETHUSDT'] = 3480.0; // Price rebounds past 3478.675
  // Mock recent trades with 40% taker buy (sellers dominant)
  mexcMock.trades['ETHUSDT'] = [
    { price: '3480.0', qty: '4.0', isBuyerMaker: false, time: Date.now() - 5000 },
    { price: '3480.0', qty: '6.0', isBuyerMaker: true, time: Date.now() - 5000 }
  ];
  await tracker.tick();

  assert(activeOrder.status === 'RUNNING', 'Order remains in RUNNING state because 40s Volume filter failed (40% < 60%)');
  assert(activeOrder.executionPrice === null, 'executionPrice must still be null');

  // ─── SCENARIO 5: 40s BUYER VOLUME CONFIRMATION -> EXECUTE TRAILING BUY ──────────
  console.log('\n--- SCENARIO 5: 40s Buyer Volume >= 60% -> ENTRY CONFIRMED & TP_SL_ACTIVE ---');
  // Mock recent trades with 70% taker buy (buyers dominant)
  mexcMock.trades['ETHUSDT'] = [
    { price: '3480.0', qty: '7.0', isBuyerMaker: false, time: Date.now() - 5000 },
    { price: '3480.0', qty: '3.0', isBuyerMaker: true, time: Date.now() - 5000 }
  ];
  await tracker.tick();

  assert(activeOrder.status === 'TP_SL_ACTIVE', 'State transitions to TP_SL_ACTIVE upon buy confirmation');
  assert(activeOrder.executionPrice === 3480.0, 'executionPrice set to 3480.0');

  // ─── SCENARIO 6: 50% PROFIT LOCK TRIGGER (EXACT 50% TP LEVEL) ───────────────────
  console.log('\n--- SCENARIO 6: Price Hits 50% TP Progress -> SL Shifted to EXACT 50% TP Level ---');
  // TP = 0.6%, Buy = 3480.0. 50% TP = +0.30%. Price moves to 3480 * 1.0035 (+0.35%)
  mexcMock.prices['ETHUSDT'] = 3480.0 * 1.0035;
  await tracker.tick();

  assert(activeOrder.isSlProfitLocked === true, 'isSlProfitLocked flag set to true');
  const expectedLockedSl = 3480.0 * (1 + 0.003); // Exact +0.30%
  assert(Math.abs(activeOrder.lockedSlPrice - expectedLockedSl) < 0.001, `lockedSlPrice must be exact 50% TP level (3490.44), got ${activeOrder.lockedSlPrice}`);

  // ─── SCENARIO 7: TAKE PROFIT EXECUTION & AUTO-REPEAT CYCLE RESET ───────────────
  console.log('\n--- SCENARIO 7: Price Hits Take Profit -> Cycle Complete & State Reset ---');
  mexcMock.prices['ETHUSDT'] = 3480.0 * 1.0065; // +0.65% > +0.60% TP
  await tracker.tick();

  assert(activeOrder.status === 'PENDING_ACTIVATION', 'Auto-repeat resets state to PENDING_ACTIVATION');
  assert(activeOrder.tradeHistory.length === 1, 'tradeHistory array contains 1 completed cycle entry');
  assert(activeOrder.tradeHistory[0].type === 'TAKE_PROFIT', 'tradeHistory cycle type is TAKE_PROFIT');
  assert(activeOrder.tradeHistory[0].profitUsdt > 0, 'profitUsdt > 0');
  assert(activeOrder.peakPrice === 3480.0 * 1.0065, 'peakPrice updated to new high for next cycle');

  console.log('\n========================================================================');
  console.log('🏆 Master Call-Chain & Variable Audit: ALL 7 SCENARIOS PASSED 100% PERFECT!');
  console.log('========================================================================\n');
}

runMasterCallchainAndVariableAudit().catch(e => {
  console.error('\n❌ MASTER AUDIT FAILED:', e.message);
  process.exit(1);
});
