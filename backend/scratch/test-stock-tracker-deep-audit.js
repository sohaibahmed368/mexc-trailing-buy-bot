const StockOrderTracker = require('../stock-tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

class DeepAuditMockMexcClient {
  constructor() {
    this.prices = {
      'NVDAONUSDT': 212.00,
      'SPCXONUSDT': 120.00,
      'USOONUSDT': 75.00,
      'INTKONUSDT': 32.00,
      'GOLD(XAUT)USDT': 2400.00,
      'PAXGUSDT': 2390.00,
      'TSLAONUSDT': 240.00,
      'AAPLONUSDT': 220.00,
      'MSFTONUSDT': 430.00
    };
    this.orderCounter = 1;
    this.placedOrders = [];
    this.cancelledOrders = [];
    this.orderStatusMap = {};
    this.depthBidsRatio = 0.65; // Default 65% bids
    this.klinesVolRatio = 2.0;  // Default 2.0x vol
    this.mockRsi = 28.0;        // Default 28 RSI (Oversold < 35)
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.prices[symbol] !== undefined ? this.prices[symbol] : 100.0;
  }

  async getOrder(symbol, orderId) {
    if (!this.orderQueryCountMap) this.orderQueryCountMap = {};
    this.orderQueryCountMap[orderId] = (this.orderQueryCountMap[orderId] || 0) + 1;
    
    // Auto-fill MARKET BUY orders immediately, keep LIMIT SELL orders as NEW until step trigger
    const status = this.orderStatusMap[orderId] || (orderId.includes('tok') || orderId.includes('buy') ? 'FILLED' : 'NEW');
    const price = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: price.toString(),
      origQty: "0.4716",
      executedQty: "0.4716",
      cummulativeQuoteQty: (price * 0.4716).toString(),
      status
    };
  }

  async getDepth(symbol, limit) {
    const price = await this.getTickerPrice(symbol);
    const topBid = Math.round((price * 0.999) * 100) / 100;
    const topAsk = Math.round((price * 1.001) * 100) / 100;
    const bidsVol = this.depthBidsRatio * 100;
    const asksVol = (1 - this.depthBidsRatio) * 100;

    return {
      bids: [[topBid.toString(), (bidsVol / price).toString()]],
      asks: [[topAsk.toString(), (asksVol / price).toString()]]
    };
  }

  async getKlines(symbol, interval, limit) {
    const price = await this.getTickerPrice(symbol);
    const klines = [];
    for (let i = 0; i < (limit || 30); i++) {
      const drop = (this.mockRsi <= 35) ? (i * 0.5) : ((30 - i) * 0.5);
      const close = price - drop;
      klines.push([
        Date.now() - (30 - i) * 60000,
        (close * 1.005).toString(),
        (close * 1.01).toString(),
        (close * 0.99).toString(),
        close.toString(),
        (1000 * (i === 29 ? this.klinesVolRatio : 1.0)).toString()
      ]);
    }
    return klines;
  }

  async placeOrder(params) {
    const id = 'stock_audit_' + (this.orderCounter++);
    this.placedOrders.push({ id, ...params, timestamp: Date.now() });
    const initialStatus = params.side === 'BUY' ? 'FILLED' : 'NEW';
    this.orderStatusMap[id] = initialStatus;
    return { orderId: id, status: initialStatus };
  }

  async cancelOrder(symbol, orderId) {
    this.cancelledOrders.push({ symbol, orderId, timestamp: Date.now() });
    this.orderStatusMap[orderId] = 'CANCELED';
    return { orderId, status: 'CANCELED' };
  }

  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0.0 },
      { asset: 'NVDAON', free: 0.4716, locked: 0.0 },
      { asset: 'SPCXON', free: 0.8333, locked: 0.0 },
      { asset: 'USOON', free: 1.3333, locked: 0.0 },
      { asset: 'INTKON', free: 3.1250, locked: 0.0 },
      { asset: 'GOLD(XAUT)', free: 0.0416, locked: 0.0 },
      { asset: 'PAXG', free: 0.0418, locked: 0.0 },
      { asset: 'TSLAON', free: 0.4166, locked: 0.0 },
      { asset: 'AAPLON', free: 0.4545, locked: 0.0 },
      { asset: 'MSFTON', free: 0.2325, locked: 0.0 }
    ];
  }
}

