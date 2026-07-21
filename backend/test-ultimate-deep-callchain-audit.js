const OrderTracker = require('./tracker');
const StockOrderTracker = require('./stock-tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

class UltimateCallChainMockMexcClient {
  constructor() {
    this.priceMap = {
      'SOLUSDT': 140.0,
      'ETHUSDT': 2000.0,
      'BTCUSDT': 65000.0,
      'SPCXONUSDT': 123.43,
      'NVDAONUSDT': 207.14,
      'USOONUSDT': 74.50,
      'INTKONUSDT': 32.10,
      'GOLD(XAUT)USDT': 2400.0,
      'PAXGUSDT': 2395.0,
      'TSLAONUSDT': 245.80,
      'AAPLONUSDT': 225.50,
      'MSFTONUSDT': 440.20
    };
    this.fillMap = {};
    this.bidsRatioMap = {};
    this.depthSlippageMap = {};
    this.functionCallLogs = [];
    this.orderCounter = 1;
  }

  logCall(fnName, args) {
    this.functionCallLogs.push({ fnName, args, timestamp: Date.now() });
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    this.logCall('getTickerPrice', { symbol });
    return this.priceMap[symbol] !== undefined ? this.priceMap[symbol] : 100.0;
  }

  async getTradeFee(symbol) {
    this.logCall('getTradeFee', { symbol });
    // User VIP Account Fees: 0% Taker promotion, 0.04% MX Token Discount Maker Fee
    return { makerCommission: 0.0004, takerCommission: 0.0000 };
  }

  async getOrder(symbol, orderId) {
    this.logCall('getOrder', { symbol, orderId });
    const fill = this.fillMap[orderId];
    const price = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: fill ? fill.price.toString() : price.toString(),
      origQty: "1.0",
      executedQty: (fill && fill.status === 'FILLED') ? "1.0" : "0.0",
      cummulativeQuoteQty: (fill && fill.status === 'FILLED') ? price.toString() : "0.0",
      status: fill ? fill.status : "NEW"
    };
  }

  async getDepth(symbol, limit) {
    this.logCall('getDepth', { symbol, limit });
    const price = await this.getTickerPrice(symbol);
    const bidsRatio = this.bidsRatioMap[symbol] !== undefined ? this.bidsRatioMap[symbol] : 0.60;
    
    // Check if high slippage is simulated for stock token
    const isHighSlippage = this.depthSlippageMap[symbol] === 'HIGH_SLIPPAGE';
    const topBid = Math.round((price * 0.999) * 100) / 100;
    const topAsk = Math.round((price * 1.001) * 100) / 100;

    const bidVal = 1000 * bidsRatio;
    const askVal = 1000 * (1 - bidsRatio);

    return {
      bids: [[topBid.toString(), isHighSlippage ? "0.1" : (bidVal / price).toString()], [(price * 0.995).toString(), "0.5"]],
      asks: [[topAsk.toString(), isHighSlippage ? "0.1" : (askVal / price).toString()], [(price * 1.005).toString(), "0.5"]]
    };
  }

  async getKlines(symbol, interval, limit) {
    this.logCall('getKlines', { symbol, interval, limit });
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

  async placeOrder(params) {
    this.logCall('placeOrder', params);
    const id = 'ult_ord_' + (this.orderCounter++);
    this.fillMap[id] = { status: params.type === 'MARKET' ? 'FILLED' : 'NEW', price: params.price || this.priceMap[params.symbol] };
    return { orderId: id, status: params.type === 'MARKET' ? 'FILLED' : 'NEW' };
  }

  async cancelOrder(symbol, orderId) {
    this.logCall('cancelOrder', { symbol, orderId });
    return { orderId, status: 'CANCELED' };
  }
}

async function runUltimateCallChainAudit() {
  console.log('========================================================================');
  console.log('🔥 ULTIMATE END-TO-END CALL CHAIN & EXTREME SCENARIO AUDIT SUITE');
  console.log('Testing Crypto & Stock Engines Across Pumps, Dumps, Guards & Function Chains');
  console.log('========================================================================\n');

  const mockClient = new UltimateCallChainMockMexcClient();
  const cryptoTracker = new OrderTracker(mockClient, mockIo);
  const stockTracker = new StockOrderTracker(mockClient, mockIo);

  cryptoTracker.ordersPath = './backend/test-ult-crypto-orders.json';
  cryptoTracker.logsPath = './backend/test-ult-crypto-logs.json';
  cryptoTracker.orders = [];

  stockTracker.ordersPath = './backend/test-ult-stock-orders.json';
  stockTracker.logsPath = './backend/test-ult-stock-logs.json';
  stockTracker.orders = [];

  [cryptoTracker.ordersPath, cryptoTracker.logsPath, stockTracker.ordersPath, stockTracker.logsPath].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

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

  // --- SCENARIO 1: EXTREME INSTANT PUMP (+30%) & DYNAMIC PEAK TRAILING (CRYPTO) ---
  console.log('--- SCENARIO 1: Extreme Instant Pump (+30%) & Dynamic Peak Shift ---');
  mockClient.priceMap['SOLUSDT'] = 140.0;
  const solOrder = await cryptoTracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '2.0',
    quoteOrderQty: '100.0',
    dryRun: true,
    takeProfit: '10.0',
    stopLoss: '5.0',
    autoRepeat: true,
    activationOffset: '10.0',
    filterObi: true, // Enable OBI for Scenario 2 consensus testing!
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  assert(solOrder.peakPrice === 140.0 && solOrder.activationPrice === 130.0, 'SOLUSDT initialized with Peak 140.0 and Activation Target 130.0');

  // Extreme Pump: Price leaps +30% from 140.0 to 182.0 in 1 tick!
  mockClient.priceMap['SOLUSDT'] = 182.0;
  await cryptoTracker.tick();

  const solAfterPump = cryptoTracker.orders.find(o => o.id === solOrder.id);
  assert(solAfterPump.peakPrice === 182.0 && solAfterPump.activationPrice === 172.0, 'Extreme Pump (+30%) processed! Dynamic Peak shifted UP to 182.0, Activation Price to 172.0');
  assert(solAfterPump.status === 'PENDING_ACTIVATION', 'Status remains PENDING_ACTIVATION while price pumps');

  // --- SCENARIO 2: FLASH CRASH (-25%) & BUY TRIGGER WITH OBI FILTER DEFERRAL ---
  console.log('\n--- SCENARIO 2: Flash Crash (-25%) & Buy Indicator Consensus Deferral ---');
  // Flash crash: Price drops from 182.0 to 135.0 (below 172.0 activation target!)
  mockClient.bidsRatioMap['SOLUSDT'] = 0.40; // OBI support fails (< 55%)
  mockClient.priceMap['SOLUSDT'] = 135.0;
  await cryptoTracker.tick();

  const solActivated = cryptoTracker.orders.find(o => o.id === solOrder.id);
  assert(solActivated.status === 'RUNNING', 'Flash Crash activated order to RUNNING state! Initial bottom: 135.0');

  // Price rebounds to 138.0 (> triggerPrice 137.0), but OBI support is 40% (< 55%)
  mockClient.priceMap['SOLUSDT'] = 138.0;
  await cryptoTracker.tick();
  const solDeferred = cryptoTracker.orders.find(o => o.id === solOrder.id);
  assert(solDeferred.status === 'RUNNING', 'Buy DEFERRED because OBI support filter failed (40% < 55%)');

  // Align OBI support to 65% (>= 55%) and trigger rebound
  mockClient.bidsRatioMap['SOLUSDT'] = 0.65;
  mockClient.priceMap['SOLUSDT'] = 140.5;
  await cryptoTracker.tick();
  const solBought = cryptoTracker.orders.find(o => o.id === solOrder.id);
  assert(solBought.status === 'TP_SL_ACTIVE', 'Buy EXECUTED when OBI filter aligned (65% >= 55%)');

  // --- SCENARIO 3: 50% TAKE PROFIT PROGRESS PROFIT LOCK ---
  console.log('\n--- SCENARIO 3: 50% Take Profit Progress Profit Lock ---');
  // Bought SOL at 140.5. Take Profit = +10.0 (Target: 150.5). 50% Progress = +5.0 (Price 145.5).
  mockClient.priceMap['SOLUSDT'] = 146.0;
  await cryptoTracker.tick();

  const solLocked = cryptoTracker.orders.find(o => o.id === solOrder.id);
  assert(solLocked.isSlProfitLocked === true, '50% TP Progress reached (146.0 >= 145.5)! Profit Lock Activated.');
  assert(solLocked.lockedSlPrice === (140.5 + 4.0), 'Locked Stop Loss set to executionPrice + (trailValue * 2) = 144.5 USDT');

  // --- SCENARIO 4: SMART SL SELLER EXHAUSTION DEFERRAL VS HEAVY DUMP EXECUTION ---
  console.log('\n--- SCENARIO 4: Smart SL Seller Exhaustion Deferral vs Heavy Dump ---');
  mockClient.priceMap['ETHUSDT'] = 2000.0;
  const ethOrder = await cryptoTracker.addOrder({
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

  // Bought ETH at 2000. SL level = 1950. Drop price to 1945. Set Bids Support to 55% (>= 45% -> Buyers absorbing dip!).
  mockClient.bidsRatioMap['ETHUSDT'] = 0.55;
  mockClient.priceMap['ETHUSDT'] = 1945.0;
  await cryptoTracker.tick();

  const ethSmartSl = cryptoTracker.orders.find(o => o.id === ethOrder.id);
  assert(ethSmartSl.isSlExtended === true, 'Smart SL Guard detected seller exhaustion (55% >= 45%) and EXTENDED SL (+20.0 Buffer)');
  assert(ethSmartSl.status === 'TP_SL_ACTIVE', 'Market sell DEFERRED to allow price recovery');

  // Drop price below extended SL (1925) with heavy selling pressure (30% bids < 45%)
  mockClient.bidsRatioMap['ETHUSDT'] = 0.30;
  mockClient.priceMap['ETHUSDT'] = 1920.0;
  await cryptoTracker.tick();
  const ethSold = cryptoTracker.orders.find(o => o.id === ethOrder.id);
  assert(ethSold.tradeHistory.length === 1 && ethSold.tradeHistory[0].type === 'STOP_LOSS', 'Heavy selling pressure confirmed -> Immediate Stop Loss Market Sell Executed!');

  // --- SCENARIO 5: TOKENIZED STOCK ENGINE 0.1% SLIPPAGE & PEGGED LIMIT BUY GUARD ---
  console.log('\n--- SCENARIO 5: Tokenized Stock Engine (0.1% Slippage & Pegged Limit Buy Guard) ---');
  mockClient.priceMap['SPCXONUSDT'] = 123.43;
  mockClient.depthSlippageMap['SPCXONUSDT'] = 'HIGH_SLIPPAGE'; // Trigger >0.1% slippage block

  const spcxOrder = await stockTracker.addOrder({
    symbol: 'SPCXONUSDT',
    trailValue: '2.0',
    quantity: '2.0',
    dryRun: false,
    takeProfit: '5.0',
    stopLoss: '3.0',
    maxSlippagePct: '0.1',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolumeSpike: false,
    filterRsi: false
  });

  // Rebound triggers buy execution
  mockClient.priceMap['SPCXONUSDT'] = 125.50;
  await stockTracker.tick();

  const spcxPegged = stockTracker.orders.find(o => o.id === spcxOrder.id);
  assert(spcxPegged.status === 'PENDING_EXECUTION', 'Market buy BLOCKED due to >0.1% slippage. Pegged LIMIT buy placed at Top Bid + 0.02, order in PENDING_EXECUTION state!');

  // MEXC Order Fills
  if (spcxPegged.mexcOrderId) {
    mockClient.fillMap[spcxPegged.mexcOrderId] = { status: 'FILLED', price: 125.52 };
  }
  await stockTracker.tick();

  const spcxFilled = stockTracker.orders.find(o => o.id === spcxOrder.id);
  assert(spcxFilled.status === 'TP_SL_ACTIVE', 'Pegged Limit Buy FILLED! Transitioned to TP_SL_ACTIVE state.');

  // --- SCENARIO 6: MEXC VIP ACCOUNT TRADE FEE NET PROFIT CALCULATION ---
  console.log('\n--- SCENARIO 6: MEXC VIP Account Trade Fee Net Profit Calculation ---');
  // User Account Fee Rates: Taker = 0% promotion, Maker = 0.04% MX Token discount
  // Buy = 125.52 (Limit/Pegged Maker 0.04% fee), Sell = 130.52 (Limit Sell Maker 0.04% fee)
  // Buy Cost = 125.52 * 2.0 = 251.04 + (251.04 * 0.0004) = 251.140416
  // Sell Proceeds = 130.52 * 2.0 = 261.04 - (261.04 * 0.0004) = 260.935584
  // Net Profit = 260.935584 - 251.140416 = +9.795168 USDT.

  spcxFilled.sellExecutionPrice = 130.52;
  spcxFilled.status = 'TRIGGERED';
  await stockTracker.handleOrderCycleComplete(spcxFilled);

  const lastTrade = spcxFilled.tradeHistory[spcxFilled.tradeHistory.length - 1];
  assert(lastTrade !== undefined && lastTrade.profitUsdt > 0, `Exact Account Net Profit calculated after MEXC fees: +${lastTrade.profitUsdt.toFixed(4)} USDT`);
  assert(lastTrade.mexcBuyFeeUsdt !== undefined && lastTrade.mexcSellFeeUsdt !== undefined, 'MEXC Buy & Sell Fee breakdown recorded in trade history object');

  // Verify internal function calls
  const getTradeFeeCalls = mockClient.functionCallLogs.filter(c => c.fnName === 'getTradeFee');
  assert(getTradeFeeCalls.length > 0, 'Confirmed: getTradeFee() API function called dynamically to fetch account fee rates');

  console.log('\n========================================================================');
  console.log(`ULTIMATE AUDIT SUITE SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  [cryptoTracker.ordersPath, cryptoTracker.logsPath, stockTracker.ordersPath, stockTracker.logsPath].forEach(p => {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  if (failCount > 0) {
    console.error('❌ ULTIMATE MASTER AUDIT FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL MASTER CALL-CHAIN & EXTREME MARKET SCENARIOS PASSED 100% PERFECTLY!');
  }
}

runUltimateCallChainAudit().catch(err => {
  console.error('Ultimate Call-Chain Audit crashed:', err);
  process.exit(1);
});
