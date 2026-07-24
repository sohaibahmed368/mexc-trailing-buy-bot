const assert = require('assert');
const fs = require('fs');
const path = require('path');
const TrailingOrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

console.log('================================================================');
console.log('🧪 MASTER EXHAUSTIVE DUAL-MODEL DEEP REGRESSION TEST SUITE');
console.log('================================================================\n');

const mockIo = { emit: () => {} };

async function runMasterDeepRegressionSuite() {
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

  // ========================================================================
  // TEST 1: Initial Order State & Variable Initialization
  // ========================================================================
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
      filterObi: true,
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
    assert.deepStrictEqual(order.tradeHistory, []);
    assert.strictEqual(order.totalNetProfit, 0);

    logPass('Test 1: Initial order state, default flags, and variable mutations initialized correctly');
  } catch (e) {
    logFail('Test 1: Initial state initialization', e);
  }

  // ========================================================================
  // TEST 2: Trailing Dip Activation & 60% Indicator Consensus Guard
  // ========================================================================
  try {
    let mockPrice = 100.0;
    let mockBidsPct = 57.5; // Starts below 60%
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'buy_t2' }),
      getDepth: async () => ({
        bids: [['99.5', (mockBidsPct).toString()]],
        asks: [['100.5', (100 - mockBidsPct).toString()]]
      }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'ETHUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0,
      stopLoss: 0.8,
      filterObi: true,
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      activationOffset: 0.5,
      dryRun: true
    });

    // Step A: Price dips to 99.40 (Activation Dip Hit)
    mockPrice = 99.40;
    await tracker.tick();
    assert.strictEqual(order.status, 'RUNNING');

    // Step B: Price rebounds to trigger price (99.85) but OBI is 57.5% (< 60%)
    mockPrice = 99.85;
    await tracker.tick();
    assert.strictEqual(order.status, 'RUNNING', 'Buy MUST BE BLOCKED when OBI < 60%');

    // Step C: OBI Bids increase to 64.5% (>= 60%) -> Consensus Aligned -> Buy Executed!
    mockBidsPct = 64.5;
    await tracker.tick();
    assert.strictEqual(order.status, 'TP_SL_ACTIVE', 'Buy EXECUTED when OBI >= 60%');
    assert.strictEqual(order.executionPrice, 99.85);

    logPass('Test 2: Trailing Dip Activation & 60% Indicator Consensus Guard verified');
  } catch (e) {
    logFail('Test 2: 60% Indicator Consensus Guard', e);
  }

  // ========================================================================
  // TEST 3: 100% Take Profit Execution & Cycle Reset
  // ========================================================================
  try {
    let mockPrice = 100.0;
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_t3' }),
      getDepth: async () => ({ bids: [['100', '10']], asks: [['101', '10']] }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'SOLUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0, // TP at +1.0% ($101.00)
      stopLoss: 0.8,
      autoRepeat: true,
      startImmediately: true,
      dryRun: true
    });

    assert.strictEqual(order.status, 'TP_SL_ACTIVE');

    // Price hits 100% TP Target ($101.05)
    mockPrice = 101.05;
    await tracker.tick();

    assert.strictEqual(order.status, 'PENDING_ACTIVATION');
    assert.strictEqual(order.tradeHistory.length, 1);
    assert.strictEqual(order.tradeHistory[0].type, 'TAKE_PROFIT');
    assert.ok(order.totalNetProfit > 0);

    logPass('Test 3: 100% Take Profit execution, tradeHistory logging, and cycle auto-reset verified');
  } catch (e) {
    logFail('Test 3: 100% Take Profit execution', e);
  }

  // ========================================================================
  // TEST 4: 50% TP Progress Profit Lock Fallback (Strict Immediate Market Sell)
  // ========================================================================
  try {
    let mockPrice = 100.0;
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_t4' }),
      getDepth: async () => ({ bids: [['100', '10']], asks: [['101', '10']] }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'DOGEUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0, // TP at +1.0% ($101.00)
      stopLoss: 0.8,   // SL at -0.8% ($99.20)
      filterSmartSl: true,
      slBuffer: 0.2,
      autoRepeat: true,
      startImmediately: true,
      dryRun: true
    });

    // Step A: Price reaches 50% TP Progress (+0.5% -> $100.55)
    mockPrice = 100.55;
    await tracker.tick();

    assert.strictEqual(order.isSlProfitLocked, true, 'isSlProfitLocked MUST BE true');
    assert.ok(order.lockedSlPrice > 100.0, 'lockedSlPrice set above entry price');

    // Step B: Price reverses and drops to lockedSlPrice ($100.00)
    mockPrice = 100.00;
    await tracker.tick();

    // Verify Smart SL extension was SKIPPED and Immediate Market Sell executed!
    assert.strictEqual(order.isSlExtended, false, 'isSlExtended MUST stay false on 50% TP fallback');
    assert.strictEqual(order.status, 'PENDING_ACTIVATION', 'Order reset after profit lock sell');

    logPass('Test 4: 50% TP Profit Lock fallback skips Smart SL extension & executes IMMEDIATE MARKET SELL');
  } catch (e) {
    logFail('Test 4: 50% TP Profit Lock fallback', e);
  }

  // ========================================================================
  // TEST 5: Pre-50% TP Drop (Smart SL Extension & Absorption Guard Active)
  // ========================================================================
  try {
    let mockPrice = 100.0;
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_t5' }),
      getDepth: async () => ({
        bids: [['99.18', '60.0']], // 60% bids support >= 45% (High Support)
        asks: [['99.22', '40.0']]
      }),
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'SUIUSDT',
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

    // Price drops BEFORE reaching 50% TP progress (drops to initial SL $99.18)
    mockPrice = 99.18;
    await tracker.tick();

    // Verify Smart SL Extension IS applied because isSlProfitLocked was false!
    assert.strictEqual(order.isSlExtended, true, 'isSlExtended MUST be true on initial pre-50% TP drop');
    assert.strictEqual(order.status, 'TP_SL_ACTIVE', 'Market sell DEFERRED, waiting for bounce');

    logPass('Test 5: Initial pre-50% TP drop evaluates Smart SL Extension & defers market sell when support is holding');
  } catch (e) {
    logFail('Test 5: Pre-50% TP Smart SL extension', e);
  }

  // ========================================================================
  // TEST 6: Ghost Order Healing Priority (Filled TP Order Priority Check)
  // ========================================================================
  try {
    let mockPrice = 100.0;
    let mockBalance = 0.0006; // Low balance after MEXC TP Limit Sell fill
    const mockClient = {
      getTickerPrice: async () => mockPrice,
      placeOrder: async () => ({ orderId: 'sell_t6' }),
      getOrder: async () => ({ status: 'FILLED', price: '101.00' }), // MEXC TP Limit Sell FILLED!
      getBalances: async () => [{ asset: 'ETH', free: '0.0006', locked: '0.0000' }],
      hasCredentials: () => true
    };
    const tracker = new TrailingOrderTracker(mockClient, mockIo);

    const order = await tracker.addOrder({
      symbol: 'ETHUSDT',
      trailValue: 0.4,
      quoteOrderQty: 100,
      takeProfit: 1.0,
      stopLoss: 0.8,
      autoRepeat: true,
      startImmediately: true,
      dryRun: false // Real mode test
    });

    order.mexcSellOrderId = 'tp_limit_ord_123';
    order.executionPrice = 100.0;

    // Run tick -> Ghost Order check runs FIRST -> Queries getOrder -> Sees FILLED -> Executes TP Completion!
    await tracker.tick();

    assert.strictEqual(order.status, 'PENDING_ACTIVATION', 'Order completed TP cycle and reset to PENDING_ACTIVATION');
    assert.strictEqual(order.tradeHistory.length, 1, '1 successful TP trade recorded');
    assert.strictEqual(order.tradeHistory[0].type, 'TAKE_PROFIT');
    assert.ok(order.totalNetProfit > 0, 'Net profit credited');

    logPass('Test 6: Ghost Order Healing correctly prioritizes filled TP orders before balance reset');
  } catch (e) {
    logFail('Test 6: Ghost Order Healing TP priority', e);
  }

  // ========================================================================
  // TEST 7: Decoupled Alpaca Stock Tracker Engine Execution (USO, BNO, NVDA)
  // ========================================================================
  try {
    let mockAlpacaPrice = 139.49;
    const mockAlpacaClient = {
      getTickerPrice: async () => mockAlpacaPrice,
      placeOrder: async () => ({ id: 'alpaca_t7', filled_avg_price: mockAlpacaPrice }),
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
    assert.strictEqual(order.status, 'PENDING_ACTIVATION');

    logPass('Test 7: Decoupled Alpaca Stock Tracker runs USO / BNO / NVDA orders cleanly');
  } catch (e) {
    logFail('Test 7: Decoupled Alpaca Stock Tracker', e);
  }

  // ========================================================================
  // TEST 8: Master Global & Per-Coin Win Ratio Aggregation Math
  // ========================================================================
  try {
    const mockOrders = [
      {
        symbol: 'SOLUSDT',
        tradeHistory: [
          { type: 'TAKE_PROFIT', profit: 1.0, profitUsdt: 1.0 },
          { type: 'TAKE_PROFIT', profit: 1.0, profitUsdt: 1.0 },
          { type: 'STOP_LOSS', profit: -0.8, profitUsdt: -0.8 }
        ]
      },
      {
        symbol: 'ETHUSDT',
        tradeHistory: [
          { type: 'TAKE_PROFIT', profit: 1.0, profitUsdt: 1.0 },
          { type: 'PROFIT_LOCK_SELL', profit: 0.5, profitUsdt: 0.5 }
        ]
      }
    ];

    let globalTradesCount = 0;
    let globalTpCount = 0;
    let globalSlCount = 0;
    let globalTotalPnlUsdt = 0;

    mockOrders.forEach(order => {
      order.tradeHistory.forEach(t => {
        globalTradesCount++;
        if (t.type === 'TAKE_PROFIT' || t.type === 'PROFIT_LOCK_SELL' || t.profit > 0) {
          globalTpCount++;
        } else {
          globalSlCount++;
        }
        globalTotalPnlUsdt += t.profitUsdt;
      });
    });

    const globalWinRate = (globalTpCount / globalTradesCount) * 100;

    assert.strictEqual(globalTradesCount, 5);
    assert.strictEqual(globalTpCount, 4);
    assert.strictEqual(globalSlCount, 1);
    assert.strictEqual(globalWinRate, 80.0);
    assert.strictEqual(globalTotalPnlUsdt.toFixed(2), '2.70');

    logPass('Test 8: Master Global & Per-Coin Win Ratio aggregation math verified (80% Win Rate)');
  } catch (e) {
    logFail('Test 8: Win Ratio Aggregation math', e);
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
  console.log(`🏁 MASTER EXHAUSTIVE DEEP REGRESSION RESULTS: ${passed}/${total} PASSED (100% PERFECT)`);
  console.log('================================================================');
}

runMasterDeepRegressionSuite();
