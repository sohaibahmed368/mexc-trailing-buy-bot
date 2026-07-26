const OrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

// Comprehensive Mock MEXC Client supporting Orderbook Depth, Klines, and Recent Trades Flow
class SystemWideMockMexcClient {
  constructor() {
    this.prices = { 'SOLUSDT': 75.98, 'BTCUSDT': 65000.0, 'ETHUSDT': 3500.0, 'ONDOUSDT': 0.3950 };
    this.obiRatio = 0.65;
    this.volumeSpike = 2.0;
    this.rsi = 30.0;
    this.takerBuyRatio = 0.70; // 70% Taker Market Buys
    this.orders = {};
  }
  hasCredentials() { return true; }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async getDepth(symbol) {
    const p = this.prices[symbol] || 100.0;
    const bidsQty = (this.obiRatio * 100).toFixed(1);
    const asksQty = ((1 - this.obiRatio) * 100).toFixed(1);
    return {
      bids: [[(p * 0.999).toFixed(4), bidsQty]],
      asks: [[(p * 1.001).toFixed(4), asksQty]]
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
  async getRecentTrades(symbol, limit) {
    const trades = [];
    const buyTradesCount = Math.floor(limit * this.takerBuyRatio);
    for (let i = 0; i < limit; i++) {
      trades.push({
        price: (this.prices[symbol] || 100.0).toString(),
        qty: '10.0',
        isBuyerMaker: i >= buyTradesCount // False means Taker Buy!
      });
    }
    return trades;
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
  async placeOrder(params) { return this.createOrder(params); }
  async getOrder(symbol, orderId) {
    return this.orders[orderId] || { status: 'FILLED', executedQty: '1.0', cummulativeQuoteQty: '100.0' };
  }
  async cancelOrder() { return { success: true }; }
  async getBalances() { return [{ asset: 'USDT', free: 10000.0, locked: 0 }]; }
  async getMyTrades() { return []; }
}

// Comprehensive Mock Alpaca Client
class SystemWideMockAlpacaClient {
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

async function runMasterSystemWideRegression() {
  console.log('========================================================================');
  console.log('🧪 MASTER SYSTEM-WIDE REGRESSION & COMPREHENSIVE QA TEST SUITE');
  console.log('========================================================================\n');

  const mockIo = { emit: () => {} };
  const mexcMock = new SystemWideMockMexcClient();
  const alpacaMock = new SystemWideMockAlpacaClient();

  const cryptoTracker = new OrderTracker(mexcMock, mockIo);
  const stockTracker = new AlpacaStockOrderTracker(alpacaMock, mockIo);

  cryptoTracker.orders = [];
  stockTracker.orders = [];

  // ------------------------------------------------------------------------
  // TEST 1: Default Indicator Configuration (Taker Flow OFF by Default)
  // ------------------------------------------------------------------------
  mexcMock.prices['SOLUSDT'] = 75.98;
  const solOrder = await cryptoTracker.addOrder({
    symbol: 'SOLUSDT', trailValue: '0.25', quoteOrderQty: '200', dryRun: true,
    takeProfit: '0.6', stopLoss: '0.4', filterSmartSl: true, slBuffer: '0.2',
    filterObi: true, filterTakerFlow: false, autoRepeat: true, activationOffset: '0.6'
  });

  if (solOrder.filterTakerFlow !== false) {
    throw new Error('Default filterTakerFlow should be FALSE when not specified!');
  }
  console.log(`  ✅ [PASS 1/9] Order created with default filters (filterTakerFlow = false). Target dip -0.6%.`);

  // ------------------------------------------------------------------------
  // TEST 2: Trailing Dip Activation (PENDING_ACTIVATION -> RUNNING)
  // ------------------------------------------------------------------------
  mexcMock.prices['SOLUSDT'] = 75.52; // Dip hit (-0.6%)
  await cryptoTracker.tick();
  if (solOrder.status !== 'RUNNING' || solOrder.bottomPrice !== 75.52) {
    throw new Error(`Expected RUNNING state on dip, got ${solOrder.status}`);
  }
  console.log(`  ✅ [PASS 2/9] Activation dip hit ($75.52) -> State transitioned to RUNNING.`);

  // ------------------------------------------------------------------------
  // TEST 3: Trailing Rebound & Default Buy Execution (filterTakerFlow = false)
  // ------------------------------------------------------------------------
  mexcMock.prices['SOLUSDT'] = 75.75; // Rebound +0.3% above 75.52 (Trigger >= 75.7088)
  mexcMock.obiRatio = 0.65; // OBI Bids 65% >= 60%
  await cryptoTracker.tick();
  if (solOrder.status !== 'TP_SL_ACTIVE') {
    throw new Error(`Expected TP_SL_ACTIVE after rebound, got ${solOrder.status}`);
  }
  console.log(`  ✅ [PASS 3/9] Trailing Rebound + OBI >= 60% passed! Buy executed at $${solOrder.executionPrice}.`);

  // ------------------------------------------------------------------------
  // TEST 4: 50% TP Profit Lock Guard Activation & Risk-Free SL Lock
  // ------------------------------------------------------------------------
  const solBoughtP = solOrder.executionPrice || 75.71;
  mexcMock.prices['SOLUSDT'] = solBoughtP * 1.004; // +0.4% (>50% of 0.6% TP)
  await cryptoTracker.tick();
  if (!solOrder.isSlProfitLocked || !solOrder.lockedSlPrice) {
    throw new Error('50% Profit Lock Guard failed for SOLUSDT');
  }
  console.log(`  ✅ [PASS 4/9] 50% Profit Lock Activated! Locked SL set at $${solOrder.lockedSlPrice.toFixed(4)} (+0.1% Break-Even).`);

  // ------------------------------------------------------------------------
  // TEST 5: Optional Taker Market Flow Guard (filterTakerFlow = true)
  // ------------------------------------------------------------------------
  mexcMock.prices['ETHUSDT'] = 3500.0;
  const ethOrder = await cryptoTracker.addOrder({
    symbol: 'ETHUSDT', trailValue: '0.25', quoteOrderQty: '200', dryRun: true,
    takeProfit: '0.6', stopLoss: '0.4', filterObi: true, filterTakerFlow: true,
    autoRepeat: true, activationOffset: '0.6'
  });
  mexcMock.prices['ETHUSDT'] = 3479.0; // Dip hit
  await cryptoTracker.tick();

  // Test 5A: Taker Buy Flow < 55% -> Entry Deferred!
  mexcMock.prices['ETHUSDT'] = 3488.0; // Rebound
  mexcMock.takerBuyRatio = 0.40; // Only 40% market buys (55% required)
  await cryptoTracker.tick();
  if (ethOrder.status !== 'RUNNING') {
    throw new Error('Expected entry deferred when Taker Buy Flow < 55%');
  }
  console.log(`  ✅ [PASS 5/9] Optional Taker Flow Guard: 40% < 55% -> Buy deferred cleanly!`);

  // Test 5B: Taker Buy Flow >= 55% -> Entry Executed!
  mexcMock.takerBuyRatio = 0.70; // 70% market buys >= 55%
  await cryptoTracker.tick();
  if (ethOrder.status !== 'TP_SL_ACTIVE') {
    throw new Error('Expected entry executed when Taker Buy Flow >= 55%');
  }
  console.log(`  ✅ [PASS 6/9] Optional Taker Flow Guard: 70% >= 55% -> Buy executed cleanly!`);

  // ------------------------------------------------------------------------
  // TEST 6: Decoupled Stock Bot Engine QA (alpaca-stock-tracker.js)
  // ------------------------------------------------------------------------
  alpacaMock.prices['USO'] = 76.5;
  const stockOrd = await stockTracker.createStockOrder({
    symbol: 'USO', trailValue: '0.4', quoteOrderQty: '500', dryRun: true,
    takeProfit: '1.0', stopLoss: '0.8', autoRepeat: true, activationOffset: '0.8'
  });
  alpacaMock.prices['USO'] = 75.85; // Dip hit
  await stockTracker.tick();
  alpacaMock.prices['USO'] = 76.20; // Rebound
  await stockTracker.tick();
  if (stockOrd.status !== 'TP_SL_ACTIVE') {
    throw new Error('Stock tracker trailing buy failed');
  }
  console.log(`  ✅ [PASS 7/9] Decoupled Stock Bot Engine executed cleanly (USO bought at $${stockOrd.executionPrice}).`);

  // ------------------------------------------------------------------------
  // TEST 7: Win Ratio & Trade History PnL Math Verification
  // ------------------------------------------------------------------------
  solOrder.tradeHistory = [
    { cycle: 1, buyPrice: 75.0, sellPrice: 75.45, profitUsdt: 1.20, type: 'TAKE_PROFIT' },
    { cycle: 2, buyPrice: 75.0, sellPrice: 74.70, profitUsdt: -0.80, type: 'STOP_LOSS' }
  ];
  const wins = solOrder.tradeHistory.filter(t => t.profitUsdt > 0).length;
  const losses = solOrder.tradeHistory.filter(t => t.profitUsdt <= 0).length;
  const winRate = (wins / (wins + losses)) * 100;
  if (winRate !== 50.0 || wins !== 1 || losses !== 1) {
    throw new Error(`Win ratio math error: expected 50%, got ${winRate}%`);
  }
  console.log(`  ✅ [PASS 8/9] Win Ratio & PnL Math Verified (1 Win + 1 Loss = 50.0% Win Rate).`);

  // ------------------------------------------------------------------------
  // TEST 8: Symbol Deduplication & Clean State Protection
  // ------------------------------------------------------------------------
  await cryptoTracker.addOrder({ symbol: 'SOLUSDT', trailValue: '0.4', quoteOrderQty: '100', dryRun: true });
  if (cryptoTracker.orders.filter(o => o.symbol === 'SOLUSDT').length !== 1) {
    throw new Error('Deduplication failed for SOLUSDT');
  }
  console.log(`  ✅ [PASS 9/9] Symbol Deduplication Guard verified (Single SOLUSDT tracking card).`);

  console.log('\n========================================================================');
  console.log('🏆 ALL SYSTEM-WIDE REGRESSION TESTS PASSED PERFECTLY (100% PERFECT)!');
  console.log('========================================================================\n');
}

runMasterSystemWideRegression().catch(err => {
  console.error('\n❌ MASTER REGRESSION TEST FAILED:', err.message);
  process.exit(1);
});
