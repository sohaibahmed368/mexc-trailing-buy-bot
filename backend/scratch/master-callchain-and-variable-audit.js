const OrderTracker = require('../tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🔬 EXHAUSTIVE CALL-CHAIN & VARIABLE MUTATION AUDIT SUITE');
console.log('========================================================================\n');

class ComprehensiveMockMexcClient {
  constructor() {
    this.prices = {
      'BTCUSDT': 65000.0,
      'ETHUSDT': 3500.0,
      'SOLUSDT': 140.0,
      'ONDOUSDT': 1.05,
      'SUIUSDT': 1.85,
      'UNIUSDT': 7.50
    };
    this.orderCounter = 1;
    this.placedOrders = [];
    this.callLog = [];
    this.filledOrders = new Set();
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    this.callLog.push(`getTickerPrice(${symbol})`);
    return this.prices[symbol] || 100.0;
  }

  async getDepth(symbol) {
    this.callLog.push(`getDepth(${symbol})`);
    const p = await this.getTickerPrice(symbol);
    return {
      bids: [[(p * 0.999).toFixed(4), '800.0'], [(p * 0.998).toFixed(4), '1600.0']],
      asks: [[(p * 1.001).toFixed(4), '200.0'], [(p * 1.002).toFixed(4), '400.0']]
    };
  }

  async getKlines(symbol, interval, limit) {
    this.callLog.push(`getKlines(${symbol}, ${interval}, ${limit})`);
    return Array(limit).fill(0).map((_, i) => [
      Date.now() - (limit - i) * 60000,
      '100', '105', '95', '100', '1000'
    ]);
  }

  async getRecentTrades(symbol, limit) {
    this.callLog.push(`getRecentTrades(${symbol}, ${limit})`);
    const now = Date.now();
    return Array(20).fill(0).map((_, i) => ({
      time: now - (i * 1000),
      price: '100.0',
      qty: '1.0',
      isBuyerMaker: i >= 16 // 80% buyer taker
    }));
  }

  async placeOrder(params) {
    this.callLog.push(`placeOrder(${params.symbol}, ${params.side}, ${params.type})`);
    const id = 'C02_TEST_' + (this.orderCounter++);
    this.placedOrders.push({ ...params, id });

    // Update mock balance on BUY
    if (params.side === 'BUY') {
      const asset = params.symbol.replace('USDT', '');
      if (!this.userBalances) this.userBalances = {};
      this.userBalances[asset] = 10.0;
    }
    return { orderId: id, symbol: params.symbol, status: 'FILLED' };
  }

  async getOrder(symbol, orderId) {
    this.callLog.push(`getOrder(${symbol}, ${orderId})`);
    const isFilled = this.filledOrders && this.filledOrders.has(orderId);
    return {
      symbol,
      orderId,
      status: isFilled ? 'FILLED' : 'NEW',
      executedQty: isFilled ? '1.0' : '0.0',
      cummulativeQuoteQty: isFilled ? '100.0' : '0.0'
    };
  }

  async getBalances() {
    this.callLog.push(`getBalances()`);
    const b = this.userBalances || {};
    return [
      { asset: 'USDT', free: 10000.0, locked: 0 },
      { asset: 'SOL', free: b['SOL'] || 0, locked: 0 },
      { asset: 'BTC', free: b['BTC'] || 0, locked: 0 },
      { asset: 'ETH', free: b['ETH'] || 0, locked: 0 },
      { asset: 'ONDO', free: b['ONDO'] || 0, locked: 0 },
      { asset: 'SUI', free: b['SUI'] || 0, locked: 0 },
      { asset: 'UNI', free: b['UNI'] || 0, locked: 0 }
    ];
  }

  async getMyTrades() {
    this.callLog.push(`getMyTrades()`);
    return [];
  }
}

