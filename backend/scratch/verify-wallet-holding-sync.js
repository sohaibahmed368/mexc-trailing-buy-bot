const assert = require('assert');
const OrderTracker = require('../tracker');

// Mock MEXC Client simulating 0.27 HYPE ($15.40 USDT) held in spot wallet with Limit Sell Order #mexc_hype_777 @ $54.45
class MockMexcClientForWalletSync {
  constructor() {
    this.openOrdersMap = {
      'mexc_hype_777': { orderId: 'mexc_hype_777', symbol: 'HYPEUSDT', side: 'SELL', price: '54.45', origQty: '0.27', executedQty: '0', status: 'NEW' }
    };
    this.orderStatusMap = {
      'mexc_hype_777': { orderId: 'mexc_hype_777', symbol: 'HYPEUSDT', side: 'SELL', price: '54.45', origQty: '0.27', executedQty: '0', status: 'NEW' }
    };
    this.simulatedPrice = 54.30;
  }

  hasCredentials() { return true; }

  async getBalances() {
    return [
      { asset: 'USDT', free: '100.00', locked: '0.00' },
      { asset: 'HYPE', free: '0.01', locked: '0.27' }
    ];
  }

  async getMyTrades(symbol, limit) {
    return [
      { price: '54.1791', qty: '0.27', isBuyer: true, time: Date.now() - 60000 }
    ];
  }

  async getAllPrices() {
    return { 'HYPEUSDT': String(this.simulatedPrice), 'ETHUSDT': '1932.96' };
  }

  async getTickerPrice(symbol) {
    if (symbol === 'HYPEUSDT') return this.simulatedPrice;
    return 1932.96;
  }

  async getOpenOrders(symbol) {
    return Object.values(this.openOrdersMap).filter(o => o.symbol === symbol);
  }

  async getOrder(symbol, orderId) {
    return this.orderStatusMap[orderId] || null;
  }

  async cancelOrder(symbol, orderId) {
    delete this.openOrdersMap[orderId];
    return { orderId, status: 'CANCELED' };
  }

  async placeOrder(params) {
    const orderId = 'mexc_ord_' + Date.now();
    const orderObj = { orderId, ...params, status: 'NEW' };
    this.openOrdersMap[orderId] = orderObj;
    this.orderStatusMap[orderId] = orderObj;
    return { orderId };
  }
}

async function runWalletHoldingSyncAudit() {
  console.log("================================================================================");
  console.log("🧪 QA AUDIT SUITE: PHYSICAL WALLET ASSET AUTO-SYNC & TP EXECUTION GUARD");
  console.log("================================================================================");

  const mockClient = new MockMexcClientForWalletSync();
  const tracker = new OrderTracker(mockClient, null);
  tracker.orders = []; // Clear in-memory orders

  // 1️⃣ STEP 1: Create a HYPE card in PENDING_ACTIVATION (Waiting) mode
  console.log("\n1️⃣ STEP 1: Creating HYPEUSDT card in Waiting (PENDING_ACTIVATION) mode...");
  const hypeCard = {
    id: 'hype_card_test_001',
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

  assert.strictEqual(hypeCard.status, 'PENDING_ACTIVATION', 'Card initialized in Waiting status');
  console.log("   Card Status before sync: PENDING_ACTIVATION (Waiting)");

  // 2️⃣ STEP 2: Run syncLiveWalletOrders() when price ($54.30) is below TP target ($54.45)
  console.log("\n2️⃣ STEP 2: Running syncLiveWalletOrders() when price ($54.30) is below TP target ($54.45)...");
  await tracker.syncLiveWalletOrders();

  assert.strictEqual(hypeCard.status, 'TP_SL_ACTIVE', '✅ CRITICAL PASS: HYPE Card status forced from Waiting to TP_SL_ACTIVE (Holding)!');
  assert.strictEqual(hypeCard.mexcSellOrderId, 'mexc_hype_777', '✅ CRITICAL PASS: Attached MEXC Limit Sell Order ID mexc_hype_777!');
  assert.strictEqual(Math.abs(hypeCard.executionPrice - 54.1791) < 0.01, true, `✅ CRITICAL PASS: Calculated exact Bought At price ($${hypeCard.executionPrice.toFixed(4)})`);
  
  console.log(`   Card Status after sync: ${hypeCard.status} (Holding)`);
  console.log(`   Bought At Price: $${hypeCard.executionPrice.toFixed(4)}`);
  console.log(`   Attached MEXC Limit Sell Order ID: ${hypeCard.mexcSellOrderId}`);
  console.log(`   Calculated TP Target Price: $${(hypeCard.executionPrice * 1.005).toFixed(4)} (+0.5%)`);

  // 3️⃣ STEP 3: Test TP Target Hit ($55.04 >= $54.45) & Market Sell Fallback Execution
  console.log("\n3️⃣ STEP 3: Simulating Price Spike ($55.04 >= $54.45) on next tick...");
  mockClient.simulatedPrice = 55.04;
  hypeCard.currentPrice = 55.04;
  
  await tracker.tick();

  assert.strictEqual(hypeCard.status, 'PENDING_ACTIVATION', '✅ CRITICAL PASS: TP Target hit ($55.04 >= $54.45), Market Sell executed, profit banked & card auto-reset to PENDING_ACTIVATION (Waiting)!');
  console.log(`   Card Status after TP Hit: ${hypeCard.status} (Waiting for next dip)`);
  console.log(`   Total Net Profit Recorded: +${hypeCard.totalNetProfit.toFixed(4)} USDT`);
  console.log(`   Completed Cycles Count: ${hypeCard.tradeHistory.length}`);

  console.log("\n================================================================================");
  console.log("🏆 ALL QA AUDIT SUITE TESTS PASSED WITH 100% SUCCESS!");
  console.log("================================================================================");
}

runWalletHoldingSyncAudit().catch(err => {
  console.error("❌ QA AUDIT FAILED:", err);
  process.exit(1);
});
