const Tracker = require('./tracker');
const fs = require('fs');

// Mock Socket.io
const mockIo = {
  emit: (event, data) => {}
};

// Mock MEXC Client with adjustable OBI support ratio
class MockMexcClient {
  constructor() {
    this.price = 1839.0;
    this.orderIdCounter = 1;
    this.orders = {};
    this.bidsRatio = 0.60; // 60% standard OBI support (passes filter)
  }
  
  hasCredentials() {
    return true;
  }
  
  async getTickerPrice(symbol) {
    return this.price;
  }
  
  async getDepth(symbol, limit) {
    // Generate order book bids/asks to match our mocked bidsRatio
    const bidsQty = this.bidsRatio * 100;
    const asksQty = (1 - this.bidsRatio) * 100;
    return {
      bids: [[(this.price - 1).toString(), bidsQty.toString()]],
      asks: [[(this.price + 1).toString(), asksQty.toString()]]
    };
  }

  async getKlines(symbol, interval, limit) {
    return []; // Return empty or simple values if volume/rsi not enabled in test
  }
  
  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const id = 'mock_mexc_' + (this.orderIdCounter++);
    const order = {
      orderId: id,
      symbol,
      side,
      type,
      quantity: quantity || 0.1,
      cummulativeQuoteQty: quoteOrderQty || (quantity * this.price) || 150.0,
      price: price || this.price,
      status: 'NEW',
      executedQty: quantity || 0.1
    };
    this.orders[id] = order;
    return { orderId: id, status: 'NEW' };
  }
  
  async getOrder(symbol, orderId) {
    const order = this.orders[orderId];
    if (order && order.side === 'SELL' && order.type === 'LIMIT') {
      if (this.price >= parseFloat(order.price)) {
        order.status = 'FILLED';
      }
    }
    return order;
  }

  async getBalances() {
    return [
      { asset: 'ETH', free: 0.5, locked: 0.0 },
      { asset: 'USDT', free: 1000.0, locked: 0.0 }
    ];
  }
  
  async cancelOrder(symbol, orderId) {
    if (this.orders[orderId]) {
      this.orders[orderId].status = 'CANCELED';
    }
    return { orderId, status: 'CANCELED' };
  }
}

