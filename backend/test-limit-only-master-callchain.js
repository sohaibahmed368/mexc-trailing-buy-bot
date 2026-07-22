const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🔥 100% LIMIT-ONLY MASTER CALL-CHAIN & MULTI-SCENARIO AUDIT SUITE');
console.log('========================================================================\n');

class CallChainAuditMexcClient {
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
    this.functionCalls = [];
    this.orderCounter = 1;
    this.orderStatusMap = {};
  }

  hasCredentials() {
    this.functionCalls.push('hasCredentials');
    return true;
  }

  async getTickerPrice(symbol) {
    this.functionCalls.push(`getTickerPrice:${symbol}`);
    return this.priceMap[symbol] || 150.00;
  }

  async getDepth(symbol, limit = 10) {
    this.functionCalls.push(`getDepth:${symbol}`);
    return this.depthMap[symbol] || {
      bids: [['150.00', '10.0'], ['149.98', '5.0']],
      asks: [['150.04', '10.0'], ['150.06', '5.0']]
    };
  }

  async placeOrder(params) {
    this.functionCalls.push(`placeOrder:${params.side}:${params.type}:${params.price}`);
    
    // STRICT ASSERTION: NO MARKET ORDERS ALLOWED EVER
    assert.strictEqual(params.type, 'LIMIT', `CRITICAL FAILURE: Market Order ${params.type} attempted! Must be LIMIT only!`);

    const id = `callchain_ord_${this.orderCounter++}`;
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
    this.functionCalls.push(`cancelOrder:${symbol}:${orderId}`);
    this.cancelCalls.push({ symbol, orderId, timestamp: Date.now() });
    if (this.orderStatusMap[orderId]) {
      this.orderStatusMap[orderId].status = 'CANCELED';
    }
    return { symbol, orderId, status: 'CANCELED' };
  }

  async getOrder(symbol, orderId) {
    this.functionCalls.push(`getOrder:${symbol}:${orderId}`);
    return this.orderStatusMap[orderId] || { status: 'FILLED', executedQty: '0.666', cummulativeQuoteQty: '100.0' };
  }

  async getBalances() {
    this.functionCalls.push('getBalances');
    return [{ asset: 'SOL', free: 10.0, locked: 0.0 }];
  }

  async getKlines(symbol, interval, limit) {
    this.functionCalls.push(`getKlines:${symbol}`);
    return Array(30).fill([0, 150, 152, 148, 150, 5000]);
  }

  async getTradeFee(symbol) {
    this.functionCalls.push(`getTradeFee:${symbol}`);
    return { makerCommission: '0.0000', takerCommission: '0.0005' };
  }
}

