const assert = require('assert');
const OrderTracker = require('../tracker');

// Mock Signal Radar simulating multi-exchange aggregated metrics
class MasterMockSignalRadar {
  constructor() {
    this.avgObi = 58.5;
    this.rsi4h = 38.5;
  }

  getRadarMetrics(symbol) {
    return {
      symbol,
      averageObiPct: this.avgObi,
      averageRsi15m: this.rsi4h,
      exchanges: [
        { name: 'Binance', obiPct: this.avgObi, active: true },
        { name: 'MEXC', obiPct: this.avgObi, active: true },
        { name: 'Bybit', obiPct: this.avgObi, active: true }
      ]
    };
  }

  async getMultiExchangeMetrics(symbol) {
    return this.getRadarMetrics(symbol);
  }
}

// Mock MEXC Client simulating live spot trading execution
class MasterMockMexcClient {
  constructor() {
    this.orderCounter = 10000;
    this.openOrdersMap = {};
    this.orderStatusMap = {};
    this.simulatedPriceMap = { 'ETHUSDT': 1932.96, 'HYPEUSDT': 54.30 };
    this.balancesMap = {
      'USDT': { free: '1000.00', locked: '0.00' },
      'ETH': { free: '0.00', locked: '0.00' },
      'HYPE': { free: '0.00', locked: '0.00' }
    };
  }

  hasCredentials() { return true; }

  async getBalances() {
    return Object.keys(this.balancesMap).map(asset => ({
      asset,
      free: this.balancesMap[asset].free,
      locked: this.balancesMap[asset].locked
    }));
  }

  async getAllPrices() {
    return { 'ETHUSDT': String(this.simulatedPriceMap['ETHUSDT']), 'HYPEUSDT': String(this.simulatedPriceMap['HYPEUSDT']) };
  }

  async getTickerPrice(symbol) {
    return this.simulatedPriceMap[symbol] || 1932.96;
  }

  async getOpenOrders(symbol) {
    return Object.values(this.openOrdersMap).filter(o => o.symbol === symbol);
  }

  async getOrder(symbol, orderId) {
    return this.orderStatusMap[orderId] || null;
  }

  async cancelOrder(symbol, orderId) {
    if (this.openOrdersMap[orderId]) {
      const ord = this.openOrdersMap[orderId];
      delete this.openOrdersMap[orderId];
      const asset = symbol.replace('USDT', '');
      const qty = parseFloat(ord.origQty || 0);
      if (this.balancesMap[asset]) {
        this.balancesMap[asset].free = String(parseFloat(this.balancesMap[asset].free) + qty);
        this.balancesMap[asset].locked = String(Math.max(0, parseFloat(this.balancesMap[asset].locked) - qty));
      }
      return { orderId, status: 'CANCELED' };
    }
    return { orderId, status: 'CANCELED' };
  }

  async placeOrder(params) {
    this.orderCounter++;
    const orderId = 'mexc_master_' + this.orderCounter;
    const price = parseFloat(params.price || this.simulatedPriceMap[params.symbol] || 100);
    const qty = parseFloat(params.quantity || 1);
    const asset = params.symbol.replace('USDT', '');

    if (params.side === 'BUY') {
      if (!this.balancesMap[asset]) this.balancesMap[asset] = { free: '0.00', locked: '0.00' };
      this.balancesMap[asset].free = String(parseFloat(this.balancesMap[asset].free) + qty);
    } else if (params.side === 'SELL' && params.type === 'LIMIT') {
      if (this.balancesMap[asset]) {
        this.balancesMap[asset].free = String(Math.max(0, parseFloat(this.balancesMap[asset].free) - qty));
        this.balancesMap[asset].locked = String(parseFloat(this.balancesMap[asset].locked) + qty);
      }
    } else if (params.side === 'SELL' && params.type === 'MARKET') {
      if (this.balancesMap[asset]) {
        this.balancesMap[asset].free = '0.00';
        this.balancesMap[asset].locked = '0.00';
      }
    }

    const orderObj = { orderId, ...params, price: String(price), origQty: String(qty), executedQty: params.type === 'MARKET' ? String(qty) : '0', status: params.type === 'MARKET' ? 'FILLED' : 'NEW' };
    if (params.type === 'LIMIT') {
      this.openOrdersMap[orderId] = orderObj;
    }
    this.orderStatusMap[orderId] = orderObj;
    return { orderId, price, executedQty: qty };
  }
}