async function runTest() {
  console.log('==================================================');
  console.log('STARTING ETH DUAL-PATH STATE MACHINE VALIDATION');
  console.log('==================================================\n');

  const mockClient = new MockMexcClient();
  const tracker = new Tracker(mockClient, mockIo);
  
  // Override paths
  tracker.ordersPath = './backend/test-orders-db.json';
  tracker.logsPath = './backend/test-logs-db.json';
  tracker.orders = [];
  tracker.logs = [];

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);

  // Initialize at 1839 (SL hit price)
  mockClient.price = 1839.0;
  console.log(`[INIT] ETH price set to ${mockClient.price} USDT.`);

  // Create order with filterObi enabled
  const order = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: 2.0,
    quantity: '0.1',
    quoteOrderQty: '',
    orderType: 'MARKET',
    dryRun: false,
    activationPrice: '',
    takeProfit: 8.0,
    stopLoss: 3.0,
    filterObi: true,
    filterVolume: false,
    filterRsi: false,
    autoRepeat: true,
    activationOffset: 10.0,
    reboundOffset: 2.0,
    startImmediately: false // starts waiting in PENDING_ACTIVATION
  });

  console.log(`\nStep 1: Check Initialization State`);
  console.log(`- Status: ${order.status}`);
  console.log(`- Peak Price: ${order.peakPrice} USDT`);
  console.log(`- Activation Target (Dip -10): ${order.activationPrice} USDT`);
  console.log(`- Local Bottom tracked: ${order.localBottom} USDT`);
  
  if (order.status !== 'PENDING_ACTIVATION' || order.activationPrice !== 1829.0) {
    console.error('FAIL: Initial setup is incorrect.');
    process.exit(1);
  }

  // Step 2: Price drops to 1835 (not reaching 1829 activation target)
  mockClient.price = 1835.0;
  console.log(`\nStep 2: Price drops to ${mockClient.price} USDT. Ticking...`);
  await tracker.tick();
  
  console.log(`- Status: ${order.status}`);
  console.log(`- Local Bottom updated to: ${order.localBottom} USDT`);
  
  if (order.localBottom !== 1835.0) {
    console.error('FAIL: Local bottom did not update.');
    process.exit(1);
  }

  // Step 3: Price bounces to 1837 (+2 rebound hit) but OBI indicator rejects (40% support)
  mockClient.price = 1837.0;
  mockClient.bidsRatio = 0.40; // Reject
  console.log(`\nStep 3: Price rises to ${mockClient.price} USDT (rebound target 1837). Indicators (OBI Bids Ratio = 40%) reject buying. Ticking...`);
  await tracker.tick();
  
  console.log(`- Status: ${order.status} (Expected: PENDING_ACTIVATION)`);
  console.log(`- Local Bottom: ${order.localBottom} USDT (Expected: 1835)`);
  console.log(`- Activation Target: ${order.activationPrice} USDT (Expected: 1829)`);

  if (order.status !== 'PENDING_ACTIVATION' || order.localBottom !== 1835.0) {
    console.error('FAIL: Rebound rejection did not preserve state.');
    process.exit(1);
  }

  // Step 4: Path A Check - Price drops down to 1828 (hits 1829 activation price)
  mockClient.price = 1828.0;
  console.log(`\nStep 4: [Path A] Price drops to ${mockClient.price} USDT (exceeding 1829 dip limit). Ticking...`);
  await tracker.tick();

  console.log(`- Status: ${order.status} (Expected: RUNNING)`);
  console.log(`- Bottom price set: ${order.bottomPrice} USDT (Expected: 1828)`);
  console.log(`- Trigger price set: ${order.triggerPrice} USDT (Expected: 1830)`);
  console.log(`- Local Bottom: ${order.localBottom} (Expected: null)`);

  if (order.status !== 'RUNNING' || order.triggerPrice !== 1830.0) {
    console.error('FAIL: Standard dip activation failed.');
    process.exit(1);
  }

  // Step 5: Resetting state to test Path B
  console.log('\n--------------------------------------------------');
  console.log('Resetting order state for Path B test...');
  order.status = 'PENDING_ACTIVATION';
  order.localBottom = 1835.0;
  order.bottomPrice = null;
  order.triggerPrice = null;

  // Step 5 continued: Price at 1837 and OBI indicator now confirms (60% support)
  mockClient.price = 1837.0;
  mockClient.bidsRatio = 0.60; // Confirm
  console.log(`Step 5: [Path B] Price is ${mockClient.price} USDT (rebound target 1837). Indicators (OBI Bids Ratio = 60%) confirm buying. Ticking...`);
  await tracker.tick();

  console.log(`- Status: ${order.status} (Expected: TP_SL_ACTIVE)`);
  console.log(`- Buy Execution Price: ${order.executionPrice} USDT (Expected: 1837)`);
  console.log(`- TP Sell Order ID: ${order.mexcSellOrderId}`);

  if (order.status !== 'TP_SL_ACTIVE' || order.executionPrice !== 1837.0) {
    console.error('FAIL: Rebound immediate execution failed.');
    process.exit(1);
  }

  // Step 6: Edge Case - Price rises past previous peak to 1842
  console.log('\n--------------------------------------------------');
  console.log('Resetting order state for Peak Edge Case test...');
  order.status = 'PENDING_ACTIVATION';
  order.peakPrice = 1839.0;
  order.activationPrice = 1829.0;
  order.localBottom = 1835.0; // old bottom
  
  mockClient.price = 1842.0;
  console.log(`Step 6: Price rises to ${mockClient.price} USDT (exceeds peak 1839). Ticking...`);
  await tracker.tick();

  console.log(`- Status: ${order.status}`);
  console.log(`- New Peak: ${order.peakPrice} USDT (Expected: 1842)`);
  console.log(`- New Activation Target: ${order.activationPrice} USDT (Expected: 1832)`);
  console.log(`- Reset Local Bottom: ${order.localBottom} USDT (Expected: 1842)`);

  if (order.peakPrice !== 1842.0 || order.localBottom !== 1842.0 || order.activationPrice !== 1832.0) {
    console.error('FAIL: Peak tracking local bottom reset failed.');
    process.exit(1);
  }

  // Step 7: Price drops to 1839 (dropping from 1842 peak, should update localBottom to 1839)
  mockClient.price = 1839.0;
  console.log(`\nStep 7: Price drops to ${mockClient.price} USDT. Ticking...`);
  await tracker.tick();
  console.log(`- Local Bottom: ${order.localBottom} USDT (Expected: 1839)`);
  
  // Tick at 1840 to check that it does NOT trigger false rebound (since rebound target from 1839 is 1841)
  mockClient.price = 1840.0;
  mockClient.bidsRatio = 0.60;
  console.log(`Ticking at ${mockClient.price} USDT...`);
  await tracker.tick();
  console.log(`- Status: ${order.status} (Expected: PENDING_ACTIVATION)`);

  if (order.status !== 'PENDING_ACTIVATION') {
    console.error('FAIL: False rebound triggered.');
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log('SUCCESS: ALL SCENARIOS (PATH A, PATH B, PEAK EDGES) VERIFIED 100%');
  console.log('==================================================');

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);
}

runTest().catch(err => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