async function runExhaustiveCallchainAudit() {
  const mockClient = new ComprehensiveMockMexcClient();
  mockClient.userBalances = {}; // 0 balance before buy execution
  const dummyIo = { emit: () => {} };
  const tracker = new OrderTracker(mockClient, dummyIo);
  tracker.orders = []; // Clean initial state for audit

  console.log('1. AUDITING ORDER CREATION & VARIABLE INITIALIZATION...');
  const order1 = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: 0.25,
    quoteOrderQty: 50,
    orderType: 'MARKET',
    dryRun: false,
    activationOffset: 0.5,
    takeProfit: 0.6,
    stopLoss: 0.5,
    filterSmartSl: true,
    slBuffer: 0.2,
    filterObi: true,
    filterVolume: false,
    filterRsi: false,
    filter40sVolume: true,
    autoRepeat: true
  });

  assert.strictEqual(order1.status, 'PENDING_ACTIVATION', 'Order state must be PENDING_ACTIVATION');
  assert.strictEqual(order1.filter40sVolume, true, 'filter40sVolume must be true');
  assert.strictEqual(order1.filterObi, true, 'filterObi must be true');
  assert.strictEqual(order1.filterSmartSl, true, 'filterSmartSl must be true');
  assert.ok(order1.activationPrice < order1.initialPrice, 'Activation price must be below initial price');
  console.log('   ✅ Order creation & initial state variables 100% PERFECT!\n');

  console.log('2. AUDITING ACTIVATION DIP TRANSITION (PENDING_ACTIVATION -> RUNNING)...');
  mockClient.prices['SOLUSDT'] = 139.2; // -0.57% dip
  await tracker.tick();
  const orderRunning = tracker.orders.find(o => o.id === order1.id);
  assert.strictEqual(orderRunning.status, 'RUNNING', 'Order must transition to RUNNING on dip');
  assert.strictEqual(orderRunning.bottomPrice, 139.2, 'bottomPrice must update to 139.2');
  assert.ok(orderRunning.triggerPrice > 139.2, 'triggerPrice must be calculated above bottomPrice');
  console.log('   ✅ Activation Dip transition & bottom/trigger variables 100% PERFECT!\n');

  console.log('3. AUDITING PER-SYMBOL SINGLE ACTIVE POSITION GUARD...');
  // Rebound SOLUSDT to trigger Market Buy (RUNNING -> TP_SL_ACTIVE)
  mockClient.prices['SOLUSDT'] = 139.6; // +0.28% rebound
  mockClient.userBalances = { 'SOL': 10.0, 'BTC': 1.0 }; // Non-zero physical wallet holdings
  await tracker.tick();
  const orderSolActive = tracker.orders.find(o => o.id === order1.id);
  assert.strictEqual(orderSolActive.status, 'TP_SL_ACTIVE', 'SOLUSDT must be TP_SL_ACTIVE');

  // 🧪 LATENCY RACE-CONDITION AUDIT: Simulate in-flight PENDING_EXECUTION status during 1-2s Limit Sell binding window
  orderSolActive.status = 'PENDING_EXECUTION'; // simulate in-flight API call latency
  const latencyRaceSolOrder = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: 0.25,
    quoteOrderQty: 50,
    orderType: 'MARKET',
    dryRun: false,
    startImmediately: true,
    autoRepeat: true
  });
  assert.notStrictEqual(latencyRaceSolOrder.status, 'TP_SL_ACTIVE', 'Race condition instant buy during PENDING_EXECUTION latency MUST BE BLOCKED!');
  assert.strictEqual(latencyRaceSolOrder.status, 'RUNNING', 'In-flight latency duplicate order MUST remain in RUNNING mode!');

  // Revert back to TP_SL_ACTIVE for remaining test steps
  orderSolActive.status = 'TP_SL_ACTIVE';

  // Add BTCUSDT order - it CAN buy its own 1 position independently!
  const btcOrder = await tracker.addOrder({
    symbol: 'BTCUSDT',
    trailValue: 0.25,
    quoteOrderQty: 50,
    orderType: 'MARKET',
    dryRun: false,
    activationOffset: 0.5,
    takeProfit: 0.6,
    stopLoss: 0.5,
    filter40sVolume: true,
    autoRepeat: true
  });
  mockClient.prices['BTCUSDT'] = 64600.0; // dip
  await tracker.tick();
  mockClient.prices['BTCUSDT'] = 64800.0; // rebound trigger
  await tracker.tick();

  const orderBtcActive = tracker.orders.find(o => o.symbol === 'BTCUSDT');
  assert.strictEqual(orderBtcActive.status, 'TP_SL_ACTIVE', 'BTCUSDT must successfully buy its single independent position');
  console.log('   ✅ PER-SYMBOL SINGLE ACTIVE POSITION GUARD & 1-2s LATENCY RACE CONDITION LOCK 100% PERFECT!\n');

  console.log('4. AUDITING 50% TP PROFIT LOCK GUARD FLOOR CALCULATION...');
  // SOLUSDT Buy price was 139.6. 50% TP progress = +0.30%
  const halfTpPrice = 139.6 * (1 + 0.0032);
  mockClient.prices['SOLUSDT'] = halfTpPrice;
  await tracker.tick();

  const orderSolProfitLocked = tracker.orders.find(o => o.id === order1.id);
  assert.strictEqual(orderSolProfitLocked.isSlProfitLocked, true, 'isSlProfitLocked must be true');
  const expectedFloor = 139.6 * (1 + 0.0030);
  assert.strictEqual(orderSolProfitLocked.lockedSlPrice.toFixed(4), expectedFloor.toFixed(4), 'Locked SL floor must match exact 50% TP level');
  console.log('   ✅ 50% TP Profit Lock Guard & floor variable state 100% PERFECT!\n');

  console.log('5. AUDITING TAKE PROFIT HIT, TRADE HISTORY RECORDING & RESET...');
  const currentSolOrder = tracker.orders.find(o => o.id === order1.id);
  if (currentSolOrder.mexcSellOrderId) mockClient.filledOrders.add(currentSolOrder.mexcSellOrderId);
  currentSolOrder.lastGhostCheckTime = 0; // Force immediate MEXC order query

  const tpTargetPrice = 139.6 * (1 + 0.0065);
  mockClient.prices['SOLUSDT'] = tpTargetPrice;
  await tracker.tick();

  const orderSolReset = tracker.orders.find(o => o.id === order1.id);
  assert.strictEqual(orderSolReset.status, 'PENDING_ACTIVATION', 'Order1 must reset to PENDING_ACTIVATION on TP completion');
  assert.strictEqual(orderSolReset.tradeHistory.length, 1, 'Trade history count must increment to 1');
  assert.ok(orderSolReset.totalNetProfit > 0, 'totalNetProfit must be positive');
  console.log('   ✅ Take Profit completion, Trade History recording, & Auto-Repeat Reset 100% PERFECT!\n');

  console.log('6. AUDITING INDEPENDENT MULTI-COIN TRADING & VERIFICATION...');
  const orderBtcActive2 = tracker.orders.find(o => o.symbol === 'BTCUSDT');
  assert.strictEqual(orderBtcActive2.status, 'TP_SL_ACTIVE', 'BTCUSDT must maintain its active trade independently');
  console.log('   ✅ Multi-coin per-symbol position guard & independent execution 100% PERFECT!\n');

  console.log('========================================================================');
  console.log('🏆 EXHAUSTIVE CALL-CHAIN & VARIABLE MUTATION AUDIT PASSED 100% PERFECT!');
  console.log('========================================================================\n');
}

runExhaustiveCallchainAudit().catch(err => {
  console.error('❌ AUDIT FAILED:', err);
  process.exit(1);
});
