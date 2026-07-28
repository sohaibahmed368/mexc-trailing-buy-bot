const Tracker = require('./tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

// ─── Scenario: Oversold Infinite Loop Fix Test ───────────────────────────────
// PROBLEM: When SL fires but BTC balance is 0 (Oversold 30005), bot was
//          reverting order to TP_SL_ACTIVE and re-triggering every 1.8s forever.
// FIX:     When Oversold fires + free balance is 0, immediately mark TRIGGERED.
// ─────────────────────────────────────────────────────────────────────────────

class MockMexcClientOversold {
  constructor() {
    this.price = 63800.0;
    this.orderIdCounter = 1;
    this.orders = {};
    this.cancelCount = 0;
    this.placeAttempts = 0;
    this.hasBalance = false; // Simulate 0 BTC balance (already sold or transferred)
  }

  hasCredentials() { return true; }
  async getTickerPrice() { return this.price; }
  async getDepth(symbol, limit) {
    return {
      bids: [[(this.price - 0.01).toString(), '60']],
      asks: [[(this.price + 0.01).toString(), '40']]
    };
  }
  async getKlines() { return []; }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const id = 'mock_' + (this.orderIdCounter++);
    this.placeAttempts++;
    if (side === 'SELL' && type === 'MARKET') {
      // Simulate Oversold (30005) - BTC balance is 0
      const err = new Error('MEXC API Error: {"msg":"Oversold","code":30005}');
      err.code = 30005;
      throw err;
    }
    this.orders[id] = { orderId: id, side, type, quantity, price, status: 'NEW', executedQty: quantity || 0.003 };
    return { orderId: id, status: 'NEW' };
  }

  async getOrder(symbol, orderId) {
    return this.orders[orderId] || null;
  }

  async getBalances() {
    // Return 0 BTC free balance (already sold/transferred)
    return [
      { asset: 'BTC', free: this.hasBalance ? 0.003 : 0, locked: 0 },
      { asset: 'USDT', free: 5000, locked: 0 }
    ];
  }

  async cancelOrder(symbol, orderId) {
    this.cancelCount++;
    if (this.orders[orderId]) this.orders[orderId].status = 'CANCELED';
    return { orderId, status: 'CANCELED' };
  }

  async getTradeFee() { return { takerFee: 0.001, makerFee: 0.0008 }; }
}

async function runOversoldInfiniteLoopTest() {
  console.log('================================================================');
  console.log('🧪 OVERSOLD INFINITE LOOP FIX - REGRESSION TEST');
  console.log('================================================================\n');

  const mockClient = new MockMexcClientOversold();
  const tracker = new Tracker(mockClient, mockIo);

  // Override paths to local test files
  tracker.ordersPath = './test-oversold-orders.json';
  tracker.logsPath   = './test-oversold-logs.json';
  tracker.orders = [];
  tracker.logs   = [];
  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath))   fs.unlinkSync(tracker.logsPath);

  // Set entry price at 64500, SL at -1% = 63855, current price 63800 (SL already hit)
  const ENTRY_PRICE = 64500;
  const SL_PCT      = 1.0;
  const SL_LEVEL    = ENTRY_PRICE * (1 - SL_PCT / 100); // 63855

  console.log(`[SETUP] Entry Price: $${ENTRY_PRICE}`);
  console.log(`[SETUP] Stop Loss %: ${SL_PCT}% => SL Level: $${SL_LEVEL.toFixed(2)}`);
  console.log(`[SETUP] Current Price: $${mockClient.price} (already below SL)`);
  console.log(`[SETUP] BTC Free Balance: 0 (simulating Oversold / already sold)\n`);

  // Create order already in TP_SL_ACTIVE with a mocked mexcSellOrderId (TP limit order)
  const order = await tracker.addOrder({
    symbol: 'BTCUSDT',
    trailValue: 1.0,
    quantity: '0.003',
    quoteOrderQty: '',
    orderType: 'MARKET',
    dryRun: false,
    activationPrice: '',
    takeProfit: 2.0,
    stopLoss: SL_PCT,
    filterSmartSl: false,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    autoRepeat: false,
    activationOffset: 0,
    reboundOffset: 0,
    startImmediately: true
  });

  // Force order into TP_SL_ACTIVE state with a mocked TP sell order
  order.status = 'TP_SL_ACTIVE';
  order.executionPrice = ENTRY_PRICE;
  order.bottomPrice = ENTRY_PRICE;
  order.triggerPrice = ENTRY_PRICE;
  order.mexcSellOrderId = 'mock_tp_limit_1'; // existing TP limit order to cancel
  // Register the TP order in mock client
  mockClient.orders['mock_tp_limit_1'] = {
    orderId: 'mock_tp_limit_1', side: 'SELL', type: 'LIMIT',
    quantity: 0.003, price: ENTRY_PRICE * 1.02, status: 'NEW'
  };

  tracker.saveOrders();

  console.log('[TEST] Simulating one price poll tick at price below SL...\n');
  let tickCount = 0;
  const MAX_TICKS = 3;

  // Run 3 poll ticks and see if the death loop breaks
  for (let i = 0; i < MAX_TICKS; i++) {
    tickCount++;
    await tracker.tick(); // tick() is the actual internal polling method
    console.log(`  [TICK ${tickCount}] order.status = ${order.status}`);

    if (order.status === 'TRIGGERED' || order.status === 'COMPLETE' || order.status === 'PENDING_ACTIVATION') {
      console.log(`\n✅ [PASS] INFINITE LOOP BROKEN! Order exited loop state at tick ${tickCount}. Final status: ${order.status}`);
      break;
    }

    if (i === MAX_TICKS - 1) {
      console.log(`\n❌ [FAIL] INFINITE LOOP NOT FIXED! Order stuck in "${order.status}" after ${MAX_TICKS} ticks.`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  // Verify the logs contain the correct guard message
  const logs = tracker.getLogs();
  const oversoldLog = logs.find(l =>
    l.message && (l.message.includes('OVERSOLD ZERO BALANCE') || l.message.includes('OVERSOLD OUTER CATCH'))
  );

  if (oversoldLog) {
    console.log('\n✅ [PASS] Oversold Zero Balance guard log found:');
    console.log(`   → "${oversoldLog.message}"`);
  } else {
    const slLogs = logs.filter(l => l.message && l.message.includes('Oversold'));
    console.log('\n📋 Oversold-related logs:');
    slLogs.slice(0, 5).forEach(l => console.log('  →', l.message));
  }

  // Cleanup
  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath))   fs.unlinkSync(tracker.logsPath);

  console.log('\n================================================================');
  console.log('OVERSOLD LOOP FIX TEST COMPLETE');
  console.log('================================================================');
}

runOversoldInfiniteLoopTest().catch(e => console.error('Test crashed:', e.message));
