const OrderTracker = require('../tracker');
const assert = require('assert');

class MockMexcClient {
  constructor() {
    this.tickerPrice = 1932.96;
    this.ordersPlaced = [];
    this.nextOrderId = 10001;
    this.balances = [{ asset: 'USDT', free: 1000, locked: 0 }];
    this.openOrdersMap = {};
    this.orderStatusMap = {};
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) { return this.tickerPrice; }

  async getBalances() { return this.balances; }

  async getDepth(symbol, limit) {
    return {
      bids: [["1932.90", "10.0"], ["1932.80", "15.0"]],
      asks: [["1933.00", "5.0"], ["1933.10", "8.0"]]
    };
  }

  async getKlines(symbol, interval, limit) {
    const klines = [];
    for (let i = 0; i < (limit || 25); i++) {
      klines.push([
        Date.now() - (i * 15 * 60 * 1000),
        "1930.00", "1940.00", "1925.00", "1932.96", "500.0"
      ]);
    }
    return klines;
  }

  async placeOrder(params) {
    const id = 'mexc_ord_' + (this.nextOrderId++);
    const orderObj = {
      orderId: id,
      symbol: params.symbol,
      side: params.side,
      type: params.type,
      price: params.price || this.tickerPrice,
      origQty: params.quantity || 0.0517,
      executedQty: params.quantity || 0.0517,
      cummulativeQuoteQty: (params.price || this.tickerPrice) * (params.quantity || 0.0517),
      status: 'FILLED'
    };
    this.ordersPlaced.push(orderObj);
    this.orderStatusMap[id] = orderObj;
    if (params.type === 'LIMIT' && params.side === 'SELL') {
      this.openOrdersMap[id] = orderObj;
      // Mark as NEW initially when placed
      orderObj.status = 'NEW';
      orderObj.executedQty = 0;
    }
    return { orderId: id, status: orderObj.status };
  }

  async getOrder(symbol, orderId) {
    return this.orderStatusMap[orderId] || { orderId, status: 'FILLED', price: this.tickerPrice, executedQty: 0.0517, cummulativeQuoteQty: 100.0 };
  }

  async getOpenOrders(symbol) {
    return Object.values(this.openOrdersMap).filter(o => o.symbol === symbol && o.status === 'NEW');
  }

  async getMyTrades(symbol, limit) {
    return [
      { price: "1932.96", qty: "0.0517", isBuyerMaker: false, commission: "0", commissionAsset: "USDT" },
      { price: "1944.55", qty: "0.0517", isBuyerMaker: true, commission: "0", commissionAsset: "USDT" }
    ];
  }
}

class MockSignalRadar {
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
        { name: 'MEXC', obiPct: this.avgObi, active: true }
      ]
    };
  }

  async getMultiExchangeMetrics(symbol) {
    return this.getRadarMetrics(symbol);
  }
}

