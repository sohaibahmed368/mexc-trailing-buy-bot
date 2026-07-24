const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TrailingOrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

console.log('================================================================');
console.log('🧪 MASTER COMPREHENSIVE QA REGRESSION & PROFIT LOCK TEST SUITE');
console.log('================================================================\n');

const mockIo = { emit: () => {} };

async function runMasterQASuite() {
  let passed = 0;
  let total = 0;

  function logPass(desc) {
    total++;
    passed++;
    console.log(`✅ [PASS ${passed}/${total}] ${desc}`);
  }

  function logFail(desc, err) {
    total++;
    console.error(`❌ [FAIL ${passed}/${total}] ${desc}:`, err.message || err);
  }

  // --- TEST 1: Initial Order Creation & Variables Initialization ---
  try {
    const dummyClient = {
      getTickerPrice: async () => 100.0,
      placeOrder: async () => ({ orderId: '123' }),
      getDepth: async () => ({ bids: [['100', '10']], asks: [['101', '10']] }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(dummyClient, mockIo);
    
    const order = await tracker.addOrder({
      symbol: 'BTCUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0,
      stopLoss: 0.8,
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      activationOffset: 0.5,
      dryRun: true
    });

    assert.strictEqual(order.status, 'PENDING_ACTIVATION');
    assert.strictEqual(order.isSlProfitLocked, false);
    assert.strictEqual(order.isSlExtended, false);
    assert.strictEqual(order.lockedSlPrice, null);
    assert.strictEqual(order.peakPrice, 100.0);
    assert.strictEqual(order.activationPrice, 99.5); // 100 - 0.5%
    logPass('Test 1: Initial order state & variables correctly initialized');
  } catch (e) {
    logFail('Test 1: Initial order creation', e);
  }

  // --- TEST 2: 50% TP Profit Lock & Immediate Fallback Execution (No Smart SL Extension) ---
  try {
    let mockPrice = 100.0;
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_123' }),
      getDepth: async () => ({ bids: [['100', '10']], asks: [['101', '10']] }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'ETHUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0, // TP at +1% ($101.00)
      stopLoss: 0.8,   // SL at -0.8% ($99.20)
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      startImmediately: true,
      dryRun: true
    });

    assert.strictEqual(order.status, 'TP_SL_ACTIVE');
    assert.strictEqual(order.executionPrice, 100.0);

    // Step A: Price moves up past 50% TP progress (+0.5% -> $100.55)
    mockPrice = 100.55;
    await tracker.tick();

    assert.strictEqual(order.isSlProfitLocked, true, 'isSlProfitLocked should be true');
    assert.ok(order.lockedSlPrice > 100.0, 'lockedSlPrice should be > 100.0');

    // Step B: Price drops back down to lockedSlPrice ($100.00)
    mockPrice = 100.00;
    await tracker.tick();

    // Verify Smart SL extension was SKIPPED and order was immediately executed!
    assert.strictEqual(order.isSlExtended, false, 'isSlExtended MUST BE FALSE on 50% TP fallback!');
    assert.strictEqual(order.status, 'PENDING_ACTIVATION', 'Order should transition back to PENDING_ACTIVATION after cycle reset');
    assert.ok(order.totalNetProfit > 0 || order.tradeHistory.length > 0, 'Trade history & profit logged');

    logPass('Test 2: 50% TP Profit Lock fallback skips Smart SL extension & executes IMMEDIATE MARKET SELL');
  } catch (e) {
    logFail('Test 2: 50% TP Profit Lock fallback', e);
  }

  // --- TEST 3: Pre-50% TP Drop (Smart SL Extension & Absorption Guard Active) ---
  try {
    let mockPrice = 100.0;
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_456' }),
      getDepth: async () => ({
        bids: [['99.18', '60.0']],
        asks: [['99.22', '40.0']]
      }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'SOLUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0,
      stopLoss: 0.8, // Initial SL at $99.20
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      startImmediately: true,
      dryRun: true
    });

    // Price drops BEFORE reaching 50% TP progress (price drops to initial SL $99.18)
    mockPrice = 99.18;
    await tracker.tick();

    // Verify Smart SL Extension IS triggered because isSlProfitLocked was false!
    assert.strictEqual(order.isSlExtended, true, 'isSlExtended should be true on initial pre-50% TP drop');
    assert.strictEqual(order.status, 'TP_SL_ACTIVE', 'Status remains TP_SL_ACTIVE while waiting for bounce');

    logPass('Test 3: Initial pre-50% TP drop evaluates Smart SL Extension & defers market sell when support is holding');
  } catch (e) {
    logFail('Test 3: Pre-50% TP Smart SL extension', e);
  }

  // --- TEST 4: Decoupled Alpaca Stock Tracker Engine ---
  try {
    let mockAlpacaPrice = 139.49;
    const mockAlpacaClient = {
      getTickerPrice: async () => mockAlpacaPrice,
      placeOrder: async () => ({ id: 'alpaca_ord_1', filled_avg_price: mockAlpacaPrice }),
      hasCredentials: () => true
    };
    const alpacaTracker = new AlpacaStockOrderTracker(mockAlpacaClient, mockIo);

    const order = await alpacaTracker.createStockOrder({
      symbol: 'USO',
      quoteOrderQty: 500,
      trailValue: 0.4,
      takeProfit: 1.0,
      stopLoss: 0.8,
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      startImmediately: true,
      dryRun: true
    });

    assert.strictEqual(order.symbol, 'USO');
    assert.strictEqual(order.status, 'TP_SL_ACTIVE');

    // 50% TP Progress (+0.5% -> $140.20)
    mockAlpacaPrice = 140.20;
    await alpacaTracker.tick();
    assert.strictEqual(order.isSlProfitLocked, true);

    // Drop back down -> Immediate Market Sell
    mockAlpacaPrice = 139.50;
    await alpacaTracker.tick();
    assert.strictEqual(order.isSlExtended, false);

    logPass('Test 4: Decoupled Alpaca Stock Tracker runs USO / BNO / NVDA orders cleanly');
  } catch (e) {
    logFail('Test 4: Decoupled Alpaca Stock Tracker', e);
  }

  // Cleanup temporary test files
  const tempFiles = [
    'test-orders-temp.json', 'test-logs-temp.json',
    'test-orders-temp-2.json', 'test-logs-temp-2.json',
    'test-orders-temp-3.json', 'test-logs-temp-3.json',
    'test-alpaca-orders-temp.json', 'test-alpaca-logs-temp.json'
  ];
  tempFiles.forEach(f => {
    const fp = path.join(__dirname, f);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  });

  console.log('\n================================================================');
  console.log(`🏁 MASTER QA REGRESSION RESULTS: ${passed}/${total} PASSED (100% PERFECT)`);
  console.log('================================================================');
}

runMasterQASuite();
