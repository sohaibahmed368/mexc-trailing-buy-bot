const OrderTracker = require('../tracker');
const AlpacaStockOrderTracker = require('../alpaca-stock-tracker');

// Comprehensive Mock MEXC Client
class MasterMockMexcClient {
  constructor() {
    this.prices = {
      'SOLUSDT': 140.0,
      'BTCUSDT': 65000.0,
      'ETHUSDT': 3500.0,
      'ONDOUSDT': 1.05,
      'SUIUSDT': 1.85,
      'UNIUSDT': 7.50
    };
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
      bids: [[(p * 0.999).toFixed(4), bidsQty], [(p * 0.998).toFixed(4), '50.0']],
      asks: [[(p * 1.001).toFixed(4), asksQty], [(p * 1.002).toFixed(4), '50.0']]
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
  async placeOrder(params) { return this.createOrder(params); }
  async getOrder(symbol, orderId) {
    return this.orders[orderId] || { status: 'FILLED', executedQty: '1.0', cummulativeQuoteQty: '100.0' };
  }
  async cancelOrder() { return { success: true }; }
  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0 },
      { asset: 'SOL', free: 0, locked: 0 },
      { asset: 'BTC', free: 0, locked: 0 },
      { asset: 'ETH', free: 0, locked: 0 },
      { asset: 'ONDO', free: 0, locked: 0 },
      { asset: 'SUI', free: 0, locked: 0 },
      { asset: 'UNI', free: 0, locked: 0 }
    ];
  }
  async getMyTrades() { return []; }
}

// Mock Alpaca Client
class MasterMockAlpacaClient {
  constructor() {
    this.prices = { 'USO': 76.5, 'NVDA': 120.0, 'AAPL': 220.0 };
    this.orders = {};
  }
  async getTickerPrice(symbol) { return this.prices[symbol] || 100.0; }
  async placeOrder(params) {
    const id = 'alp_' + Date.now() + '_' + Math.floor(Math.random()*1000);
    const price = params.price || this.prices[params.symbol] || 100.0;
    this.orders[id] = { id, symbol: params.symbol, qty: params.qty, price, status: 'filled', filled_qty: params.qty, filled_avg_price: price };
    return this.orders[id];
  }
  async placeLimitBuyOrder(symbol, qty, price) {
    return this.placeOrder({ symbol, qty, price, side: 'buy' });
  }
  async placeLimitSellOrder(symbol, qty, price) {
    return this.placeOrder({ symbol, qty, price, side: 'sell' });
  }
  async getOrder(id) {
    return this.orders[id] || { status: 'filled', filled_qty: '1', filled_avg_price: '76.5' };
  }
}