async function runE2EVerification() {
  console.log("================================================================================");
  console.log("🧪 E2E LIFECYCLE QA AUDIT: DUAL GATE (OBI ≥ 55% & RSI ≤ 40) + TP + AUTO-RESET");
  console.log("================================================================================");

  const mockClient = new MockMexcClient();
  const mockRadar = new MockSignalRadar();
  const tracker = new OrderTracker(mockClient, null);
  tracker.setSignalRadar(mockRadar);

  // Clear any existing orders on disk to ensure clean test state
  tracker.orders = [];

  // STEP 1: Create Card with Dual Gate Enabled
  console.log("\n1️⃣ STEP 1: Creating Trading Card (Dual Gate Enabled)...");
  const card = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: 0.15,
    quoteOrderQty: 100,
    orderType: 'MARKET',
    dryRun: false,
    filterObi: true, // DUAL GATE ENABLED!
    takeProfit: 0.60,
    stopLoss: 0.0,
    autoRepeat: true,
    startImmediately: true // Form default passed!
  });

  console.log(`   Card Status on Creation: ${card.status}`);
  assert.strictEqual(card.status, 'PENDING_ACTIVATION', 'CRITICAL PASS: Card MUST start in PENDING_ACTIVATION (Waiting) mode!');
  assert.strictEqual(mockClient.ordersPlaced.length, 0, 'CRITICAL PASS: NO immediate buy order was sent to MEXC!');
  console.log("   ✅ STEP 1 PASSED: Card created in WAITING state without instant buy!");

  // STEP 2: Test Dual Gate Rejection (RSI > 40)
  console.log("\n2️⃣ STEP 2: Simulating Scan when Avg OBI = 58.5% (>= 55%) BUT 4h RSI = 48.2 (> 40)...");
  mockRadar.avgObi = 58.5;
  mockRadar.rsi4h = 48.2;
  await tracker.tick();

  assert.strictEqual(card.status, 'PENDING_ACTIVATION', 'CRITICAL PASS: Card safely stayed in PENDING_ACTIVATION because RSI 48.2 > 40.0!');
  assert.strictEqual(mockClient.ordersPlaced.length, 0, 'CRITICAL PASS: Zero buy orders sent when RSI > 40!');
  console.log("   ✅ STEP 2 PASSED: RSI > 40 restriction enforced!");

  // STEP 3: Test Dual Gate Rejection (OBI < 55)
  console.log("\n3️⃣ STEP 3: Simulating Scan when 4h RSI = 38.0 (<= 40) BUT Avg OBI = 51.2% (< 55%)...");
  mockRadar.avgObi = 51.2;
  mockRadar.rsi4h = 38.0;
  await tracker.tick();

  assert.strictEqual(card.status, 'PENDING_ACTIVATION', 'CRITICAL PASS: Card safely stayed in PENDING_ACTIVATION because OBI 51.2% < 55.0%!');
  assert.strictEqual(mockClient.ordersPlaced.length, 0, 'CRITICAL PASS: Zero buy orders sent when OBI < 55%!');
  console.log("   ✅ STEP 3 PASSED: OBI < 55% restriction enforced!");

  // STEP 4: Test Dual Gate CONFIRMED MATCH (OBI >= 55% AND RSI <= 40)
  console.log("\n4️⃣ STEP 4: Simulating DUAL GATE CONFIRMED MATCH (Avg OBI = 58.5% & 4h RSI = 38.5)...");
  mockRadar.avgObi = 58.5;
  mockRadar.rsi4h = 38.5;
  
  // Tick 1: Triggers Dual Gate -> PENDING_BUY
  await tracker.tick();
  assert.strictEqual(card.status, 'PENDING_BUY', 'Card transitioned to PENDING_BUY upon Dual Gate match.');

  // Tick 2: Executes Market Buy & Places Limit Sell TP Order on MEXC
  await tracker.tick();

  assert.strictEqual(card.status, 'TP_SL_ACTIVE', 'CRITICAL PASS: Card status transitioned to TP_SL_ACTIVE (Holding Position)!');
  assert.strictEqual(mockClient.ordersPlaced.length, 2, 'CRITICAL PASS: Market Buy order AND Limit Sell TP order placed on MEXC!');
  console.log(`   Market Buy Order ID: ${card.mexcOrderId}`);
  console.log(`   Limit Sell TP Order ID: ${card.mexcSellOrderId}`);
  console.log("   ✅ STEP 4 PASSED: Market Buy executed & Limit Sell TP order placed on MEXC!");

  // STEP 5: Test Holding Mode Safety
  console.log("\n5️⃣ STEP 5: Verifying Holding Mode Safety (No duplicate buys)...");
  const ordersCountBefore = mockClient.ordersPlaced.length;
  await tracker.tick();
  assert.strictEqual(mockClient.ordersPlaced.length, ordersCountBefore, 'CRITICAL PASS: No duplicate buys sent while holding position!');
  console.log("   ✅ STEP 5 PASSED: Position held safely without duplicate buys!");

  // STEP 6: Test Take Profit Fill & Card Auto-Reset to WAITING
  console.log("\n6️⃣ STEP 6: Simulating Limit Sell TP Fill on MEXC & Card Auto-Reset...");
  const tpOrderId = card.mexcSellOrderId;
  // Mark limit sell order as FILLED on MEXC and remove from open orders
  mockClient.orderStatusMap[tpOrderId].status = 'FILLED';
  mockClient.orderStatusMap[tpOrderId].price = 1944.55; // +0.60% TP price
  delete mockClient.openOrdersMap[tpOrderId];

  // Reset lastGhostCheckTime to 0 so the tracker tick immediately checks TP fill
  card.lastGhostCheckTime = 0;

  await tracker.tick();

  assert.strictEqual(card.status, 'PENDING_ACTIVATION', 'CRITICAL PASS: Card state auto-reset back to PENDING_ACTIVATION (Waiting)!');
  assert.strictEqual(card.tradeHistory.length, 1, 'CRITICAL PASS: Trade history recorded Cycle #1!');
  assert.strictEqual(card.tradeHistory[0].type, 'TAKE_PROFIT', 'Trade type is TAKE_PROFIT!');
  assert.ok(card.totalNetProfit > 0, `CRITICAL PASS: Net Profit accumulated (+${card.totalNetProfit.toFixed(4)} USDT)!`);

  console.log(`   Cycle #1 Recorded: Buy $${card.tradeHistory[0].buyPrice.toFixed(2)} → Sell $${card.tradeHistory[0].sellPrice.toFixed(2)} (Profit: +$${card.tradeHistory[0].profitUsdt.toFixed(4)} USDT)`);
  console.log("   ✅ STEP 6 PASSED: TP Fill detected, profit banked, and card auto-reset to WAITING!");

  console.log("\n================================================================================");
  console.log("🏆 ALL 6/6 E2E SCENARIOS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

runE2EVerification().catch(err => {
  console.error("❌ E2E VERIFICATION FAILED:", err);
  process.exit(1);
});
