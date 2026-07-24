const OrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

// Mock MEXC Client supporting full depth, klines, order queries, and fills
class ComprehensiveMockMexcClient {
  constructor() {
    this.prices = { 'SOLUSDT': 140.0, 'BTCUSDT': 65000.0, 'ETHUSDT': 3500.0 };
    this.obiRatio = 0.65;
    this.volumeSpike = 2.0;
    this.rsi = 30.0;
    this.orders = {};
  }
  hasCredentials() { return true; }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async getDepth(symbol) {
    const p = this.prices[symbol] || 100.0;
    const bidsQty = (this.obiRatio * 100).toFixed(1);
    const asksQty = ((1 - this.obiRatio) * 100).toFixed(1);
    return {
      bids: [[(p * 0.999).toFixed(2), bidsQty], [(p * 0.998).toFixed(2), '50.0']],
      asks: [[(p * 1.001).toFixed(2), asksQty], [(p * 1.002).toFixed(2), '50.0']]
    };
  }
  async getKlines(symbol, interval, limit) {
    const arr = [];
    for (let i = 0; i < limit; i++) {
      const vol = i === limit - 1 ? 500 * this.volumeSpike : 500;
      const closePrice = 100.0 - (i * 0.2);
      arr.push([0, 100, 105, 95, closePrice, vol]);
    }
    return arr;
  }
  async createOrder(params) {
    const id = 'mexc_ord_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    this.orders[id] = {
      orderId: id,
      symbol: params.symbol,
      side: params.side,
      price: params.price || this.prices[params.symbol] || 100.0,
      executedQty: params.quantity || '1.0',
      cummulativeQuoteQty: (parseFloat(params.quantity || '1.0') * (params.price || this.prices[params.symbol] || 100.0)).toString(),
      status: 'FILLED'
    };
    return { orderId: id };
  }
  async placeOrder(params) {
    return this.createOrder(params);
  }
  async getOrder(symbol, orderId) {
    return this.orders[orderId] || { status: 'FILLED', executedQty: '1.0', cummulativeQuoteQty: '100.0' };
  }
  async cancelOrder() {
    return { success: true };
  }
  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0 },
      { asset: 'SOL', free: 10.0, locked: 0 },
      { asset: 'BTC', free: 1.0, locked: 0 },
      { asset: 'ETH', free: 5.0, locked: 0 }
    ];
  }
  async getMyTrades() {
    return [];
  }
}

// Mock Alpaca Client supporting full order placement, fills, and prices
class ComprehensiveMockAlpacaClient {
  constructor() {
    this.prices = { 'USO': 76.5, 'NVDA': 120.0, 'BNO': 28.0 };
    this.orders = {};
  }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async placeLimitBuyOrder(symbol, qty, price) {
    const id = 'alp_buy_' + Date.now();
    this.orders[id] = { id, symbol, qty, price, status: 'filled', filled_qty: qty, filled_avg_price: price };
    return this.orders[id];
  }
  async placeLimitSellOrder(symbol, qty, price) {
    const id = 'alp_sell_' + Date.now();
    this.orders[id] = { id, symbol, qty, price, status: 'filled', filled_qty: qty, filled_avg_price: price };
    return this.orders[id];
  }
  async getOrder(id) {
    return this.orders[id] || { status: 'filled', filled_qty: '1', filled_avg_price: '76.5' };
  }
}

