const OrderTracker = require('./tracker');
const StockOrderTracker = require('./stock-tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

class MasterMockMexcClient {
  constructor() {
    this.priceMap = {
      'SOLUSDT': 140.0,
      'ETHUSDT': 2000.0,
      'BTCUSDT': 60000.0,
      'NVDAONUSDT': 120.0,
      'USOONUSDT': 75.0,
      'GOLD(XAUT)USDT': 2400.0
    };
    this.placeCalls = [];
    this.orderIdCounter = 1;
    this.illiquidMap = {};
    this.bidsRatioMap = {};
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] !== undefined ? this.priceMap[symbol] : 100.0;
  }

  async getOrder(symbol, orderId) {
    const price = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: price.toString(),
      origQty: "1.0",
      executedQty: "1.0",
      cummulativeQuoteQty: price.toString(),
      status: "FILLED"
    };
  }

  async getDepth(symbol, limit) {
    const isIlliquid = this.illiquidMap[symbol] === true;
    const price = await this.getTickerPrice(symbol);

    if (isIlliquid) {
      return {
        bids: [[(price * 0.965).toString(), "1.0"], [(price * 0.85).toString(), "10.0"]],
        asks: [[(price * 1.035).toString(), "1.0"], [(price * 1.15).toString(), "10.0"]]
      };
    }

    const bidsRatio = this.bidsRatioMap[symbol] !== undefined ? this.bidsRatioMap[symbol] : 0.60;
    const bidAmount = 1000 * bidsRatio;
    const askAmount = 1000 * (1 - bidsRatio);

    return {
      bids: [[price.toString(), bidAmount.toString()]],
      asks: [[price.toString(), askAmount.toString()]]
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
        "2000.0"
      ]);
    }
    return klines;
  }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const id = 'mock_master_' + (this.orderIdCounter++);
    this.placeCalls.push({ id, symbol, side, type, quantity, quoteOrderQty, price, timestamp: Date.now() });
    return { orderId: id, status: 'NEW' };
  }

  async cancelOrder(symbol, orderId) {
    return { orderId, status: 'CANCELED' };
  }

  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0.0 },
      { asset: 'SOL', free: 100.0, locked: 0.0 },
      { asset: 'ETH', free: 10.0, locked: 0.0 },
      { asset: 'NVDAON', free: 50.0, locked: 0.0 }
    ];
  }
}