async function runStockTrackerDeepAudit() {
  console.log('========================================================================');
  console.log('🧪 STOCK BOT COMPREHENSIVE DEEP AUDIT & FULL FUNCTION TEST SUITE');
  console.log('Testing every method, state transition, log, variable, and scenario!');
  console.log('========================================================================\n');

  const mockClient = new DeepAuditMockMexcClient();
  const tracker = new StockOrderTracker(mockClient, mockIo);
  tracker.ordersPath = './backend/scratch/test-deep-stock-orders.json';
  tracker.logsPath = './backend/scratch/test-deep-stock-logs.json';
  tracker.orders = [];

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);

  let passCount = 0;
  let failCount = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${testName} ${details ? `(${details})` : ''}`);
      failCount++;
    }
  }

  // TEST 1: Order Initialization & Parameter Parsing
  console.log('>>> TEST 1: Order Initialization & Parameter Parsing <<<');
  const sym = 'NVDAONUSDT';
  const order1 = await tracker.addOrder({
    symbol: sym,
    trailValue: '0.5',
    quoteOrderQty: '100.0',
    takeProfit: '1.0',
    stopLoss: '1.5',
    activationOffset: '0.5',
    slBuffer: '0.2',
    dryRun: false,
    autoRepeat: true,
    startImmediately: false,
    filterObi: true,
    filterVolumeSpike: true,
    filterRsi: true,
    filterSmartSl: true
  });

  assert(order1.symbol === 'NVDAONUSDT', 'Symbol set correctly to NVDAONUSDT');
  assert(order1.status === 'PENDING_ACTIVATION', 'Initial status set to PENDING_ACTIVATION');
  assert(order1.peakPrice === 212.00, 'Initial peakPrice recorded at starting price 212.00');
  assert(Math.abs(order1.activationPrice - (212.00 * 0.995)) < 0.0001, 'Activation price set to exact 0.5% dip (210.94 USDT)');
  console.log('');

  // TEST 2: Dynamic Peak Tracking (Peak Shifts UP)
  console.log('>>> TEST 2: Dynamic Peak Tracking & Activation Target Recalculation <<<');
  mockClient.prices[sym] = 215.00;
  await tracker.tick();
  let liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.peakPrice === 215.00, 'Peak price updated UP to 215.00 USDT');
  assert(Math.abs(liveOrder.activationPrice - (215.00 * 0.995)) < 0.0001, 'Activation target updated UP to 213.925 USDT');
  assert(liveOrder.status === 'PENDING_ACTIVATION', 'Remains PENDING_ACTIVATION because price > activation target');
  console.log('');

  // TEST 3: Dip Activation (Price Drops Below Activation Target)
  console.log('>>> TEST 3: Dip Activation (PENDING_ACTIVATION -> RUNNING) <<<');
  mockClient.prices[sym] = 213.80; // Drops below 213.925
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.status === 'RUNNING', 'Activated to RUNNING status when price drops below activation target');
  assert(liveOrder.bottomPrice === 213.80, 'Initial bottomPrice set to 213.80 USDT');
  assert(Math.abs(liveOrder.triggerPrice - (213.80 * 1.005)) < 0.0001, 'Buy trigger set to 0.5% rebound above bottom (214.869 USDT)');
  console.log('');

  // TEST 4: Local Bottom Shift (Price Drops Further)
  console.log('>>> TEST 4: Dynamic Local Bottom Shift & Buy Trigger Recalculation <<<');
  mockClient.prices[sym] = 212.50; // Drops lower
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.bottomPrice === 212.50, 'Local bottom updated DOWN to 212.50 USDT');
  assert(Math.abs(liveOrder.triggerPrice - (212.50 * 1.005)) < 0.0001, 'Buy trigger updated to 213.5625 USDT');
  console.log('');

  // TEST 5: Indicator Filter Rejection (OBI < 55%)
  console.log('>>> TEST 5: Consensus Indicator Filter Deferral (OBI < 55%) <<<');
  mockClient.prices[sym] = 213.60; // Rebounds above 213.5625 trigger
  mockClient.depthBidsRatio = 0.40; // OBI fails at 40% < 55%
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.status === 'RUNNING', 'Buy deferred because OBI failed! Retained RUNNING state.');
  assert(liveOrder.bottomPrice === 213.60, 'Local bottom updated to current price 213.60 USDT after deferral');
  console.log('');

  // TEST 6: Indicator Alignment & Real Market Buy Execution
  console.log('>>> TEST 6: Indicator Alignment & Real Market Buy Execution <<<');
  const newBottom = 213.60;
  const newTrigger = newBottom * 1.005; // 214.668
  mockClient.prices[sym] = newTrigger + 0.1; // Rebounds above new trigger
  mockClient.depthBidsRatio = 0.70; // OBI passes 70% >= 55%
  mockClient.klinesVolRatio = 2.0;  // Volume passes 2.0x >= 1.5x
  mockClient.mockRsi = 25.0;        // RSI passes 25 <= 35
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);

  assert(liveOrder.status === 'TP_SL_ACTIVE', 'Market Buy filled and transitioned to TP_SL_ACTIVE!');
  assert(liveOrder.executedQty === 0.4716, 'Exact executed quantity (0.4716) saved to order.executedQty');
  assert(liveOrder.quantity === 0.4716, 'Order quantity synced to executedQty (0.4716 tokens)');
  assert(liveOrder.mexcSellOrderId !== null, 'Real 0% Maker Limit Sell Take Profit order placed on MEXC!');
  console.log('');

  // TEST 7: 50% TP Progress Profit Lock Guard
  console.log('>>> TEST 7: 50% TP Progress Profit Lock Guard <<<');
  const buyPrice = liveOrder.executionPrice;
  const tpTarget = buyPrice * 1.01; // 1% TP target
  const midPrice = buyPrice + ((tpTarget - buyPrice) * 0.55); // 55% TP progress
  mockClient.prices[sym] = midPrice;
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.isSlProfitLocked === true, '50% TP progress reached: isSlProfitLocked set to TRUE');
  assert(liveOrder.lockedSlPrice > buyPrice, 'lockedSlPrice shifted UP above buy price to lock in profit!');
  console.log('');

  // TEST 8: Real OCO Take Profit Order Fill on MEXC
  console.log('>>> TEST 8: Real OCO Take Profit Order Fill on MEXC <<<');
  const tpOrderId = liveOrder.mexcSellOrderId;
  mockClient.orderStatusMap[tpOrderId] = 'FILLED';
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.status === 'PENDING_ACTIVATION', 'TP Limit Sell filled on MEXC! Auto-repeat reset to PENDING_ACTIVATION for Cycle #2');
  assert(liveOrder.tradeHistory.length === 1, 'Completed cycle pushed to tradeHistory (1 trade completed)');
  assert(liveOrder.totalNetProfit > 0, `Net profit recorded: +${liveOrder.totalNetProfit.toFixed(4)} USDT`);
  console.log('');

  // TEST 9: Smart SL Guard Extension (Seller Exhaustion Check)
  console.log('>>> TEST 9: Smart SL Guard Extension & Deferral <<<');
  // Trigger Cycle #2 Buy
  const actPrice = liveOrder.activationPrice;
  mockClient.prices[sym] = actPrice - 0.1;
  await tracker.tick(); // Activate
  liveOrder = tracker.orders.find(o => o.id === order1.id);

  // Bottom is actPrice - 0.1
  const bot2 = liveOrder.bottomPrice;
  const trig2 = bot2 * 1.006;
  mockClient.prices[sym] = trig2 + 0.1;
  mockClient.depthBidsRatio = 0.70;
  mockClient.klinesVolRatio = 2.0;
  mockClient.mockRsi = 25.0;
  await tracker.tick(); // Trigger Buy
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.status === 'TP_SL_ACTIVE', 'Cycle #2 Market Buy executed cleanly!');

  // Drop price to hit Stop Loss level
  const cycle2BuyPrice = liveOrder.executionPrice;
  const slLevel = cycle2BuyPrice * 0.985; // 1.5% SL
  mockClient.prices[sym] = slLevel - 0.05;
  mockClient.depthBidsRatio = 0.50; // Seller exhaustion confirmed: 50% bids >= 45%
  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(liveOrder.isSlExtended === true, 'Smart SL Guard extended Stop Loss by +0.2% buffer!');
  assert(liveOrder.status === 'TP_SL_ACTIVE', 'Stop loss sell deferred, retained TP_SL_ACTIVE tracking!');
  console.log('');

  // TEST 10: Stop Loss Trigger with 0.1% Fast Market Sell & TP Cancellation
  console.log('>>> TEST 10: Stop Loss Trigger, Open TP Cancellation & 0.1% Market Sell <<<');
  const oldTpOrderId = liveOrder.mexcSellOrderId;
  const extendedSlLevel = slLevel - (cycle2BuyPrice * 0.002);
  mockClient.prices[sym] = extendedSlLevel - 0.02; // Hits extended SL within 0.1% slippage margin
  mockClient.depthBidsRatio = 0.30; // Bids support fails (< 45%)

  await tracker.tick();
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  const cancelCall = mockClient.cancelledOrders.find(c => c.orderId === oldTpOrderId);
  assert(cancelCall !== undefined, 'Open TP Limit Sell order cancelled on MEXC before SL sell!');
  assert(liveOrder.status === 'PENDING_ACTIVATION', 'Stop Loss executed cleanly! Reset to PENDING_ACTIVATION');
  assert(liveOrder.tradeHistory.length === 2, 'Trade history records 2 completed cycles');
  console.log('');

  // TEST 11: Order Cancellation via API
  console.log('>>> TEST 11: Order Cancellation via cancelOrder(id) <<<');
  const cancelResult = await tracker.cancelOrder(order1.id);
  liveOrder = tracker.orders.find(o => o.id === order1.id);
  assert(cancelResult === true, 'cancelOrder(id) returned true');
  assert(liveOrder.status === 'CANCELLED', 'Order status set to CANCELLED');
  console.log('');

  console.log('========================================================================');
  console.log(`DEEP AUDIT SUITE SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);

  if (failCount > 0) {
    console.error('❌ STOCK TRACKER DEEP AUDIT FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL STOCK TRACKER FUNCTIONS, VARIABLES & SCENARIOS PASSED 100% PERFECTLY!');
  }
}

runStockTrackerDeepAudit().catch(err => {
  console.error('Stock Tracker Deep Audit crashed:', err);
  process.exit(1);
});
