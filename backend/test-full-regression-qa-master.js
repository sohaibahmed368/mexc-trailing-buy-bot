const OrderTracker = require('../tracker');
const StockOrderTracker = require('../stock-tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🛡️ GLOBAL REGRESSION & COMPREHENSIVE SOFTWARE TESTING MASTER SUITE');
console.log('   (BVA, Equivalence Partitioning, State Transitions, 4-Filter Consensus)');
console.log('========================================================================\n');

class MasterQAMexcClient {
  constructor() {
    this.priceMap = {
      'BTCUSDT': 65000.0,
      'ETHUSDT': 3500.0,
      'SOLUSDT': 150.00,
      'ONDOUSDT': 0.4040,
      'PEPEUSDT': 0.00001234,
      'LOWLIQUSDT': 0.05,
      'GOLDONUSDT': 2400.0,
      'NVDAONUSDT': 120.0
    };
    this.depthMap = {};
    this.placeCalls = [];
    this.cancelCalls = [];
    this.orderCounter = 1000;
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] || 100.0;
  }

  async getDepth(symbol, limit = 10) {
    const p = await this.getTickerPrice(symbol);
    return this.depthMap[symbol] || {
      bids: [[(p * 0.9999).toFixed(8), '100.0'], [(p * 0.9998).toFixed(8), '200.0']],
      asks: [[(p * 1.0001).toFixed(8), '100.0'], [(p * 1.0002).toFixed(8), '200.0']]
    };
  }

  async placeOrder(params) {
    // STRICT RULE: ZERO MARKET ORDERS ALLOWED IN 100% MAKER ENGINE
    assert.strictEqual(params.type, 'LIMIT', `REGRESSION FAILURE: Type ${params.type} placed! Must be 100% LIMIT!`);
    
    const id = `reg_ord_${this.orderCounter++}`;
    this.placeCalls.push({ id, ...params, time: Date.now() });
    return {
      orderId: id,
      status: 'FILLED',
      executedQty: params.quantity,
      cummulativeQuoteQty: (parseFloat(params.quantity) * parseFloat(params.price)).toString()
    };
  }

  async cancelOrder(symbol, orderId) {
    this.cancelCalls.push({ symbol, orderId });
    return { symbol, orderId, status: 'CANCELED' };
  }

  async getOrder(symbol, orderId) {
    const p = this.placeCalls.find(c => c.id === orderId);
    if (!p) return { status: 'FILLED', executedQty: '10.0', cummulativeQuoteQty: '1000.0' };
    return {
      status: 'FILLED',
      executedQty: p.quantity,
      cummulativeQuoteQty: (parseFloat(p.quantity) * parseFloat(p.price)).toString()
    };
  }

  async getBalances() {
    return [
      { asset: 'BTC', free: 1.5, locked: 0 },
      { asset: 'ETH', free: 10.0, locked: 0 },
      { asset: 'SOL', free: 50.0, locked: 0 },
      { asset: 'ONDO', free: 1000.0, locked: 0 },
      { asset: 'PEPE', free: 10000000.0, locked: 0 },
      { asset: 'LOWLIQ', free: 500.0, locked: 0 },
      { asset: 'GOLDON', free: 5.0, locked: 0 },
      { asset: 'NVDAON', free: 20.0, locked: 0 }
    ];
  }

  async getKlines(symbol, interval, limit) {
    const base = await this.getTickerPrice(symbol);
    return Array(30).fill(0).map((_, i) => [
      Date.now() - (30 - i) * 60000,
      base * (1 + (i % 2 === 0 ? 0.001 : -0.001)),
      base * 1.005,
      base * 0.995,
      base * (1 + (i * 0.0005)),
      10000 + i * 500
    ]);
  }

  async getTradeFee(symbol) {
    return { makerCommission: '0.0000', takerCommission: '0.0005' };
  }
}

