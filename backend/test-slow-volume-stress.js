const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🐌 ULTRA-SLOW VOLUME & MICRO-MOVEMENT STRESS TEST (100% MAKER CHECK)');
console.log('========================================================================\n');

class MockSlowVolumeMexcClient {
  constructor() {
    this.priceMap = { 'BTCUSDT': 65000.0, 'SOLUSDT': 150.00 };
    this.depthMap = {
      'SOLUSDT': {
        bids: [['150.0000', '0.50'], ['149.9999', '0.80']],
        asks: [['150.0002', '0.60'], ['150.0003', '0.90']]
      }
    };
    this.placeCalls = [];
    this.cancelCalls = [];
    this.orderCounter = 1;
    this.orderStatusMap = {};
  }

  hasCredentials() {
    return true;
  }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] || 150.00;
  }

  async getDepth(symbol, limit = 10) {
    return this.depthMap[symbol] || {
      bids: [['150.0000', '0.50'], ['149.9999', '0.80']],
      asks: [['150.0002', '0.60'], ['150.0003', '0.90']]
    };
  }

  async placeOrder(params) {
    const id = `slow_ord_${this.orderCounter++}`;
    const record = { id, ...params, timestamp: Date.now() };
    this.placeCalls.push(record);
    this.orderStatusMap[id] = {
      status: 'FILLED',
      price: params.price || 150.0,
      executedQty: params.quantity || '0.666',
      cummulativeQuoteQty: (parseFloat(params.quantity || '0.666') * parseFloat(params.price || '150.0')).toString()
    };
    return { orderId: id, status: 'FILLED' };
  }

  async cancelOrder(symbol, orderId) {
    this.cancelCalls.push({ symbol, orderId, timestamp: Date.now() });
    if (this.orderStatusMap[orderId]) {
      this.orderStatusMap[orderId].status = 'CANCELED';
    }
    return { symbol, orderId, status: 'CANCELED' };
  }

  async getOrder(symbol, orderId) {
    return this.orderStatusMap[orderId] || { status: 'FILLED', executedQty: '0.666', cummulativeQuoteQty: '100.0' };
  }

  async getBalances() {
    return [{ asset: 'SOL', free: 10.0, locked: 0.0 }];
  }

  async getKlines(symbol, interval, limit) {
    return Array(30).fill([0, 150, 150.01, 149.99, 150, 50]); // Ultra low volume
  }
}

async function runSlowVolumeStressTest() {
  const mockClient = new MockSlowVolumeMexcClient();
  const dummyIo = { emit: () => {} };
  const tracker = new OrderTracker(mockClient, dummyIo);

  let passCount = 0;
  let failCount = 0;

  function verify(condition, name) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`);
      failCount++;
    }
  }

  // --- STRESS TEST 1: ULTRA-SLOW BUY SIDE (TIGHT SPREAD $0.0002) ---
  console.log('--- STRESS TEST 1: Ultra-Slow Buy Side (Tight Spread $0.0002) ---');
  mockClient.priceMap['SOLUSDT'] = 150.0001;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['150.0000', '0.50'], ['149.9998', '0.80']],
    asks: [['150.0002', '0.60'], ['150.0004', '0.90']]
  };

  const buyOrder = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '0.05',
    quoteOrderQty: '100.0',
    dryRun: false,
    takeProfit: null,
    stopLoss: '0.10',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  const buyCall = mockClient.placeCalls.find(c => c.side === 'BUY' && c.type === 'LIMIT');
  verify(buyCall !== undefined, 'Slow Volume Limit Buy placed via Orderbook Depth');
  verify(buyCall && buyCall.price === 150.0, `Slow Volume Buy Price (${buyCall ? buyCall.price : 0}) equal to Top Bid (150.00)`);
  verify(buyCall && buyCall.price < 150.0002, `Strict Maker Check: Buy Price (${buyCall ? buyCall.price : 0}) < Best Ask (150.0002) ✅`);

  const filledOrder = tracker.orders.find(o => o.id === buyOrder.id);
  verify(filledOrder.status === 'TP_SL_ACTIVE', 'Order successfully transitioned to TP_SL_ACTIVE state in slow volume!');

  // --- STRESS TEST 2: ULTRA-SLOW STOP LOSS SELL SIDE ---
  console.log('\n--- STRESS TEST 2: Ultra-Slow Stop Loss Sell Side ---');
  
  // Micro price drop: Price crawls down to 149.89 (below 150.00 - 0.10 = 149.90 SL)
  mockClient.priceMap['SOLUSDT'] = 149.89;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['149.8898', '0.40'], ['149.8896', '0.70']],
    asks: [['149.8900', '0.50'], ['149.8902', '0.80']]
  };

  await tracker.tick();

  const slCall = mockClient.placeCalls.find(c => c.side === 'SELL' && c.type === 'LIMIT');
  verify(slCall !== undefined, 'Slow Volume Stop Loss LIMIT Sell placed via Orderbook Depth');
  verify(slCall && slCall.price === 149.89, `Slow Volume Sell Price (${slCall ? slCall.price : 0}) equal to Top Asks average (149.89)`);
  verify(slCall && slCall.price > 149.8898, `Strict Maker Check: Sell Price (${slCall ? slCall.price : 0}) > Best Bid (149.8898) ✅`);

  const completedOrder = tracker.orders.find(o => o.id === buyOrder.id);
  verify(completedOrder.status === 'PENDING_ACTIVATION' || completedOrder.status === 'TRIGGERED', 'Slow volume Stop Loss successfully executed as 100% MAKER (0% Fee)!');

  console.log('\n========================================================================');
  console.log(`SLOW VOLUME STRESS AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runSlowVolumeStressTest();