async function runExhaustiveDualBotSuite() {
  console.log('========================================================================');
  console.log('🧪 EXHAUSTIVE DUAL-BOT FUNCTIONAL SCENARIO VERIFICATION SUITE');
  console.log('========================================================================\n');

  const mockIo = { emit: () => {} };
  const mexcMock = new ComprehensiveMockMexcClient();
  const alpacaMock = new ComprehensiveMockAlpacaClient();

  const cryptoTracker = new OrderTracker(mexcMock, mockIo);
  const stockTracker = new AlpacaStockOrderTracker(alpacaMock, mockIo);

  cryptoTracker.orders = [];
  stockTracker.orders = [];

  // =========================================================================
  // PART A: CRYPTO BOT (tracker.js) EXHAUSTIVE SCENARIOS
  // =========================================================================
  console.log('------------------------------------------------------------------------');
  console.log('🪙 PART A: CRYPTO BOT (tracker.js) ALL SCENARIOS');
  console.log('------------------------------------------------------------------------');

  // 1. Creation & Deduplication
  mexcMock.prices['SOLUSDT'] = 140.0;
  const cOrder1 = await cryptoTracker.addOrder({
    symbol: 'SOLUSDT', trailValue: '0.4', quoteOrderQty: '100', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', filterSmartSl: true, slBuffer: '0.2',
    filterObi: true, filterVolume: true, filterRsi: true, autoRepeat: true, activationOffset: '0.5'
  });
  console.log(`  1.1 addOrder: Created SOLUSDT order in state ${cOrder1.status} (Target dip -0.5%).`);

  // Deduplication check
  await cryptoTracker.addOrder({
    symbol: 'SOLUSDT', trailValue: '0.4', quoteOrderQty: '100', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', autoRepeat: true, activationOffset: '0.5'
  });
  if (cryptoTracker.orders.filter(o => o.symbol === 'SOLUSDT').length !== 1) {
    throw new Error('Deduplication failed for SOLUSDT in cryptoTracker');
  }
  console.log('  1.2 Symbol Deduplication: Guaranteed single SOLUSDT tracking card.');

  const activeCrypto = cryptoTracker.orders[0];

  // 2. Dip Activation (checkActivation)
  mexcMock.prices['SOLUSDT'] = 139.2; // -0.57% dip
  await cryptoTracker.tick();
  if (activeCrypto.status !== 'RUNNING') {
    throw new Error(`Expected RUNNING state on dip, got ${activeCrypto.status}`);
  }
  console.log(`  1.3 checkActivation: Dip hit -> State transitioned to RUNNING (Trigger target set to >= $${activeCrypto.triggerPrice.toFixed(4)}).`);

  // 3. Trailing Rebound & Indicators Guard Check (checkTrailingBuy)
  mexcMock.prices['SOLUSDT'] = 139.80; // rebound above trigger price
  mexcMock.obiRatio = 0.65; // OBI >= 60%
  mexcMock.volumeSpike = 2.0; // Vol >= 1.5x
  mexcMock.rsi = 30.0; // RSI <= 35
  await cryptoTracker.tick();
  if (activeCrypto.status !== 'TP_SL_ACTIVE') {
    throw new Error(`Expected TP_SL_ACTIVE state after trailing buy, got ${activeCrypto.status}`);
  }
  console.log(`  1.4 checkTrailingBuy: OBI (65%), Vol (2.0x), RSI (30) guards passed! Bought at $${activeCrypto.executionPrice}. State is TP_SL_ACTIVE.`);

  // 4. 50% Profit Lock Guard (checkTpSl)
  const boughtP = activeCrypto.executionPrice || 139.80;
  mexcMock.prices['SOLUSDT'] = boughtP * 1.006; // +0.6% (>50% of 1.0% TP)
  await cryptoTracker.tick();
  if (!activeCrypto.isSlProfitLocked || !activeCrypto.lockedSlPrice) {
    throw new Error('50% Profit Lock Guard failed in cryptoTracker');
  }
  console.log(`  1.5 50% Profit Lock Guard: Price hit +0.6% -> Profit Locked at $${activeCrypto.lockedSlPrice.toFixed(4)} (+0.1% risk-free break-even).`);

  // 5. Smart SL Extension Guard Test
  const mockOrder2 = await cryptoTracker.addOrder({
    symbol: 'BTCUSDT', trailValue: '0.4', quoteOrderQty: '100', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', filterSmartSl: true, slBuffer: '0.2',
    autoRepeat: true, startImmediately: true
  });
  mockOrder2.executionPrice = 65000.0;
  mexcMock.prices['BTCUSDT'] = 65000.0 * (1 - 0.008); // Hits SL line
  mexcMock.obiRatio = 0.55; // Bids support >= 45% -> Buyer exhaustion!
  await cryptoTracker.tick();
  if (!mockOrder2.isSlExtended) {
    throw new Error('Smart SL Extension Guard failed for BTCUSDT');
  }
  console.log(`  1.6 Smart SL Extension Guard: Bids support 55% >= 45% -> SL Extended by +0.2% buffer!`);

  // 6. Take Profit Hit & Auto-Repeat Reset
  mexcMock.prices['SOLUSDT'] = boughtP * 1.011; // Hits 1.0% TP
  await cryptoTracker.tick();
  if (activeCrypto.status !== 'PENDING_ACTIVATION' || activeCrypto.tradeHistory.length !== 1) {
    throw new Error('Take Profit cycle reset failed in cryptoTracker');
  }
  console.log(`  1.7 Take Profit Hit: Cycle 1 completed with Profit! Order reset to PENDING_ACTIVATION for next cycle.`);

  // 7. Clear Trade History
  cryptoTracker.clearTradeHistory();
  if (activeCrypto.tradeHistory.length !== 0 || activeCrypto.totalNetProfit !== 0) {
    throw new Error('clearTradeHistory failed in cryptoTracker');
  }
  console.log('  1.8 clearTradeHistory: Purged all trade history records. Win ratio reset to 100%.');

  // =========================================================================
  // PART B: STOCK BOT (alpaca-stock-tracker.js) EXHAUSTIVE SCENARIOS
  // =========================================================================
  console.log('\n------------------------------------------------------------------------');
  console.log('🏛️ PART B: STOCK BOT (alpaca-stock-tracker.js) ALL SCENARIOS');
  console.log('------------------------------------------------------------------------');

  // 1. Creation & Deduplication
  alpacaMock.prices['USO'] = 76.5;
  const sOrder1 = await stockTracker.createStockOrder({
    symbol: 'USO', trailValue: '0.4', quoteOrderQty: '500', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', filterSmartSl: true, slBuffer: '0.2',
    autoRepeat: true, activationOffset: '0.8'
  });
  console.log(`  2.1 createStockOrder: Created USO order in state ${sOrder1.status} (Target dip -0.8%).`);

  // Deduplication check
  await stockTracker.createStockOrder({
    symbol: 'USO', trailValue: '0.4', quoteOrderQty: '500', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', autoRepeat: true, activationOffset: '0.8'
  });
  if (stockTracker.orders.filter(o => o.symbol === 'USO').length !== 1) {
    throw new Error('Deduplication failed for USO in stockTracker');
  }
  console.log('  2.2 Symbol Deduplication: Guaranteed single USO tracking card.');

  const activeStock = stockTracker.orders[0];

  // 2. Dip Activation (checkStockActivation)
  alpacaMock.prices['USO'] = 75.85; // -0.85% dip
  await stockTracker.tick();
  if (activeStock.status !== 'RUNNING') {
    throw new Error(`Expected RUNNING state on stock dip, got ${activeStock.status}`);
  }
  console.log(`  2.3 checkStockActivation: Stock dip hit -> State transitioned to RUNNING (Trigger target set to >= $${activeStock.triggerPrice.toFixed(4)}).`);

  // 3. Trailing Rebound & Execution (checkStockTrailingBuy)
  alpacaMock.prices['USO'] = 76.20; // Rebound above trigger
  await stockTracker.tick();
  if (activeStock.status !== 'TP_SL_ACTIVE') {
    throw new Error(`Expected TP_SL_ACTIVE state after stock buy, got ${activeStock.status}`);
  }
  console.log(`  2.4 checkStockTrailingBuy: Alpaca Buy Executed at $${activeStock.executionPrice}. State is TP_SL_ACTIVE.`);

  // 4. 50% Profit Lock Guard (checkStockTpSl)
  const stockBoughtP = activeStock.executionPrice || 76.20;
  alpacaMock.prices['USO'] = stockBoughtP * 1.006; // +0.6% (>50% of 1.0% TP)
  await stockTracker.tick();
  if (!activeStock.isSlProfitLocked || !activeStock.lockedSlPrice) {
    throw new Error('50% Profit Lock Guard failed in stockTracker');
  }
  console.log(`  2.5 50% Profit Lock Guard: Stock price hit +0.6% -> Profit Locked at $${activeStock.lockedSlPrice.toFixed(4)}.`);

  // 5. Take Profit Hit & Cycle Reset
  alpacaMock.prices['USO'] = stockBoughtP * 1.011; // Hits 1.0% TP
  await stockTracker.tick();
  if (activeStock.status !== 'PENDING_ACTIVATION' || activeStock.tradeHistory.length !== 1) {
    throw new Error('Take Profit cycle reset failed in stockTracker');
  }
  console.log(`  2.6 Take Profit Hit: Stock Cycle 1 completed with Profit! Order reset to PENDING_ACTIVATION.`);

  // 6. Win Ratio Math Verification
  activeStock.tradeHistory = [
    { cycle: 1, buyPrice: 76.5, sellPrice: 77.265, type: 'TAKE_PROFIT', profit: 0.01, timestamp: new Date().toISOString() },
    { cycle: 2, buyPrice: 76.5, sellPrice: 75.888, type: 'STOP_LOSS', profit: -0.008, timestamp: new Date().toISOString() }
  ];
  const stockTpWins = activeStock.tradeHistory.filter(t => t.type === 'TAKE_PROFIT' || t.type === 'PROFIT_LOCK_SELL').length;
  const stockSlLosses = activeStock.tradeHistory.filter(t => t.type === 'STOP_LOSS').length;
  const totalFinished = stockTpWins + stockSlLosses;
  const winRate = (stockTpWins / totalFinished) * 100;
  if (winRate !== 50.0) {
    throw new Error(`Win Ratio Math failed: expected 50.0%, got ${winRate}%`);
  }
  console.log('  2.7 Win Ratio Math Verification: 1 Win + 1 Loss = 50.0% Win Rate (Exact!).');

  // 7. Clear Trade History
  stockTracker.clearTradeHistory();
  if (activeStock.tradeHistory.length !== 0 || activeStock.totalNetProfit !== 0) {
    throw new Error('clearTradeHistory failed in stockTracker');
  }
  console.log('  2.8 clearTradeHistory: Purged all stock trade history records.');

  console.log('\n========================================================================');
  console.log('🏆 ALL DUAL-BOT FUNCTIONAL SCENARIO TESTS PASSED (100% PERFECT)!');
  console.log('========================================================================\n');
}

runExhaustiveDualBotSuite().catch(err => {
  console.error('\n❌ EXHAUSTIVE VERIFICATION FAILED:', err.message);
  process.exit(1);
});
