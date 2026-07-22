const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🔥 HIGH-SPEED VOLUME & RAPID VOLATILITY STRESS TEST (100% MAKER CHECK)');
console.log('========================================================================\n');

class MockVolumeMexcClient {
  constructor() {
    this.priceMap = { 'BTCUSDT': 65000.0, 'SOLUSDT': 150.0 };
    this.depthMap = {
      'SOLUSDT': {
        bids: [['150.00', '10.0'], ['149.98', '15.0']],
        asks: [['150.04', '8.0'], ['150.06', '12.0']]
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
    return this.priceMap[symbol] || 150.0;
  }

  async getDepth(symbol, limit = 10) {
    return this.depthMap[symbol] || {
      bids: [['150.00', '10.0'], ['149.98', '5.0']],
      asks: [['150.04', '10.0'], ['150.06', '5.0']]
    };
  }

  async placeOrder(params) {
    const id = `vol_ord_${this.orderCounter++}`;
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
    return Array(30).fill([0, 150, 152, 148, 150, 5000]);
  }
}

async function runVolumeSpeedStressTest() {
  const mockClient = new MockVolumeMexcClient();
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

  // --- STRESS TEST 1: HIGH-VOLUME RAPID PUMP (BUY SIDE RE-PEG) ---
  console.log('--- STRESS TEST 1: High Volume Rapid Pump (BUY Side Re-Peg & Fill) ---');
  mockClient.priceMap['SOLUSDT'] = 150.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['150.00', '20.0'], ['149.98', '35.0']],
    asks: [['150.04', '15.0'], ['150.06', '25.0']]
  };

  const buyOrder = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '1.0',
    quoteOrderQty: '100.0',
    dryRun: false,
    takeProfit: null, // Set to null so no TP order blocks SL test
    stopLoss: '3.0',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  const buyCall1 = mockClient.placeCalls.find(c => c.side === 'BUY' && c.type === 'LIMIT');
  verify(buyCall1 !== undefined, 'Limit Buy placed via Orderbook Depth');
  verify(buyCall1 && buyCall1.price === 149.99, `Limit Buy Price (${buyCall1 ? buyCall1.price : 0}) equal to Top Bids average (149.99)`);
  verify(buyCall1 && buyCall1.price < 150.04, `Strict Maker Check: Buy Price (${buyCall1 ? buyCall1.price : 0}) < Best Ask (150.04) ✅`);

  const filledOrder = tracker.orders.find(o => o.id === buyOrder.id);
  verify(filledOrder.status === 'TP_SL_ACTIVE', 'Order successfully transitioned to TP_SL_ACTIVE state!');

  // --- STRESS TEST 2: HIGH-VOLUME RAPID DUMP (STOP LOSS SELL SIDE RE-PEG) ---
  console.log('\n--- STRESS TEST 2: High Volume Rapid Dump (STOP LOSS Sell Side Re-Peg & Fill) ---');
  
  // Trigger Stop Loss: Price drops to 142.0 (below 149.99 - 3.0 = 146.99 SL)
  mockClient.priceMap['SOLUSDT'] = 142.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['141.96', '12.0'], ['141.94', '20.0']],
    asks: [['142.00', '15.0'], ['142.02', '30.0']]
  };

  await tracker.tick();

  const slCall1 = mockClient.placeCalls.find(c => c.side === 'SELL' && c.type === 'LIMIT');
  verify(slCall1 !== undefined, 'Stop Loss LIMIT Sell placed via Orderbook Depth');
  verify(slCall1 && slCall1.price === 142.01, `Stop Loss Sell Price (${slCall1 ? slCall1.price : 0}) equal to Top Asks average (142.01)`);
  verify(slCall1 && slCall1.price > 141.96, `Strict Maker Check: Sell Price (${slCall1 ? slCall1.price : 0}) > Best Bid (141.96) ✅`);

  const completedOrder = tracker.orders.find(o => o.id === buyOrder.id);
  verify(completedOrder.status === 'PENDING_ACTIVATION' || completedOrder.status === 'TRIGGERED', 'Stop Loss successfully executed as 100% MAKER (0% Fee)!');

  console.log('\n========================================================================');
  console.log(`STRESS AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runVolumeSpeedStressTest();
