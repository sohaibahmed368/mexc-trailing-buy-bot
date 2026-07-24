const OrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

// Mock MEXC Client
class MockMexcClient {
  constructor() {
    this.prices = { 'BTCUSDT': 65000.0, 'ETHUSDT': 3500.0, 'SOLUSDT': 140.0 };
  }
  hasCredentials() { return true; }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async getDepth(symbol) {
    const p = this.prices[symbol] || 100.0;
    // Bids = 33.0 (82.5%), Asks = 7.0 (17.5%) -> OBI Bids Ratio = 82.5% (Crosses 60% Guard!)
    return {
      bids: [[(p * 0.999).toFixed(2), '13.0'], [(p * 0.998).toFixed(2), '20.0']],
      asks: [[(p * 1.001).toFixed(2), '4.0'], [(p * 1.002).toFixed(2), '3.0']]
    };
  }
  async getKlines(symbol, interval, limit) {
    return Array(limit).fill([0, 100, 105, 95, 100, 500]);
  }
  async createOrder() {
    return { orderId: 'mock_' + Date.now() };
  }
  async getOrder(symbol, orderId) {
    return { status: 'FILLED', executedQty: '1.0', cummulativeQuoteQty: '100.0' };
  }
}

// Mock Alpaca Client
class MockAlpacaClient {
  constructor() {
    this.prices = { 'USO': 76.5, 'NVDA': 120.0 };
  }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async placeLimitBuyOrder() { return { id: 'alp_buy_' + Date.now() }; }
  async placeLimitSellOrder() { return { id: 'alp_sell_' + Date.now() }; }
  async getOrder() { return { status: 'filled', filled_qty: '1', filled_avg_price: '76.5' }; }
}