async function runMasterFullSystemQA() {
  console.log("================================================================================");
  console.log("🛡️ MASTER FULL SYSTEM QA AUDIT & FUNCTION CALL-CHAIN VERIFICATION SUITE");
  console.log("================================================================================");

  const mockClient = new MasterMockMexcClient();
  const mockRadar = new MasterMockSignalRadar();
  const tracker = new OrderTracker(mockClient, null);
  tracker.setSignalRadar(mockRadar);
  tracker.orders = []; // Clean state

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Card Creation & Safety Guard Verification
  // ---------------------------------------------------------------------------
  console.log("\n1️⃣ SCENARIO 1: Card Creation & Instant Buy Safety Guard Audit...");
  const cardData = {
    symbol: 'ETHUSDT',
    quoteOrderQty: 100,
    takeProfit: 0.6,
    filterObi: true,
    autoRepeat: true,
    startImmediately: false
  };

  const card = await tracker.addOrder(cardData);
  assert.strictEqual(card.status, 'PENDING_ACTIVATION', '✅ SCENARIO 1 PASS: Card created in PENDING_ACTIVATION (Waiting) mode!');
  assert.strictEqual(card.executionPrice, null, '✅ SCENARIO 1 PASS: Instant market buy skipped on card creation!');
  assert.strictEqual(tracker.orders.length, 1, '✅ SCENARIO 1 PASS: Exactly 1 card created (No duplication)!');
  console.log("   Card Status: PENDING_ACTIVATION (Waiting)");
  console.log("   Instant Buy Execution: SKIPPED (Zero instant buy on creation)");

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Dual Gate Scan Restrictions (OBI < 55% or RSI > 40)
  // ---------------------------------------------------------------------------
  console.log("\n2️⃣ SCENARIO 2: Dual Gate Restriction Enforcement (RSI > 40 & OBI < 55%)...");
  
  // Test A: Avg OBI = 58.5% (>= 55%) BUT 4h RSI = 48.2 (> 40)
  mockRadar.avgObi = 58.5;
  mockRadar.rsi4h = 48.2;
  await tracker.tick();
  assert.strictEqual(card.status, 'PENDING_ACTIVATION', '✅ SCENARIO 2A PASS: Card safely stayed in Waiting mode when RSI 48.2 > 40.0!');

  // Test B: 4h RSI = 38.0 (<= 40) BUT Avg OBI = 51.2% (< 55%)
  mockRadar.avgObi = 51.2;
  mockRadar.rsi4h = 38.0;
  await tracker.tick();
  assert.strictEqual(card.status, 'PENDING_ACTIVATION', '✅ SCENARIO 2B PASS: Card safely stayed in Waiting mode when OBI 51.2% < 55.0%!');
  console.log("   RSI > 40 Restriction: ENFORCED (Zero buy)");
  console.log("   OBI < 55% Restriction: ENFORCED (Zero buy)");

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Dual Gate Match Confirmed (OBI >= 55% & RSI <= 40)
  // ---------------------------------------------------------------------------
  console.log("\n3️⃣ SCENARIO 3: Dual Gate Confirmed Match & Market Buy Execution...");
  mockRadar.avgObi = 58.5;
  mockRadar.rsi4h = 38.5;

  await tracker.tick(); // Dual gate match confirmation -> PENDING_BUY
  await tracker.tick(); // Execute Market Buy on MEXC & Place Limit Sell TP (+0.6%) -> TP_SL_ACTIVE

  assert.strictEqual(card.status, 'TP_SL_ACTIVE', '✅ SCENARIO 3 PASS: Dual Gate matched! Card transitioned to TP_SL_ACTIVE (Holding)!');
  assert.strictEqual(card.executionPrice, 1932.96, '✅ SCENARIO 3 PASS: Market Buy executed at $1932.96 USDT!');
  assert.notStrictEqual(card.mexcSellOrderId, null, '✅ SCENARIO 3 PASS: Placed Limit Sell TP (+0.6%) order on MEXC!');
  
  const tpTargetPrice = card.executionPrice * (1 + (card.takeProfit / 100));
  console.log(`   Market Buy Order ID: ${card.mexcOrderId}`);
  console.log(`   Execution Price: $${card.executionPrice.toFixed(4)} USDT`);
  console.log(`   Limit Sell TP Order ID: ${card.mexcSellOrderId}`);
  console.log(`   Take Profit Target Price: $${tpTargetPrice.toFixed(4)} USDT (+0.6%)`);

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Position Holding & Duplicate Buy Prevention
  // ---------------------------------------------------------------------------
  console.log("\n4️⃣ SCENARIO 4: Position Holding & Duplicate Buy Prevention...");
  await tracker.tick();
  await tracker.tick();

  assert.strictEqual(card.status, 'TP_SL_ACTIVE', '✅ SCENARIO 4 PASS: Card held position safely without sending duplicate buys!');
  assert.strictEqual(Object.keys(mockClient.orderStatusMap).length, 2, '✅ SCENARIO 4 PASS: Exactly 1 Buy & 1 Limit Sell TP order placed (Zero duplicate buys)!');
  console.log("   Duplicate Buy Protection: 100% PASS (Zero duplicate buys)");

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Take Profit Target Hit & Auto-Reset Cycle Complete
  // ---------------------------------------------------------------------------
  console.log("\n5️⃣ SCENARIO 5: Take Profit Target Hit ($1945.00 >= $1944.56) & Card Auto-Reset...");
  mockClient.simulatedPriceMap['ETHUSDT'] = 1945.00; // Spike price past TP target
  card.currentPrice = 1945.00;

  await tracker.tick();

  assert.strictEqual(card.status, 'PENDING_ACTIVATION', '✅ SCENARIO 5 PASS: TP target hit! Card completed cycle & auto-reset to PENDING_ACTIVATION (Waiting)!');
  assert.strictEqual(card.tradeHistory.length, 1, '✅ SCENARIO 5 PASS: Cycle #1 recorded in trade history!');
  assert.strictEqual(card.totalNetProfit > 0, true, `✅ SCENARIO 5 PASS: Net profit banked (+${card.totalNetProfit.toFixed(4)} USDT)!`);

  console.log(`   Completed Cycle #1: Buy $${card.tradeHistory[0].buyPrice} → Sell $${card.tradeHistory[0].sellPrice}`);
  console.log(`   Net Profit Banked: +$${card.totalNetProfit.toFixed(4)} USDT`);
  console.log(`   Card Status After Reset: ${card.status} (Ready for next dip)`);

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Physical Wallet Asset Auto-Sync on Restart / Creation
  // ---------------------------------------------------------------------------
  console.log("\n6️⃣ SCENARIO 6: Physical Wallet Asset Startup & In-Tick Auto-Sync...");
  
  // Simulate 0.27 HYPE ($15.40 USDT) held in MEXC wallet with Limit Sell Order #mexc_hype_999
  mockClient.balancesMap['HYPE'] = { free: '0.01', locked: '0.27' };
  mockClient.openOrdersMap['mexc_hype_999'] = { orderId: 'mexc_hype_999', symbol: 'HYPEUSDT', side: 'SELL', price: '54.45', origQty: '0.27', executedQty: '0', status: 'NEW' };
  mockClient.orderStatusMap['mexc_hype_999'] = { orderId: 'mexc_hype_999', symbol: 'HYPEUSDT', side: 'SELL', price: '54.45', origQty: '0.27', executedQty: '0', status: 'NEW' };

  const hypeCard = {
    id: 'hype_card_test_999',
    symbol: 'HYPEUSDT',
    status: 'PENDING_ACTIVATION',
    takeProfit: 0.5,
    stopLoss: 0.0,
    quoteOrderQty: 15,
    autoRepeat: true,
    executionPrice: null,
    mexcSellOrderId: null
  };
  tracker.orders.push(hypeCard);

  console.log("   Running tick() on HYPEUSDT with 0.27 HYPE ($15.40 USDT) in wallet...");
  await tracker.tick();

  assert.strictEqual(hypeCard.status, 'TP_SL_ACTIVE', '✅ SCENARIO 6 PASS: HYPE Card status FORCED from Waiting to TP_SL_ACTIVE (Holding)!');
  assert.strictEqual(hypeCard.mexcSellOrderId, 'mexc_hype_999', '✅ SCENARIO 6 PASS: Attached MEXC Limit Sell Order ID mexc_hype_999!');
  assert.strictEqual(Math.abs(hypeCard.executionPrice - 54.1791) < 0.01, true, `✅ SCENARIO 6 PASS: Calculated exact Bought At price ($${hypeCard.executionPrice.toFixed(4)})`);

  console.log(`   Card Status After Auto-Sync: ${hypeCard.status} (Holding)`);
  console.log(`   Bought At Price: $${hypeCard.executionPrice.toFixed(4)} USDT`);
  console.log(`   Attached MEXC Limit Sell Order ID: ${hypeCard.mexcSellOrderId}`);
  console.log(`   Calculated TP Target Price: $${(hypeCard.executionPrice * 1.005).toFixed(4)} USDT (+0.5%)`);

  console.log("\n================================================================================");
  console.log("🏆 ALL 6/6 MASTER QA AUDIT SCENARIOS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

runMasterFullSystemQA().catch(err => {
  console.error("❌ MASTER QA AUDIT FAILED:", err);
  process.exit(1);
});