async function runMasterCallchainAudit() {
  const mockClient = new CallChainAuditMexcClient();
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

  // --- AUDIT SCENARIO 1: FAST PUMP (CALLCHAIN: addOrder -> calculateMakerPegPrice -> placeOrder -> waitForLimitOrderFill -> TP_SL_ACTIVE) ---
  console.log('--- SCENARIO 1: Fast Flash Pump & Complete Buy Call-Chain Audit ---');
  mockClient.priceMap['SOLUSDT'] = 150.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['150.00', '20.0'], ['149.98', '35.0']],
    asks: [['150.04', '15.0'], ['150.06', '25.0']]
  };

  const order1 = await tracker.addOrder({
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

  verify(mockClient.functionCalls.includes('getDepth:SOLUSDT'), 'Callchain Step 1: getDepth() called to fetch live orderbook');
  verify(mockClient.functionCalls.some(f => f.startsWith('placeOrder:BUY:LIMIT')), 'Callchain Step 2: placeOrder() called with type LIMIT (0% Fee)');

  const buyCall = mockClient.placeCalls.find(c => c.side === 'BUY');
  verify(buyCall !== undefined && buyCall.type === 'LIMIT', 'Verified: Buy Order is 100% LIMIT Order');
  verify(buyCall && buyCall.price < 150.04, `Strict Maker Rule: Buy Price (${buyCall ? buyCall.price : 0}) < Best Ask (150.04) ✅`);

  const filledOrder1 = tracker.orders.find(o => o.id === order1.id);
  verify(filledOrder1.status === 'TP_SL_ACTIVE', 'Callchain Step 3: Order state transitioned to TP_SL_ACTIVE after Limit fill');

  // --- AUDIT SCENARIO 2: FAST DUMP (CALLCHAIN: tick -> Stop Loss -> cancelOrder -> calculateMakerPegPrice -> placeOrder -> handleOrderCycleComplete) ---
  console.log('\n--- SCENARIO 2: Fast Flash Dump & Complete Stop Loss Sell Call-Chain Audit ---');
  mockClient.priceMap['SOLUSDT'] = 142.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['141.96', '12.0'], ['141.94', '20.0']],
    asks: [['142.00', '15.0'], ['142.02', '30.0']]
  };

  await tracker.tick();

  verify(mockClient.functionCalls.some(f => f.startsWith('placeOrder:SELL:LIMIT')), 'Callchain Step 4: Stop Loss triggered & placeOrder() called with type LIMIT');

  const slCall = mockClient.placeCalls.find(c => c.side === 'SELL');
  verify(slCall !== undefined && slCall.type === 'LIMIT', 'Verified: Stop Loss Order is 100% LIMIT Order');
  verify(slCall && slCall.price > 141.96, `Strict Maker Rule: Sell Price (${slCall ? slCall.price : 0}) > Best Bid (141.96) ✅`);

  verify(filledOrder1.status === 'PENDING_ACTIVATION', 'Callchain Step 5: handleOrderCycleComplete() reset order back to PENDING_ACTIVATION for auto-repeat');

  // --- AUDIT SCENARIO 3: SLOW DUMP -> SLOW RECOVERY PUMP ---
  console.log('\n--- SCENARIO 3: Slow Dump -> Slow Recovery Pump Audit ---');
  mockClient.priceMap['SOLUSDT'] = 138.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['137.98', '5.0'], ['137.96', '10.0']],
    asks: [['138.02', '6.0'], ['138.04', '12.0']]
  };

  // Reset order to RUNNING for dip trigger
  filledOrder1.status = 'RUNNING';
  filledOrder1.bottomPrice = 137.5;
  filledOrder1.triggerPrice = 138.0;

  const startCount3 = mockClient.placeCalls.length;
  await tracker.tick();

  const newBuyCalls = mockClient.placeCalls.slice(startCount3).filter(c => c.side === 'BUY');
  const buyCall3 = newBuyCalls[newBuyCalls.length - 1];
  verify(buyCall3 !== undefined && buyCall3.type === 'LIMIT', 'Slow Crawl Dip triggered & placed 100% LIMIT Buy');
  verify(buyCall3 && buyCall3.price < 138.02, `Slow Crawl Maker Rule: Buy Price (${buyCall3 ? buyCall3.price : 0}) < Best Ask (138.02) ✅`);

  // --- AUDIT SCENARIO 4: FAST PUMP -> SLOW BLEED DUMP ---
  console.log('\n--- SCENARIO 4: Fast Pump -> Slow Bleed Dump Audit ---');
  mockClient.priceMap['SOLUSDT'] = 132.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['131.96', '10.0'], ['131.94', '15.0']],
    asks: [['132.00', '12.0'], ['132.02', '20.0']]
  };

  filledOrder1.status = 'TP_SL_ACTIVE';
  filledOrder1.lockedSlPrice = 135.0;

  const startCount4 = mockClient.placeCalls.length;
  await tracker.tick();

  const newSellCalls = mockClient.placeCalls.slice(startCount4).filter(c => c.side === 'SELL');
  const sellCall2 = newSellCalls[newSellCalls.length - 1];
  verify(sellCall2 !== undefined && sellCall2.type === 'LIMIT', 'Slow Bleed Stop Loss triggered & placed 100% LIMIT Sell');
  verify(sellCall2 && sellCall2.price > 131.96, `Slow Bleed Maker Rule: Sell Price (${sellCall2 ? sellCall2.price : 0}) > Best Bid (131.96) ✅`);

  // --- AUDIT SCENARIO 5: MID-LEVEL NORMAL RANGE VOLATILITY AUDIT ---
  console.log('\n--- SCENARIO 5: Mid-Level Normal Range Volatility Audit ---');
  mockClient.priceMap['SOLUSDT'] = 125.0;
  mockClient.depthMap['SOLUSDT'] = {
    bids: [['124.98', '15.0'], ['124.96', '25.0']],
    asks: [['125.02', '18.0'], ['125.04', '30.0']]
  };

  await tracker.tick();

  const allPlaceCalls = mockClient.placeCalls;
  const marketOrders = allPlaceCalls.filter(c => c.type === 'MARKET');
  verify(marketOrders.length === 0, 'ZERO MARKET ORDERS: Confirmed 100% Limit Orders across all 5 Market Regimes!');

  console.log('\n========================================================================');
  console.log(`MASTER CALL-CHAIN AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runMasterCallchainAudit();
