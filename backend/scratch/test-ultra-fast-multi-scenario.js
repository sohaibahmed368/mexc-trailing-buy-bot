const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('⚡ SUB-SECOND (800ms) ULTRA-FAST MULTI-SCENARIO MARKET AUDIT SUITE');
console.log('========================================================================\n');

class MockMultiScenarioClient {
  constructor() {
    this.priceMap = { 'BTCUSDT': 65000.0, 'SOLUSDT': 150.00 };
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
    return this.priceMap[symbol] || 150.00;
  }

  async getDepth(symbol, limit = 10) {
    return this.depthMap[symbol] || {
      bids: [['150.00', '10.0'], ['149.98', '5.0']],
      asks: [['150.04', '10.0'], ['150.06', '5.0']]
    };
  }

  async placeOrder(params) {
    const id = `fast_ord_${this.orderCounter++}`;
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

async function runMultiScenarioAudit() {
  const mockClient = new MockMultiScenarioClient();
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

  // --- REGIME 1: FAST PUMP (Sub-Second 800ms BUY Re-Peg & Fill) ---
  console.log('--- REGIME 1: Fast Flash Pump (Sub-Second 800ms BUY Re-Peg & Fill) ---');
  mockClient.priceMap['SOLUSDT'] = 150.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['150.00', '20.0'], ['149.98', '35.0']],
    asks: [['150.04', '15.0'], ['150.06', '25.0']]
  };

  const buyOrder1 = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '1.0',
    quoteOrderQty: '100.0',
    dryRun: false,
    takeProfit: null,
    stopLoss: '3.0',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  const buyCall1 = mockClient.placeCalls.find(c => c.side === 'BUY' && c.type === 'LIMIT');
  verify(buyCall1 !== undefined, 'Limit Buy placed via 800ms Sub-Second Engine');
  verify(buyCall1 && buyCall1.price === 149.99, `Limit Buy Price (${buyCall1 ? buyCall1.price : 0}) equal to Top Bids average (149.99)`);
  verify(buyCall1 && buyCall1.price < 150.04, `Strict Maker Check: Buy Price (${buyCall1 ? buyCall1.price : 0}) < Best Ask (150.04) ✅`);

  // --- REGIME 2: FAST CRASH / DUMP (Sub-Second 800ms STOP LOSS Sell) ---
  console.log('\n--- REGIME 2: Fast Flash Dump (Sub-Second 800ms STOP LOSS Sell) ---');
  mockClient.priceMap['SOLUSDT'] = 142.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['141.96', '12.0'], ['141.94', '20.0']],
    asks: [['142.00', '15.0'], ['142.02', '30.0']]
  };

  await tracker.tick();

  const slCall1 = mockClient.placeCalls.find(c => c.side === 'SELL' && c.type === 'LIMIT');
  verify(slCall1 !== undefined, 'Flash Crash Stop Loss LIMIT Sell placed via 800ms Engine');
  verify(slCall1 && slCall1.price === 142.01, `Stop Loss Sell Price (${slCall1 ? slCall1.price : 0}) equal to Top Asks average (142.01)`);
  verify(slCall1 && slCall1.price > 141.96, `Strict Maker Check: Sell Price (${slCall1 ? slCall1.price : 0}) > Best Bid (141.96) ✅`);

  // --- REGIME 3: SLOW CRAWL DUMP & MICRO-RECOVERY ---
  console.log('\n--- REGIME 3: Slow Crawl Dump & Micro-Recovery ---');
  mockClient.priceMap['SOLUSDT'] = 140.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['139.98', '5.0'], ['139.96', '10.0']],
    asks: [['140.02', '6.0'], ['140.04', '12.0']]
  };

  const buyOrder2 = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '0.1',
    quoteOrderQty: '100.0',
    dryRun: false,
    takeProfit: null,
    stopLoss: '0.5',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  const buyCall2 = mockClient.placeCalls.filter(c => c.side === 'BUY' && c.type === 'LIMIT')[1];
  verify(buyCall2 !== undefined, 'Slow Crawl Limit Buy placed via 800ms Engine');
  verify(buyCall2 && buyCall2.price === 139.97, `Slow Crawl Buy Price (${buyCall2 ? buyCall2.price : 0}) equal to Top Bids average (139.97)`);
  verify(buyCall2 && buyCall2.price < 140.02, `Strict Maker Check: Buy Price (${buyCall2 ? buyCall2.price : 0}) < Best Ask (140.02) ✅`);

  // --- REGIME 4: SUDDEN DUMP -> SLOW RECOVERY PUMP ---
  console.log('\n--- REGIME 4: Sudden Dump -> Slow Recovery Pump ---');
  mockClient.priceMap['SOLUSDT'] = 138.5;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['138.48', '15.0'], ['138.46', '25.0']],
    asks: [['138.52', '10.0'], ['138.54', '18.0']]
  };

  await tracker.tick();

  const slCalls2 = mockClient.placeCalls.filter(c => c.side === 'SELL' && c.type === 'LIMIT');
  const slCall2 = slCalls2[slCalls2.length - 1];
  verify(slCall2 !== undefined, 'Sudden Dump Stop Loss LIMIT Sell placed via 800ms Engine');
  verify(slCall2 && slCall2.price === 138.53, `Sudden Dump Sell Price (${slCall2 ? slCall2.price : 0}) equal to Top Asks average (138.53)`);
  verify(slCall2 && slCall2.price > 138.48, `Strict Maker Check: Sell Price (${slCall2 ? slCall2.price : 0}) > Best Bid (138.48) ✅`);

  console.log('\n========================================================================');
  console.log(`SUB-SECOND MULTI-SCENARIO AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runMultiScenarioAudit();