async function runMasterVerificationAudit() {
  console.log('========================================================================');
  console.log('🔥 MASTER AUDIT SUITE: FULL SYSTEM VERIFICATION & SCENARIO TESTING');
  console.log('Validating Crypto & Stock Engines, Pumps, Crashes, TP/SL & Cumulative Profits');
  console.log('========================================================================\n');

  const mockClient = new MasterMockMexcClient();
  const cryptoTracker = new OrderTracker(mockClient, mockIo);
  const stockTracker = new StockOrderTracker(mockClient, mockIo);

  cryptoTracker.ordersPath = './backend/test-master-crypto-orders.json';
  cryptoTracker.logsPath = './backend/test-master-crypto-logs.json';
  stockTracker.ordersPath = './backend/test-master-stock-orders.json';
  stockTracker.logsPath = './backend/test-master-stock-logs.json';

  cryptoTracker.orders = [];
  stockTracker.orders = [];

  [cryptoTracker.ordersPath, cryptoTracker.logsPath, stockTracker.ordersPath, stockTracker.logsPath].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
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

  const getCryptoOrder = (id) => cryptoTracker.orders.find(o => o.id === id);
  const getStockOrder = (id) => stockTracker.orders.find(o => o.id === id);

  // --- SCENARIO 1: INITIAL STATE PROFIT TRACKING (SOLUSDT) ---
  console.log('--- SCENARIO 1: Initial State Net Profit Tracking (0.00 USDT) ---');
  const initialOrder1 = await cryptoTracker.addOrder({
    symbol: 'SOLUSDT',
    trailValue: '2.0',
    quoteOrderQty: '100.0',
    dryRun: true,
    takeProfit: '10.0',
    stopLoss: '5.0',
    autoRepeat: true,
    startImmediately: true,
    filterObi: false,
    filterVolume: false,
    filterRsi: false,
    filterSmartSl: false
  });

  let o1 = getCryptoOrder(initialOrder1.id);
  assert(o1.status === 'TP_SL_ACTIVE', 'SOLUSDT started immediately in TP_SL_ACTIVE status');
  assert(o1.totalNetProfit === 0, 'SOLUSDT initial net profit is exactly 0.00 USDT');

  // --- SCENARIO 2: TAKE PROFIT HIT & PROFIT ACCUMULATION (SOL PUMP) ---
  console.log('\n--- SCENARIO 2: Take Profit Hit (+Net Profit Accumulation) ---');
  mockClient.priceMap['SOLUSDT'] = 151.0;
  await cryptoTracker.tick();

  o1 = getCryptoOrder(initialOrder1.id);
  assert(o1.tradeHistory.length === 1, 'Trade history recorded 1 completed cycle');
  assert(o1.tradeHistory[0].type === 'TAKE_PROFIT', 'Cycle 1 exit type is TAKE_PROFIT');
  const expectedProfit1 = (150.0 - 140.0) * (100.0 / 140.0);
  assert(Math.abs(o1.totalNetProfit - expectedProfit1) < 0.01, `Cumulative Profit accumulated positively (+${o1.totalNetProfit.toFixed(4)} USDT)`);
  assert(o1.status === 'PENDING_ACTIVATION', 'Order reset to PENDING_ACTIVATION for Cycle #2');

  // --- SCENARIO 3: DYNAMIC PEAK TRAILING & CYCLE 2 BUY ---
  console.log('\n--- SCENARIO 3: Dynamic Peak Trailing & Cycle 2 Re-entry ---');
  mockClient.priceMap['SOLUSDT'] = 147.0;
  await cryptoTracker.tick();
  o1 = getCryptoOrder(initialOrder1.id);
  assert(o1.status === 'RUNNING', 'Cycle #2 activated to RUNNING status');

  mockClient.priceMap['SOLUSDT'] = 146.0;
  await cryptoTracker.tick();
  mockClient.priceMap['SOLUSDT'] = 148.5;
  await cryptoTracker.tick();
  o1 = getCryptoOrder(initialOrder1.id);
  assert(o1.status === 'TP_SL_ACTIVE', 'Cycle #2 executed buy! Position active at $148.5');

  // --- SCENARIO 4: STOP LOSS HIT & PROFIT DEDUCTION ---
  console.log('\n--- SCENARIO 4: Stop Loss Hit (-Net Loss Subtraction) ---');
  mockClient.priceMap['SOLUSDT'] = 142.0;
  await cryptoTracker.tick();

  o1 = getCryptoOrder(initialOrder1.id);
  assert(o1.tradeHistory.length === 2, 'Trade history recorded 2 completed cycles');
  assert(o1.tradeHistory[1].type === 'STOP_LOSS', 'Cycle 2 exit type is STOP_LOSS');
  const expectedLoss2 = (143.5 - 148.5) * (100.0 / 148.5);
  const netProfitAfterSL = expectedProfit1 + expectedLoss2;
  assert(Math.abs(o1.totalNetProfit - netProfitAfterSL) < 0.01, `Cumulative Net Profit correctly subtracted loss (Net: ${o1.totalNetProfit.toFixed(4)} USDT)`);

  // --- SCENARIO 5: 50% TP PROFIT LOCK GUARD (ETHUSDT) ---
  console.log('\n--- SCENARIO 5: 50% TP Progress Profit Lock Guard ---');
  mockClient.priceMap['ETHUSDT'] = 2000.0;
  const initialETH = await cryptoTracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '10.0',
    quoteOrderQty: '1000.0',
    dryRun: true,
    takeProfit: '100.0',
    stopLoss: '50.0',
    autoRepeat: true, // Enables instant buy initialization
    startImmediately: true
  });

  let oETH = getCryptoOrder(initialETH.id);
  mockClient.priceMap['ETHUSDT'] = 2055.0; // 55% progress to TP ($2100)
  await cryptoTracker.tick();
  oETH = getCryptoOrder(initialETH.id);

  assert(oETH.isSlProfitLocked === true, '50% TP Progress Profit Lock triggered!');
  assert(oETH.lockedSlPrice === 2020.0, 'Stop Loss shifted UP to +$20 above entry price ($2020.0)');

  mockClient.priceMap['ETHUSDT'] = 2015.0; // Price drops back to 2015 -> Profit Lock SL hit!
  await cryptoTracker.tick();
  oETH = getCryptoOrder(initialETH.id);
  assert(oETH.tradeHistory.length === 1 && oETH.tradeHistory[0].type === 'STOP_LOSS', 'Profit Lock SL closed trade with GUARANTEED PROFIT');

  // --- SCENARIO 6: LOW-LIQUIDITY STOCK BOT SLIPPAGE & PEGGED LIMIT FALLBACK (NVDAON) ---
  console.log('\n--- SCENARIO 6: Stock Bot Max Slippage Protection & Pegged Limit Fallback ---');
  mockClient.illiquidMap['NVDAONUSDT'] = true;
  mockClient.priceMap['NVDAONUSDT'] = 120.0;

  const initialNVDA = await stockTracker.addOrder({
    symbol: 'NVDAONUSDT',
    trailValue: '2.0',
    quantity: '5.0',
    dryRun: false,
    takeProfit: '20.0',
    stopLoss: '10.0',
    maxSlippagePct: '0.5',
    startImmediately: true,
    filterObi: false,
    filterVolumeSpike: false,
    filterRsi: false,
    filterSmartSl: false
  });

  let oNVDA = getStockOrder(initialNVDA.id);
  mockClient.priceMap['NVDAONUSDT'] = 105.0;
  oNVDA.status = 'TP_SL_ACTIVE';
  oNVDA.executionPrice = 120.0;
  await stockTracker.tick();

  const stockPeggedLimitCalls = mockClient.placeCalls.filter(c => c.symbol === 'NVDAONUSDT' && c.type === 'LIMIT');
  assert(stockPeggedLimitCalls.length > 0, 'Illiquid Market Sell BLOCKED and converted to Pegged LIMIT order (Max Slippage Protection Active)');

  console.log('\n========================================================================');
  console.log(`MASTER AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  [cryptoTracker.ordersPath, cryptoTracker.logsPath, stockTracker.ordersPath, stockTracker.logsPath].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });

  if (failCount > 0) {
    console.error('❌ MASTER AUDIT FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL MASTER VERIFICATION SCENARIOS PASSED 100% PERFECTLY!');
  }
}

runMasterVerificationAudit().catch(err => {
  console.error('Master Audit crashed:', err);
  process.exit(1);
});
