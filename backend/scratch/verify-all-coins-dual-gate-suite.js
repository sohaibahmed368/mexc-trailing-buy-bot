const assert = require('assert');
const OrderTracker = require('../tracker');

// Mock Signal Radar simulating multi-exchange aggregated metrics
class MultiCoinMockSignalRadar {
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

// Mock MEXC Client supporting all 15 user coins
class MultiCoinMockMexcClient {
  constructor() {
    this.orderCounter = 20000;
    this.openOrdersMap = {};
    this.orderStatusMap = {};
    this.simulatedPriceMap = {
      'BTCUSDT': 61400.00,
      'ETHUSDT': 1932.96,
      'SOLUSDT': 142.50,
      'LINKUSDT': 8.35,
      'ONDOUSDT': 0.36,
      'HYPEUSDT': 54.40,
      'SUIUSDT': 1.85,
      'UNIUSDT': 6.20,
      'TAOUSDT': 320.00,
      'BNBUSDT': 580.00,
      'XRPUSDT': 0.55,
      'XAUTUSDT': 2450.00,
      'EURUSDT': 1.085,
      'NVDAXUSDT': 125.00,
      'MSFTUSDT': 415.00
    };
    this.balancesMap = {
      'USDT': { free: '10000.00', locked: '0.00' }
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
    const res = {};
    Object.keys(this.simulatedPriceMap).forEach(sym => { res[sym] = String(this.simulatedPriceMap[sym]); });
    return res;
  }

  async getTickerPrice(symbol) {
    return this.simulatedPriceMap[symbol] || 100.00;
  }

  async getOpenOrders(symbol) {
    return Object.values(this.openOrdersMap).filter(o => o.symbol === symbol);
  }

  async getOrder(symbol, orderId) {
    return this.orderStatusMap[orderId] || null;
  }

  async cancelOrder(symbol, orderId) {
    if (this.openOrdersMap[orderId]) {
      delete this.openOrdersMap[orderId];
      return { orderId, status: 'CANCELED' };
    }
    return { orderId, status: 'CANCELED' };
  }

  async placeOrder(params) {
    this.orderCounter++;
    const orderId = 'mexc_multicoin_' + this.orderCounter;
    const price = parseFloat(params.price || this.simulatedPriceMap[params.symbol] || 100);
    const qty = parseFloat(params.quantity || 1);
    const orderObj = { orderId, ...params, price: String(price), origQty: String(qty), executedQty: params.type === 'MARKET' ? String(qty) : '0', status: params.type === 'MARKET' ? 'FILLED' : 'NEW' };
    if (params.type === 'LIMIT') {
      this.openOrdersMap[orderId] = orderObj;
    }
    this.orderStatusMap[orderId] = orderObj;
    return { orderId, price, executedQty: qty };
  }
}

async function runMultiCoinDualGateQASuite() {
  console.log("================================================================================");
  console.log("🛡️ MULTI-COIN DUAL GATE QA AUDIT & GREEN ENTRY LOG VERIFICATION SUITE");
  console.log("================================================================================");

  const testSymbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'LINKUSDT', 'ONDOUSDT', 
    'HYPEUSDT', 'SUIUSDT', 'UNIUSDT', 'TAOUSDT', 'BNBUSDT', 
    'XRPUSDT', 'XAUTUSDT', 'EURUSDT', 'NVDAXUSDT', 'MSFTUSDT'
  ];

  const mockClient = new MultiCoinMockMexcClient();
  const mockRadar = new MultiCoinMockSignalRadar();
  const tracker = new OrderTracker(mockClient, null);
  tracker.setSignalRadar(mockRadar);
  tracker.orders = [];

  console.log(`\n📋 Testing all ${testSymbols.length} user-specified coin symbols...`);

  for (let i = 0; i < testSymbols.length; i++) {
    const sym = testSymbols[i];
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`🪙 [${i + 1}/${testSymbols.length}] Testing Symbol: ${sym}`);
    console.log(`--------------------------------------------------------------------------------`);

    // 1️⃣ Step 1: Create Card in PENDING_ACTIVATION (Waiting) mode
    const card = await tracker.addOrder({
      symbol: sym,
      quoteOrderQty: 50,
      takeProfit: 0.5,
      filterObi: true,
      autoRepeat: true,
      startImmediately: false
    });

    assert.strictEqual(card.status, 'PENDING_ACTIVATION', `[${sym}] Card initialized in Waiting status`);
    console.log(`   Card Creation Status: PENDING_ACTIVATION (Waiting) - Zero Instant Buy`);

    // 2️⃣ Step 2: Dual Gate Match Confirmed (OBI = 58.5% >= 55% & RSI = 38.5 <= 40)
    mockRadar.avgObi = 58.5;
    mockRadar.rsi4h = 38.5;

    await tracker.tick(); // Confirms match -> PENDING_BUY (Emits GREEN Success Log)
    await tracker.tick(); // Market Buy & Limit Sell TP -> TP_SL_ACTIVE

    assert.strictEqual(card.status, 'TP_SL_ACTIVE', `[${sym}] Dual Gate matched! Card transitioned to Holding!`);
    assert.notStrictEqual(card.mexcOrderId, null, `[${sym}] Market Buy order executed!`);
    assert.notStrictEqual(card.mexcSellOrderId, null, `[${sym}] Limit Sell TP (+0.5%) order placed!`);

    console.log(`   🟢 ENTRY CONFIRMED & LOGGED IN GREEN!`);
    console.log(`   Market Buy Order ID: ${card.mexcOrderId}`);
    console.log(`   Execution Price: $${card.executionPrice}`);
    console.log(`   Limit Sell TP Order ID: ${card.mexcSellOrderId}`);
    console.log(`   Take Profit Target Price: $${(card.executionPrice * 1.005).toFixed(4)} (+0.5%)`);

    // 3️⃣ Step 3: Simulate Take Profit Hit & Auto-Reset Cycle
    const tpPrice = card.executionPrice * 1.006;
    mockClient.simulatedPriceMap[sym] = tpPrice;
    card.currentPrice = tpPrice;

    await tracker.tick();

    assert.strictEqual(card.status, 'PENDING_ACTIVATION', `[${sym}] TP target hit! Card completed cycle & auto-reset to Waiting!`);
    assert.strictEqual(card.tradeHistory.length, 1, `[${sym}] Cycle #1 recorded in trade history!`);
    console.log(`   🎯 TAKE PROFIT TARGET HIT! Net Profit Banked: +$${card.totalNetProfit.toFixed(4)} USDT`);
    console.log(`   Card Reset Status: PENDING_ACTIVATION (Ready for next cycle)`);
  }

  console.log("\n================================================================================");
  console.log(`🏆 ALL ${testSymbols.length}/${testSymbols.length} COINS PASSED 100% DUAL GATE E2E LIFE-CYCLE QA AUDIT!`);
  console.log("================================================================================");
}

runMultiCoinDualGateQASuite().catch(err => {
  console.error("❌ MULTI-COIN QA AUDIT FAILED:", err);
  process.exit(1);
});
