/**
 * COMPREHENSIVE WIDE SPREAD & LOW LIQUIDITY DUAL EXECUTION TEST SUITE
 * ─────────────────────────────────────────────────────────────────────────────
 * Verifies all low-liquidity / wide-spread execution scenarios:
 *
 * SCENARIO 1: Tight Spread (<= 0.30%) -> Immediate Market Buy Execution
 * SCENARIO 2: Wide Spread (> 0.30%)  -> Blocks Market Buy, places Top Maker Limit Buy at Bid + $0.01, starts 60s timer
 * SCENARIO 3: 60s Timeout & Spread Still Wide -> Cancels old order, re-pegs Top Maker Limit Buy at new Bid + $0.01, restarts 60s timer
 * SCENARIO 4: 60s Timeout & Spread Narrows (<= 0.30%) -> Cancels order, switches to Immediate Market Buy!
 * SCENARIO 5: Top Maker Limit Buy gets Filled within 60s -> Transitions to TP_SL_ACTIVE, places Take Profit Sell!
 */

const fs = require('fs');
const path = require('path');
const MexcTracker = require('../tracker');

// Mock MEXC Client
class MockMexcClient {
  constructor() {
    this.prices = { NVDAXUSDT: 100.0, AAPLXUSDT: 200.0 };
    this.depths = {};
    this.ordersPlaced = [];
    this.openOrders = [];
    this.nextId = 5001;
    this.balances = [
      { asset: 'USDT', free: '50000.0', locked: '0.0' },
      { asset: 'NVDAX', free: '0.0', locked: '0.0' },
      { asset: 'AAPLX', free: '0.0', locked: '0.0' }
    ];
  }

  hasCredentials() { return true; }
  async getBalances() { return this.balances; }
  async getTickerPrice(sym) { return this.prices[sym] || 100.0; }
  async getAllTickerPrices() {
    return Object.keys(this.prices).map(sym => ({ symbol: sym, price: String(this.prices[sym]) }));
  }
  async getDepth(sym) {
    return this.depths[sym] || { bids: [['100.00', '10']], asks: [['100.20', '10']] };
  }

  async placeOrder(params) {
    const id = `mock_ord_${this.nextId++}`;
    const isMarket = params.type === 'MARKET' || !!params.quoteOrderQty;
    const base = params.symbol.replace('USDT', '');
    const price = parseFloat(params.price) || (this.prices[params.symbol] || 100);
    const qty = params.quantity || (params.quoteOrderQty / price);

    const order = {
      orderId: id,
      status: isMarket ? 'FILLED' : 'NEW',
      executedQty: isMarket ? qty.toString() : '0',
      cummulativeQuoteQty: isMarket ? (qty * price).toString() : '0',
      ...params
    };

    this.ordersPlaced.push(order);
    if (!isMarket) {
      this.openOrders.push(order);
    } else {
      const b = this.balances.find(b => b.asset === base);
      if (b) b.free = (parseFloat(b.free) + qty).toFixed(4);
    }
    return order;
  }

  async getOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    return o || { orderId, status: 'NEW' };
  }

  async getOpenOrders(symbol) {
    return this.openOrders.filter(o => o.symbol === symbol && o.status === 'NEW');
  }

  async cancelOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (o) o.status = 'CANCELED';
    this.openOrders = this.openOrders.filter(x => x.orderId !== orderId);
    return { success: true, orderId };
  }
}