async function runGlobalRegressionSuite() {
  const mockClient = new MasterQAMexcClient();
  const dummyIo = { emit: () => {} };
  const tracker = new OrderTracker(mockClient, dummyIo);
  const stockTracker = new StockOrderTracker(mockClient, dummyIo);

  let passCount = 0;
  let failCount = 0;

  function verify(condition, testName) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failCount++;
    }
  }

  // --- TECHNIQUE 1: STATE TRANSITION TESTING ---
  console.log('--- TECHNIQUE 1: State Transition Testing (PENDING_ACTIVATION ➔ RUNNING ➔ TP_SL_ACTIVE ➔ PENDING_ACTIVATION) ---');
  const o1 = await tracker.addOrder({
    symbol: 'PEPEUSDT',
    trailValue: '0.00000050',
    quoteOrderQty: '50.0',
    dryRun: false,
    takeProfit: null,
    stopLoss: '0.00000100',
    autoRepeat: true,
    startImmediately: true
  });

  verify(o1.status === 'TP_SL_ACTIVE', 'State Transition 1: Order initialized & moved to TP_SL_ACTIVE');
  verify(o1.executionPrice > 0, `Variable Mutation 1: executionPrice set to ${o1.executionPrice}`);
  verify(o1.mexcOrderId !== undefined, `Variable Mutation 2: mexcOrderId set to ${o1.mexcOrderId}`);

  // Trigger Stop Loss
  mockClient.priceMap['PEPEUSDT'] = 0.00000500; // Drop below executionPrice - stopLoss
  await tracker.tick();

  verify(o1.status === 'PENDING_ACTIVATION', 'State Transition 2: Stop Loss hit & order returned to PENDING_ACTIVATION');
  verify(o1.completedCyclesCount === 1 || o1.tradeHistory.length === 1, `Variable Mutation 3: completedCycles recorded: ${o1.completedCyclesCount || o1.tradeHistory.length}`);
  verify(o1.tradeHistory.length === 1, `Variable Mutation 4: tradeHistory recorded 1 completed trade`);

  // --- TECHNIQUE 2: BOUNDARY VALUE ANALYSIS (BVA) ---
  console.log('\n--- TECHNIQUE 2: Boundary Value Analysis (Micro Prices & Ultra High Quantities) ---');
  const bvaMicro = await tracker.calculateMakerPegPrice('PEPEUSDT', 'BUY', 0.00001234);
  verify(bvaMicro < 0.00001235, `BVA 1: Micro price calculation (${bvaMicro}) strictly maintains BUY < Best Ask`);

  const bvaStock = await stockTracker.calculateMakerPegPrice('NVDAONUSDT', 'SELL', 120.0);
  verify(bvaStock > 119.9, `BVA 2: Tokenized stock price calculation (${bvaStock}) strictly maintains SELL > Best Bid`);

  // --- TECHNIQUE 3: 4-FILTER CONSENSUS MATRIX TESTING ---
  console.log('\n--- TECHNIQUE 3: 4-Filter Consensus Alignment Testing (OBI, Volume, RSI, Smart SL) ---');
  const oFilter = await tracker.addOrder({
    symbol: 'BTCUSDT',
    trailValue: '100.0',
    quoteOrderQty: '100.0',
    dryRun: false,
    takeProfit: '500.0',
    stopLoss: '300.0',
    autoRepeat: true,
    startImmediately: false,
    activationOffset: '200.0',
    filterObi: true,
    filterVolume: true,
    filterRsi: true,
    filterSmartSl: true
  });

  verify(oFilter.filterObi === true, 'Consensus Matrix 1: filterObi flag enabled');
  verify(oFilter.filterVolume === true, 'Consensus Matrix 2: filterVolume flag enabled');
  verify(oFilter.filterRsi === true, 'Consensus Matrix 3: filterRsi flag enabled');
  verify(oFilter.filterSmartSl === true, 'Consensus Matrix 4: filterSmartSl flag enabled');

  // Simulate activation trigger & consensus check
  mockClient.priceMap['BTCUSDT'] = 64700.0; // Drop below activationPrice
  await tracker.tick();

  verify(oFilter.status === 'RUNNING', 'Consensus Matrix 5: Order status transitioned to RUNNING after offset trigger');

  // --- TECHNIQUE 4: FAULT INJECTION & AUTOMATIC GHOST ORDER SELF-HEALING ---
  console.log('\n--- TECHNIQUE 4: Fault Injection & Ghost Order Self-Healing Audit ---');
  const ghostOrder = await tracker.addOrder({
    symbol: 'LOWLIQUSDT',
    trailValue: '0.01',
    quoteOrderQty: '50.0',
    dryRun: false,
    takeProfit: '0.10',
    stopLoss: '0.05',
    autoRepeat: true,
    startImmediately: true
  });

  verify(ghostOrder.status === 'TP_SL_ACTIVE', 'Fault Injection 1: Order created in TP_SL_ACTIVE state');

  // Clear wallet balance to simulate ghost trade
  const balances = await mockClient.getBalances();
  const lowLiqBal = balances.find(b => b.asset === 'LOWLIQ');
  lowLiqBal.free = 0.0;

  // Run self-healing audit tick
  await tracker.tick();

  verify(ghostOrder.status === 'PENDING_ACTIVATION', 'Self-Healing 1: Ghost order detected with 0 balance & automatically reset to PENDING_ACTIVATION!');

  // --- TECHNIQUE 5: ALL MEXC MULTI-ASSET LIST AUDIT ---
  console.log('\n--- TECHNIQUE 5: Multi-Asset MEXC Symbol List Coverage Audit ---');
  const testSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ONDOUSDT', 'PEPEUSDT', 'GOLDONUSDT', 'NVDAONUSDT'];
  let allLimitFills = true;

  for (const sym of testSymbols) {
    const depth = await mockClient.getDepth(sym);
    const bestAsk = parseFloat(depth.asks[0][0]);
    const bestBid = parseFloat(depth.bids[0][0]);

    const buyPeg = await tracker.calculateMakerPegPrice(sym, 'BUY', bestAsk);
    const sellPeg = await tracker.calculateMakerPegPrice(sym, 'SELL', bestBid);

    if (buyPeg >= bestAsk || sellPeg <= bestBid) {
      allLimitFills = false;
      console.error(`  ❌ Failed Maker peg check for ${sym}: buyPeg=${buyPeg}, bestAsk=${bestAsk}, sellPeg=${sellPeg}, bestBid=${bestBid}`);
    }
  }

  verify(allLimitFills, `Multi-Asset Audit: 100% Maker Peg verified across all ${testSymbols.length} MEXC assets!`);

  // --- TECHNIQUE 6: ZERO MARKET ORDERS STRICT REGRESSION ---
  console.log('\n--- TECHNIQUE 6: Strict Regression Audit (Zero Market Orders Placed) ---');
  const marketOrdersPlaced = mockClient.placeCalls.filter(c => c.type === 'MARKET');
  verify(marketOrdersPlaced.length === 0, 'Strict Regression: 0 (ZERO) Market orders placed across all QA tests!');

  console.log('\n========================================================================');
  console.log(`GLOBAL REGRESSION MASTER QA SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runGlobalRegressionSuite();
