const OrderTracker = require('./tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

class ExactFillMockMexcClient {
  constructor() {
    this.priceMap = {
      'SOLUSDT': 140.0,
      'ETHUSDT': 2000.0
    };
    this.fillMap = {};
    this.bidsRatioMap = {};
    this.orderCounter = 1;
    this.placeCalls = [];
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] !== undefined ? this.priceMap[symbol] : 100.0;
  }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const id = 'mexc_fill_ord_' + (this.orderCounter++);
    this.placeCalls.push({ id, symbol, side, type, quantity, quoteOrderQty, price });
    return { orderId: id, status: 'NEW' };
  }

  async getOrder(symbol, orderId) {
    const exactFill = this.fillMap[orderId];
    if (exactFill) {
      return {
        symbol,
        orderId,
        price: exactFill.price.toString(),
        origQty: exactFill.qty.toString(),
        executedQty: exactFill.qty.toString(),
        cummulativeQuoteQty: (exactFill.price * exactFill.qty).toString(),
        status: "FILLED"
      };
    }
    const currentPrice = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: currentPrice.toString(),
      origQty: "1.0",
      executedQty: "1.0",
      cummulativeQuoteQty: currentPrice.toString(),
      status: "FILLED"
    };
  }

  async getDepth(symbol, limit) {
    const price = await this.getTickerPrice(symbol);
    const bidsRatio = this.bidsRatioMap[symbol] !== undefined ? this.bidsRatioMap[symbol] : 0.60;
    const bidValue = 1000 * bidsRatio;
    const askValue = 1000 * (1 - bidsRatio);

    return {
      bids: [[price.toString(), (bidValue / price).toString()]],
      asks: [[price.toString(), (askValue / price).toString()]]
    };
  }

  async getKlines(symbol, interval, limit) {
    const price = await this.getTickerPrice(symbol);
    const klines = [];
    for (let i = 0; i < (limit || 30); i++) {
      klines.push([
        Date.now() - (30 - i) * 60000,
        (price * 0.99).toString(),
        (price * 1.01).toString(),
        (price * 0.98).toString(),
        price.toString(),
        "3000.0"
      ]);
    }
    return klines;
  }

  async cancelOrder(symbol, orderId) {
    return { orderId, status: 'CANCELED' };
  }

  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0.0 },
      { asset: 'SOL', free: 100.0, locked: 0.0 },
      { asset: 'ETH', free: 10.0, locked: 0.0 }
    ];
  }
}