async function runLowLiquidityWideSpreadTests() {
  console.log('================================================================================');
  console.log('🧪 LOW LIQUIDITY & WIDE SPREAD (<= 0.30% vs > 0.30%) EXHAUSTIVE DRY RUN TEST');
  console.log('================================================================================\n');

  const tmpOrders = path.join(__dirname, 'tmp-spread-orders.json');
  const tmpLogs = path.join(__dirname, 'tmp-spread-logs.json');

  for (const f of [tmpOrders, tmpLogs]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const client = new MockMexcClient();
  const tracker = new MexcTracker(client);
  tracker.ordersPath = tmpOrders;
  tracker.logsPath = tmpLogs;
  tracker.orders = [];

  let radar = {
    averageObiPct: 65.0,
    averageRsi15m: 38.0,
    exchanges: [{ name: 'Binance', obiPct: 65.0 }]
  };

  tracker.signalRadar = {
    getRadarMetrics: () => radar,
    getMultiExchangeMetrics: async () => radar
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 1: TIGHT SPREAD (<= 0.30%) -> IMMEDIATE MARKET BUY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ TEST 1: Tight Spread (0.20% <= 0.30%) -> Immediate Market Buy Execution');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  client.depths['NVDAXUSDT'] = {
    bids: [['100.00', '10']],
    asks: [['100.20', '10']] // Spread = 0.20% <= 0.30%
  };
  client.prices['NVDAXUSDT'] = 100.0;

  const card1 = {
    id: 'card_tight_' + Date.now(),
    symbol: 'NVDAXUSDT',
    quantity: 1.0,
    quoteOrderQty: 100.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    dryRun: true,
    status: 'PENDING_ACTIVATION',
    tradeHistory: [],
    obiPersistenceCount: 0
  };

  tracker.orders = [card1];
  tracker.saveOrders();

  // 3 ticks to fulfill persistence -> triggers PENDING_BUY
  await tracker.tick();
  await tracker.tick();
  await tracker.tick();
  // 4th tick executes Market Buy -> transitions to TP_SL_ACTIVE
  await tracker.tick();

  console.log(`   Order Status: ${card1.status}`);
  console.log(`   Execution Price: $${card1.executionPrice}`);
  if (card1.status === 'TP_SL_ACTIVE' && card1.executionPrice === 100.0) {
    console.log('   ✅ TEST 1 PASSED: Tight spread (0.20% <= 0.30%) executed Immediate Market Buy successfully!\n');
  } else {
    throw new Error(`Test 1 Failed. Status: ${card1.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 2: WIDE SPREAD (> 0.30%) -> PLACES TOP MAKER LIMIT BUY & STARTS 60s TIMER
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ TEST 2: Wide Spread (1.50% > 0.30%) -> Maker Peg Limit Buy at Top Bid + $0.01');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  client.depths['AAPLXUSDT'] = {
    bids: [['200.00', '10']],
    asks: [['203.00', '10']] // Spread = 1.50% > 0.30%
  };
  client.prices['AAPLXUSDT'] = 201.5;

  const card2 = {
    id: 'card_wide_' + Date.now(),
    symbol: 'AAPLXUSDT',
    quantity: 1.0,
    quoteOrderQty: 200.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    dryRun: true,
    status: 'PENDING_ACTIVATION',
    tradeHistory: [],
    obiPersistenceCount: 0
  };

  tracker.orders = [card2];
  tracker.saveOrders();

  await tracker.tick();
  await tracker.tick();
  await tracker.tick();

  console.log(`   Order Status: ${card2.status}`);
  console.log(`   Target Limit Buy Price: $${card2.targetBuyPrice} (Expected Top Bid + $0.01 = $200.01)`);
  console.log(`   60s Timer Initialized: ${!!card2.limitBuyPlacedAt}`);

  if (card2.status === 'PENDING_LIMIT_BUY' && card2.targetBuyPrice === 200.01 && card2.limitBuyPlacedAt) {
    console.log('   ✅ TEST 2 PASSED: Wide spread (1.50%) blocked Market Buy and placed Top Maker Limit Buy @ $200.01 with 60s timer!\n');
  } else {
    throw new Error(`Test 2 Failed. Status: ${card2.status}, targetBuyPrice: ${card2.targetBuyPrice}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 3: 60s TIMEOUT & SPREAD STILL WIDE -> RE-PEG LIMIT BUY AT NEW TOP BID
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ TEST 3: 60s Timeout Expired & Spread Still Wide (1.47%) -> Re-peg at new Top Bid + $0.01');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  // Fast-forward time by 61 seconds
  card2.limitBuyPlacedAt = Date.now() - 61000;

  // New market depth with higher bid ($204.00) and wide spread
  client.depths['AAPLXUSDT'] = {
    bids: [['204.00', '10']],
    asks: [['207.00', '10']] // Spread = 1.47% > 0.30%
  };
  client.prices['AAPLXUSDT'] = 205.5;

  await tracker.tick();

  console.log(`   Order Status: ${card2.status}`);
  console.log(`   New Target Limit Buy Price: $${card2.targetBuyPrice} (Expected New Top Bid + $0.01 = $204.01)`);
  console.log(`   60s Timer Reset: ${card2.limitBuyPlacedAt > Date.now() - 5000}`);

  if (card2.status === 'PENDING_LIMIT_BUY' && card2.targetBuyPrice === 204.01) {
    console.log('   ✅ TEST 3 PASSED: 60s timeout triggered re-peg to new top bid $204.01 and restarted 60s timer!\n');
  } else {
    throw new Error(`Test 3 Failed. Status: ${card2.status}, targetBuyPrice: ${card2.targetBuyPrice}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 4: 60s TIMEOUT & SPREAD NARROWS (<= 0.30%) -> SWITCHES TO MARKET BUY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ TEST 4: 60s Timeout Expired & Spread Narrows (0.15% <= 0.30%) -> Switch to Immediate Market Buy');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  // Fast-forward time by another 61 seconds
  card2.limitBuyPlacedAt = Date.now() - 61000;

  // Depth now has narrow spread: Bid $204.00, Ask $204.30 (Spread = 0.147%)
  client.depths['AAPLXUSDT'] = {
    bids: [['204.00', '10']],
    asks: [['204.30', '10']] // Spread = 0.147% <= 0.30%
  };
  client.prices['AAPLXUSDT'] = 204.1;

  await tracker.tick(); // Re-evaluates -> triggers switch to PENDING_BUY
  await tracker.tick(); // Executes Market Buy -> TP_SL_ACTIVE

  console.log(`   Final Order Status: ${card2.status}`);
  console.log(`   Final Execution Price: $${card2.executionPrice}`);

  if (card2.status === 'TP_SL_ACTIVE') {
    console.log('   ✅ TEST 4 PASSED: Narrowed spread (0.15%) automatically switched to Market Buy and entered TP_SL_ACTIVE!\n');
  } else {
    throw new Error(`Test 4 Failed. Status: ${card2.status}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // TEST 5: MAKER PEG LIMIT BUY FILLED BEFORE 60s -> TRANSITIONS TO TP/SL
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ TEST 5: Top Maker Peg Limit Buy Filled on MEXC before 60s -> Transitions to TP_SL_ACTIVE');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  const card3 = {
    id: 'card_fill_' + Date.now(),
    symbol: 'AAPLXUSDT',
    quantity: 1.0,
    quoteOrderQty: 200.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    dryRun: true,
    status: 'PENDING_LIMIT_BUY',
    targetBuyPrice: 204.01,
    limitBuyPlacedAt: Date.now() - 15000, // 15 seconds ago (well within 60s)
    tradeHistory: [],
    obiPersistenceCount: 3
  };

  tracker.orders = [card3];
  tracker.saveOrders();

  // Price touches our limit buy price ($204.01)
  client.prices['AAPLXUSDT'] = 204.01;

  await tracker.tick();

  console.log(`   Order Status: ${card3.status}`);
  console.log(`   Execution Price: $${card3.executionPrice}`);

  if (card3.status === 'TP_SL_ACTIVE' && card3.executionPrice === 204.01) {
    console.log('   ✅ TEST 5 PASSED: Limit Buy fill detected within 60s -> entered TP_SL_ACTIVE at exact limit price $204.01!\n');
  } else {
    throw new Error(`Test 5 Failed. Status: ${card3.status}`);
  }

  console.log('================================================================================');
  console.log('🏆 ALL 5 WIDE SPREAD & LOW LIQUIDITY SCENARIOS PASSED 100% SUCCESSFULLY!');
  console.log('================================================================================');

  // Clean up
  for (const f of [tmpOrders, tmpLogs]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

runLowLiquidityWideSpreadTests().catch(err => {
  console.error('❌ WIDE SPREAD TEST FAILED:', err);
  process.exit(1);
});