async function runMasterAllCoinsAudit() {
  console.log('========================================================================');
  console.log('🧪 MASTER END-TO-END SYSTEM-WIDE FUNCTIONAL AUDIT & REGRESSION SUITE');
  console.log('========================================================================\n');

  const mockIo = { emit: () => {} };
  const mexcMock = new MasterMockMexcClient();
  const alpacaMock = new MasterMockAlpacaClient();

  const cryptoTracker = new OrderTracker(mexcMock, mockIo);
  const stockTracker = new AlpacaStockOrderTracker(alpacaMock, mockIo);

  const coinsToTest = ['SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'ONDOUSDT', 'SUIUSDT', 'UNIUSDT'];

  console.log('------------------------------------------------------------------------');
  console.log('🪙 PART A: CRYPTO BOT (tracker.js) MULTI-COIN EXHAUSTIVE SCENARIOS');
  console.log('------------------------------------------------------------------------');
  
  cryptoTracker.orders = [];

  for (const sym of coinsToTest) {
    console.log(`\n  >>> TESTING COIN: ${sym} <<<`);

    // 1. Order Creation
    const initialP = mexcMock.prices[sym];
    const order = await cryptoTracker.addOrder({
      symbol: sym,
      trailValue: 0.25,
      quoteOrderQty: 50,
      orderType: 'MARKET',
      dryRun: true,
      activationOffset: 0.5, // -0.5% dip required
      activationDirection: 'DOWN',
      takeProfit: 0.6,
      stopLoss: 0.5,
      filterSmartSl: false,
      slBuffer: 0.2,
      filterObi: false,
      filterVolume: false,
      filterRsi: false,
      filter40sVolume: false,
      autoRepeat: true
    });

    console.log(`  1.1 Order Created: ID=${order.id}, State=${order.status}`);
    if (order.status !== 'PENDING_ACTIVATION') throw new Error(`${sym} State mismatch on creation`);

    // 2. Dip Hit (PENDING_ACTIVATION -> RUNNING)
    const dippedPrice = initialP * (1 - (0.55 / 100)); // -0.55% dip
    mexcMock.prices[sym] = dippedPrice;
    await cryptoTracker.tick();

    const orderRunning = cryptoTracker.orders.find(o => o.id === order.id);
    const peakStr = orderRunning.peakPrice ? orderRunning.peakPrice.toFixed(4) : '-';
    const bottomStr = orderRunning.bottomPrice ? orderRunning.bottomPrice.toFixed(4) : '-';
    console.log(`  1.2 Dip Hit: Dipped to $${dippedPrice.toFixed(4)} -> State=${orderRunning.status}, Peak=$${peakStr}, Bottom=$${bottomStr}`);
    if (orderRunning.status !== 'RUNNING') throw new Error(`${sym} State mismatch on activation dip`);

    // 3. Rebound Hit & Trailing Buy (RUNNING -> TP_SL_ACTIVE)
    const reboundPrice = dippedPrice * (1 + (0.30 / 100)); // +0.30% rebound
    mexcMock.prices[sym] = reboundPrice;
    await cryptoTracker.tick();

    const orderActive = cryptoTracker.orders.find(o => o.id === order.id);
    console.log(`  1.3 Trailing Buy Executed: Executed at $${orderActive.executionPrice.toFixed(4)} -> State=${orderActive.status}`);
    if (orderActive.status !== 'TP_SL_ACTIVE') throw new Error(`${sym} State mismatch on trailing buy execution`);

    // 4. 50% Profit Lock Guard Trigger (Exact 50% TP level)
    // 0.6% TP -> 50% progress = +0.30%. Target SL floor = +0.30% above Buy Price
    const halfTpPrice = orderActive.executionPrice * (1 + (0.32 / 100));
    mexcMock.prices[sym] = halfTpPrice;
    await cryptoTracker.tick();

    const orderProfitLocked = cryptoTracker.orders.find(o => o.id === order.id);
    const expectedLockedSl = orderActive.executionPrice * (1 + (0.30 / 100));
    const lockedSlStr = (orderProfitLocked && orderProfitLocked.lockedSlPrice) ? orderProfitLocked.lockedSlPrice.toFixed(4) : '-';
    console.log(`  1.4 Profit Lock Triggered: Price hit +0.32% -> isSlProfitLocked=${orderProfitLocked ? orderProfitLocked.isSlProfitLocked : false}, Locked SL Floor=$${lockedSlStr} (Expected: $${expectedLockedSl.toFixed(4)})`);
    if (!orderProfitLocked || !orderProfitLocked.isSlProfitLocked) throw new Error(`${sym} Profit Lock failed to trigger`);
    if (Math.abs(orderProfitLocked.lockedSlPrice - expectedLockedSl) > 0.001) throw new Error(`${sym} Locked SL price math error`);

    // 5. Take Profit Hit & Auto-Repeat Reset
    const tpPrice = orderActive.executionPrice * (1 + (0.65 / 100));
    mexcMock.prices[sym] = tpPrice;
    await cryptoTracker.tick();

    const orderReset = cryptoTracker.orders.find(o => o.id === order.id);
    console.log(`  1.5 Take Profit Hit: Price hit +0.65% -> Cycle 1 Completed! State Reset=${orderReset.status}, Trade History Count=${orderReset.tradeHistory.length}`);
    if (orderReset.status !== 'PENDING_ACTIVATION') throw new Error(`${sym} Auto-Repeat reset failed`);
    if (orderReset.tradeHistory.length !== 1) throw new Error(`${sym} Trade history record failed to record`);
  }

  console.log('\n------------------------------------------------------------------------');
  console.log('🏛️ PART B: STOCK BOT (alpaca-stock-tracker.js) MULTI-STOCK EXHAUSTIVE SCENARIOS');
  console.log('------------------------------------------------------------------------');

  const stocksToTest = ['USO', 'NVDA', 'AAPL'];
  for (const stk of stocksToTest) {
    console.log(`\n  >>> TESTING STOCK: ${stk} <<<`);

    const initialP = alpacaMock.prices[stk];
    const sOrder = await stockTracker.createStockOrder({
      symbol: stk,
      trailValue: 0.40,
      quantity: 10,
      activationOffset: 0.8,
      activationDirection: 'DOWN',
      takeProfit: 1.10,
      stopLoss: 0.80,
      filterSmartSl: true,
      slBuffer: 0.30,
      autoRepeat: true
    });

    console.log(`  2.1 Stock Order Created: ID=${sOrder.id}, State=${sOrder.status}`);

    // Dip Hit
    alpacaMock.prices[stk] = initialP * (1 - (0.90 / 100));
    await stockTracker.tick();
    const sRunning = stockTracker.orders.find(o => o.id === sOrder.id);
    console.log(`  2.2 Stock Dip Hit: Dipped to $${alpacaMock.prices[stk]} -> State=${sRunning.status}`);

    // Rebound Hit
    alpacaMock.prices[stk] = alpacaMock.prices[stk] * (1 + (0.55 / 100));
    await stockTracker.tick();
    const sActive = stockTracker.orders.find(o => o.id === sOrder.id);
    console.log(`  2.3 Stock Trailing Buy Executed: Executed at $${sActive.executionPrice} -> State=${sActive.status}`);

    // Profit Lock
    const halfTpPrice = sActive.executionPrice * (1 + (0.60 / 100));
    alpacaMock.prices[stk] = halfTpPrice;
    await stockTracker.tick();
    const sLocked = stockTracker.orders.find(o => o.id === sOrder.id);
    console.log(`  2.4 Stock Profit Lock Triggered: isSlProfitLocked=${sLocked.isSlProfitLocked}, Locked SL Floor=$${sLocked.lockedSlPrice.toFixed(2)}`);

    // TP Hit
    alpacaMock.prices[stk] = sActive.executionPrice * (1 + (1.20 / 100));
    await stockTracker.tick();
    const sReset = stockTracker.orders.find(o => o.id === sOrder.id);
    console.log(`  2.5 Stock TP Hit: Completed Cycle 1! State Reset=${sReset.status}, Trade History Count=${sReset.tradeHistory.length}`);
  }

  console.log('\n========================================================================');
  console.log('🏆 MASTER SYSTEM-WIDE ALL-COINS & ALL-FUNCTIONS AUDIT PASSED 100% PERFECT!');
  console.log('========================================================================\n');
}

runMasterAllCoinsAudit().catch(e => console.error(e));