async function runExactFillsAndIndicatorsTest() {
  console.log('========================================================================');
  console.log('🔥 DRY-RUN SIMULATION AUDIT: MEXC EXACT FILLS & INDICATOR VERIFICATION');
  console.log('Testing Exact Fill Price PnL, Buy Filter Consensus, & Smart SL Deferral');
  console.log('========================================================================\n');

  const mockClient = new ExactFillMockMexcClient();
  const tracker = new OrderTracker(mockClient, mockIo);

  tracker.ordersPath = './backend/test-exact-crypto-orders.json';
  tracker.logsPath = './backend/test-exact-crypto-logs.json';
  tracker.orders = [];

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);

  let passCount = 0;
  let failCount = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failCount++;
    }
  }

  // --- TEST 1: BUY CONFIRMATION FILTERS (OBI, Volume, RSI) ---
  console.log('--- TEST 1: Buy Entry Indicator Confirmation Alignment ---');
  // Set OBI to fail (< 55% bids ratio, e.g. 40%)
  mockClient.bidsRatioMap['SOLUSDT'] = 0.40;
  mockClient.priceMap['SOLUSDT'] = 140.0;

  const order1 = await tracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '2.0',
    quoteOrderQty: '100.0',
    dryRun: true,
    takeProfit: '10.0',
    stopLoss: '5.0',
    activationPrice: '138.0', // Pending activation
    autoRepeat: true,
    filterObi: true, // Enable OBI filter
    filterVolume: false,
    filterRsi: false
  });

  // Price dips to 137 (Activates to RUNNING)
  mockClient.priceMap['SOLUSDT'] = 137.0;
  await tracker.tick();
  assert(order1.status === 'RUNNING', 'SOLUSDT activated to RUNNING state');

  // Rebounds to 139 (Buy trigger price reached), but OBI support is 40% < 55%!
  mockClient.priceMap['SOLUSDT'] = 139.5;
  await tracker.tick();
  assert(order1.status === 'RUNNING', 'Buy DEFERRED because OBI filter failed (40% < 55%)');

  // Now fix OBI support to 65% (>= 55%)
  mockClient.bidsRatioMap['SOLUSDT'] = 0.65;
  await tracker.tick();
  assert(order1.status === 'TP_SL_ACTIVE', 'Buy EXECUTED when OBI filter aligned (65% >= 55%)');

  // --- TEST 2: SMART SL SELLER EXHAUSTION DEFERRAL VS IMMEDIATE DUMP ---
  console.log('\n--- TEST 2: Smart SL Seller Exhaustion Deferral vs Heavy Dump ---');
  const orderSmartSl = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '10.0',
    quoteOrderQty: '1000.0',
    dryRun: true,
    takeProfit: '100.0',
    stopLoss: '50.0',
    filterSmartSl: true,
    slBuffer: '20.0',
    autoRepeat: true,
    startImmediately: true
  });

  // Bought ETH at $2000. SL level = $1950.
  // Drop price to $1945 (touches SL level). Set Bids Support to 55% (>= 45% -> Buyers absorbing dip!).
  mockClient.bidsRatioMap['ETHUSDT'] = 0.55;
  mockClient.priceMap['ETHUSDT'] = 1945.0;
  await tracker.tick();

  const oETH = tracker.orders.find(o => o.id === orderSmartSl.id);
  assert(oETH.isSlExtended === true, 'Smart SL Guard detected seller exhaustion (55% >= 45%) and EXTENDED SL (+20.0 Buffer)');
  assert(oETH.status === 'TP_SL_ACTIVE', 'Market sell DEFERRED to allow price recovery');

  // Drop price further below extended SL ($1925) with heavy selling pressure (30% bids < 45%)
  mockClient.bidsRatioMap['ETHUSDT'] = 0.30;
  mockClient.priceMap['ETHUSDT'] = 1920.0;
  await tracker.tick();
  const oETH_after = tracker.orders.find(o => o.id === orderSmartSl.id);
  assert(oETH_after.tradeHistory.length === 1 && oETH_after.tradeHistory[0].type === 'STOP_LOSS', 'Heavy selling pressure confirmed -> Immediate Stop Loss Market Sell Executed!');

  // --- TEST 3: MEXC EXACT FILL PRICE PROFIT CALCULATION ---
  console.log('\n--- TEST 3: MEXC Exact Fill Execution Price Net Profit Calculation ---');
  // Buy fill price = $140.50 (instead of requested $140.00 due to slippage)
  // Sell fill price = $150.80 (instead of target $150.00)
  // USDT Investment = $100. Quantity = 100 / 140.50 = 0.71174 tokens.
  // Net Profit = (150.80 - 140.50) * (100 / 140.50) = 10.30 * 0.71174 = +7.3309 USDT.

  const buyFillPrice = 140.50;
  const sellFillPrice = 150.80;
  const qty = 100.0 / buyFillPrice;
  const expectedExactProfit = (sellFillPrice - buyFillPrice) * qty;

  const mockCycleOrder = {
    symbol: 'SOLUSDT',
    status: 'TRIGGERED',
    autoRepeat: true,
    executionPrice: buyFillPrice, // Exact MEXC Buy Fill
    sellExecutionPrice: sellFillPrice, // Exact MEXC Sell Fill
    currentPrice: sellFillPrice,
    takeProfit: 10.0,
    quoteOrderQty: 100.0,
    quantity: qty,
    tradeHistory: [],
    totalNetProfit: 0
  };

  tracker.handleOrderCycleComplete(mockCycleOrder);
  assert(mockCycleOrder.tradeHistory.length === 1, 'Completed trade cycle recorded in history');
  assert(Math.abs(mockCycleOrder.totalNetProfit - expectedExactProfit) < 0.0001, `Exact MEXC Fill PnL calculated accurately (+${mockCycleOrder.totalNetProfit.toFixed(4)} USDT)`);

  console.log('\n========================================================================');
  console.log(`EXACT FILLS & INDICATORS SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (fs.existsSync(tracker.ordersPath)) fs.unlinkSync(tracker.ordersPath);
  if (fs.existsSync(tracker.logsPath)) fs.unlinkSync(tracker.logsPath);

  if (failCount > 0) {
    console.error('❌ SIMULATION AUDIT FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL MEXC EXACT FILL & INDICATOR SCENARIOS PASSED 100% PERFECTLY!');
  }
}

runExactFillsAndIndicatorsTest().catch(err => {
  console.error('Simulation Audit crashed:', err);
  process.exit(1);
});