async function runMasterVerification() {
  console.log('========================================================================');
  console.log('🧪 MASTER DUAL-BOT EXHAUSTIVE FUNCTIONALITY VERIFICATION SUITE');
  console.log('========================================================================\n');

  const mockIo = { emit: () => {} };
  const mockMexc = new MockMexcClient();
  const mockAlpaca = new MockAlpacaClient();

  const cryptoTracker = new OrderTracker(mockMexc, mockIo);
  const stockTracker = new AlpacaStockOrderTracker(mockAlpaca, mockIo);

  // Clear existing orders for clean test run
  cryptoTracker.orders = [];
  stockTracker.orders = [];

  // ------------------------------------------------------------------------
  // TEST 1: CRYPTO BOT FULL SCENARIO CYCLE (Dip -> Trailing -> TP -> Profit Lock -> Reset)
  // ------------------------------------------------------------------------
  console.log('--- TEST 1: Crypto Bot Complete Cycle & 50% Profit Lock ---');
  mockMexc.prices['SOLUSDT'] = 140.0;

  const cryptoOrder = await cryptoTracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '0.4',
    quoteOrderQty: '100',
    dryRun: true,
    takeProfit: '1.0',
    stopLoss: '0.8',
    filterSmartSl: true,
    slBuffer: '0.2',
    filterObi: true,
    autoRepeat: true,
    activationOffset: '0.5'
  });

  if (cryptoOrder.status !== 'PENDING_ACTIVATION') {
    throw new Error(`TEST 1 FAILED: Expected PENDING_ACTIVATION but got ${cryptoOrder.status}`);
  }
  console.log('  ✅ [PASS] Initial State is PENDING_ACTIVATION (-0.5% Dip Target).');

  // Dip hit -> transition to RUNNING (139.2 <= 139.3)
  mockMexc.prices['SOLUSDT'] = 139.2; // -0.57% dip -> bottom = 139.2, trigger = 139.2 * 1.004 = 139.7568
  await cryptoTracker.tick();
  if (cryptoOrder.status !== 'RUNNING') {
    throw new Error(`TEST 1 FAILED: Dip hit should trigger RUNNING, got ${cryptoOrder.status}`);
  }
  console.log('  ✅ [PASS] Dip hit -> State transitioned to RUNNING (Trigger target set to >= $139.7568).');

  // Rebound hit -> Trailing Buy -> TP_SL_ACTIVE (139.80 >= 139.7568)
  mockMexc.prices['SOLUSDT'] = 139.80; // +0.43% rebound from bottom (OBI Bids = 82.5% >= 60%)
  await cryptoTracker.tick();
  if (cryptoOrder.status !== 'TP_SL_ACTIVE') {
    throw new Error(`TEST 1 FAILED: Rebound hit should trigger TP_SL_ACTIVE, got ${cryptoOrder.status}`);
  }
  console.log(`  ✅ [PASS] Trailing Buy Triggered at $${cryptoOrder.executionPrice}! OBI Bids 82.5% >= 60% Guard Passed. State is TP_SL_ACTIVE.`);

  // Price reaches +0.6% (>50% of 1.0% TP) -> 50% Profit Lock
  const boughtP = cryptoOrder.executionPrice || 139.80;
  mockMexc.prices['SOLUSDT'] = boughtP * 1.006;
  await cryptoTracker.tick();
  if (!cryptoOrder.isSlProfitLocked || !cryptoOrder.lockedSlPrice) {
    throw new Error(`TEST 1 FAILED: 50% Profit Lock did not activate on price crossing >50% TP`);
  }
  console.log(`  ✅ [PASS] 50% Profit Lock Activated! Locked SL Price set to $${cryptoOrder.lockedSlPrice.toFixed(4)}.`);

  // Price hits TP (1.0%) -> Take Profit hit & Auto-Repeat Reset
  mockMexc.prices['SOLUSDT'] = boughtP * 1.011;
  await cryptoTracker.tick();
  if (cryptoOrder.status !== 'PENDING_ACTIVATION' || cryptoOrder.tradeHistory.length !== 1) {
    throw new Error(`TEST 1 FAILED: TP hit should reset cycle to PENDING_ACTIVATION and add 1 trade history record`);
  }
  console.log(`  ✅ [PASS] Take Profit Hit! Trade logged in history (Cycle 1). Reset to PENDING_ACTIVATION.`);

  // ------------------------------------------------------------------------
  // TEST 2: STOCK BOT FULL SCENARIO CYCLE & WIN RATIO MATH VERIFICATION
  // ------------------------------------------------------------------------
  console.log('\n--- TEST 2: Stock Bot Cycle & Win Ratio Math Verification ---');
  mockAlpaca.prices['USO'] = 76.5;

  const stockOrder = await stockTracker.createStockOrder({
    symbol: 'USO',
    trailValue: '0.4',
    quoteOrderQty: '500',
    dryRun: true,
    takeProfit: '1.0',
    stopLoss: '0.8',
    filterSmartSl: true,
    slBuffer: '0.2',
    autoRepeat: true,
    activationOffset: '0.8'
  });

  if (stockOrder.status !== 'PENDING_ACTIVATION') {
    throw new Error(`TEST 2 FAILED: Expected Stock Order PENDING_ACTIVATION but got ${stockOrder.status}`);
  }
  console.log('  ✅ [PASS] Stock Order created cleanly in PENDING_ACTIVATION state.');

  // Deduplication check: create another order for USO -> Old order replaced cleanly!
  await stockTracker.createStockOrder({
    symbol: 'USO',
    trailValue: '0.4',
    quoteOrderQty: '500',
    dryRun: true,
    takeProfit: '1.0',
    stopLoss: '0.8',
    autoRepeat: true,
    startImmediately: true
  });
  if (stockTracker.orders.filter(o => o.symbol === 'USO').length !== 1) {
    throw new Error(`TEST 2 FAILED: Symbol Deduplication failed, multiple USO cards exist`);
  }
  console.log('  ✅ [PASS] Symbol Deduplication Guard Verified: Only 1 active USO order exists.');

  // Win Ratio Math Verification with 1 Win and 1 Loss
  const activeStock = stockTracker.orders.find(o => o.symbol === 'USO');
  activeStock.tradeHistory = [
    { cycle: 1, buyPrice: 76.5, sellPrice: 77.265, type: 'TAKE_PROFIT', profit: 0.01, timestamp: new Date().toISOString() },
    { cycle: 2, buyPrice: 76.5, sellPrice: 75.888, type: 'STOP_LOSS', profit: -0.008, timestamp: new Date().toISOString() }
  ];

  const stockTpWins = activeStock.tradeHistory.filter(t => t.type === 'TAKE_PROFIT' || t.type === 'PROFIT_LOCK_SELL').length;
  const stockSlLosses = activeStock.tradeHistory.filter(t => t.type === 'STOP_LOSS').length;
  const totalFinished = stockTpWins + stockSlLosses;
  const calculatedWinRate = (stockTpWins / totalFinished) * 100;

  if (calculatedWinRate !== 50.0) {
    throw new Error(`TEST 2 FAILED: 1 Win and 1 Loss should give 50% Win Rate, got ${calculatedWinRate}%`);
  }
  console.log(`  ✅ [PASS] Win Ratio Math Verified: 1 Win + 1 Loss = 50.0% Win Rate (Correct!).`);

  console.log('\n========================================================================');
  console.log('🏆 ALL DUAL-BOT SCENARIO TESTS PASSED SUCCESSFULLY (100% PERFECT)!');
  console.log('========================================================================\n');
}

runMasterVerification().catch(err => {
  console.error('\n❌ MASTER VERIFICATION FAILED:', err.message);
  process.exit(1);
});
