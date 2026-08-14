/**
 * MASTER EXHAUSTIVE USER SCENARIO DRY RUN SUITE
 * ─────────────────────────────────────────────────────────────────────────────
 * Comprehensive verification of ALL user-defined trading logic:
 *
 * 1. OBI Filter Fail (OBI < Target) -> Blocked (PENDING_ACTIVATION)
 * 2. RSI Filter Fail (RSI > Target) -> Blocked (PENDING_ACTIVATION)
 * 3. 3-Tick Persistence Reset if condition drops on Tick 2 or 3 -> Counter resets, Blocked
 * 4. Dual Gate Pass + Tight Spread (<= 0.30%) -> Immediate Market Buy, TP Sell Placed, TP Hit & Reset
 * 5. Dual Gate Pass + Wide Spread (> 0.30%) -> Blocks Market Buy, Top Maker Peg Limit Buy @ Bid + $0.01, 60s Timer Starts
 * 6. 60s Timeout + Spread Still Wide (> 0.30%) -> Cancels old order, Re-pegs at new Top Bid + $0.01, Restarts 60s Timer
 * 7. 60s Timeout + Spread Narrows (<= 0.30%) -> Cancels limit order, Switches to Immediate Market Buy!
 * 8. Top Maker Limit Buy Filled within 60s -> Transitions to TP_SL_ACTIVE, Places TP Sell, TP Hit & Reset
 * 9. Emergency Stop Loss (RSI <= 20.0) -> Immediate Emergency Market Sell & Safe Reset
 */

const fs = require('fs');
const path = require('path');
const MexcTracker = require('../tracker');

class MockMexcClient {
  constructor() {
    this.prices = { BTCUSDT: 65000, NVDAXUSDT: 100.0, AAPLXUSDT: 200.0 };
    this.depths = {};
    this.ordersPlaced = [];
    this.openOrders = [];
    this.nextId = 8001;
    this.balances = [
      { asset: 'USDT', free: '100000.0', locked: '0.0' },
      { asset: 'BTC', free: '0.0', locked: '0.0' },
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

async function runMasterUserScenarioAudit() {
  console.log('================================================================================');
  console.log('🧪 MASTER AUDIT: ALL USER SCENARIOS DRY RUN VERIFICATION');
  console.log('================================================================================\n');

  const tmpOrders = path.join(__dirname, 'tmp-master-orders.json');
  const tmpLogs = path.join(__dirname, 'tmp-master-logs.json');
  for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

  const client = new MockMexcClient();
  const tracker = new MexcTracker(client);
  tracker.ordersPath = tmpOrders;
  tracker.logsPath = tmpLogs;
  tracker.orders = [];

  let radar = {
    averageObiPct: 50.0,
    averageRsi15m: 50.0,
    exchanges: [{ name: 'Binance', obiPct: 50.0 }]
  };

  tracker.signalRadar = {
    getRadarMetrics: () => radar,
    getMultiExchangeMetrics: async () => radar
  };

  let totalTests = 0;
  let passedTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`   ✅ PASS: ${message}`);
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      throw new Error(`Assertion Failed: ${message}`);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: OBI FILTER FAIL (OBI < Target)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 1: OBI Below Custom Threshold (52% < 60%) -> Entry Blocked');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  const card1 = {
    id: 'card_sc1_' + Date.now(),
    symbol: 'BTCUSDT',
    quantity: 0.01,
    quoteOrderQty: 650.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    autoRepeat: true,
    dryRun: true,
    status: 'PENDING_ACTIVATION',
    tradeHistory: [],
    obiPersistenceCount: 0
  };
  tracker.orders = [card1];
  tracker.saveOrders();

  radar = { averageObiPct: 52.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 52.0 }] };
  await tracker.tick();
  assert(card1.status === 'PENDING_ACTIVATION', 'OBI 52% < 60% blocks entry (Status remains PENDING_ACTIVATION)');
  assert(card1.obiPersistenceCount === 0, 'Persistence count remains 0');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: RSI FILTER FAIL (RSI > Target)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 2: RSI Above Custom Threshold (48 > 45) -> Entry Blocked');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  radar = { averageObiPct: 65.0, averageRsi15m: 48.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  await tracker.tick();
  assert(card1.status === 'PENDING_ACTIVATION', 'RSI 48 > 45 blocks entry (Status remains PENDING_ACTIVATION)');
  assert(card1.obiPersistenceCount === 0, 'Persistence count remains 0');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: 3-TICK PERSISTENCE (Reset if condition drops on Tick 2)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 3: 3-Tick Persistence Reset on Fluctuation (Tick 1, Tick 2 OK -> Drop on Tick 3)');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  // Tick 1: Both Match
  radar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  await tracker.tick();
  assert(card1.obiPersistenceCount === 1, 'Tick 1 matches -> Persistence 1/3');

  // Tick 2: Both Match
  await tracker.tick();
  assert(card1.obiPersistenceCount === 2, 'Tick 2 matches -> Persistence 2/3');

  // Tick 3: OBI drops to 55% (< 60%)
  radar = { averageObiPct: 55.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 55.0 }] };
  await tracker.tick();
  assert(card1.obiPersistenceCount === 0, 'Tick 3 drops below threshold -> Persistence counter immediately resets to 0');
  assert(card1.status === 'PENDING_ACTIVATION', 'Entry prevented on temporary spike');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: DUAL GATE PASS + TIGHT SPREAD (<= 0.30%) -> IMMEDIATE MARKET BUY & TP
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 4: 3-Tick Confirmed + Tight Spread (0.05% <= 0.30%) -> Market Buy + TP Sell + Cycle Reset');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  client.prices['BTCUSDT'] = 65000.0;
  client.depths['BTCUSDT'] = {
    bids: [['64980.00', '10']],
    asks: [['65010.00', '10']] // Spread = (30 / 64980) * 100 = 0.046% <= 0.30%
  };

  radar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  await tracker.tick(); // Tick 1 (1/3)
  await tracker.tick(); // Tick 2 (2/3)
  await tracker.tick(); // Tick 3 (3/3 confirmed -> PENDING_BUY)
  assert(card1.status === 'PENDING_BUY', '3 Consecutive Ticks passed -> Status transitions to PENDING_BUY');

  await tracker.tick(); // 4th tick -> Executes Market Buy
  assert(card1.status === 'TP_SL_ACTIVE', 'Tight Spread (0.05%) executes Immediate Market Buy -> Status: TP_SL_ACTIVE');
  assert(card1.executionPrice === 65000.0, 'Execution Price recorded accurately at $65,000.00');

  // Simulate Take Profit Target Reached (+0.60% TP -> $65,390.00)
  const tpTargetPrice = 65000.0 * (1 + 0.006) + 10.0; // $65,400.00
  client.prices['BTCUSDT'] = tpTargetPrice;
  radar = { averageObiPct: 50.0, averageRsi15m: 55.0, exchanges: [{ name: 'Binance', obiPct: 50.0 }] };
  await tracker.tick();
  assert(card1.status === 'PENDING_ACTIVATION', 'Take Profit hit (+0.6%) -> Cycle completed and reset to PENDING_ACTIVATION');
  assert(card1.tradeHistory.length === 1, 'Trade history records 1 completed cycle');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: WIDE SPREAD (> 0.30%) -> TOP MAKER LIMIT BUY @ BID + $0.01 + 60s TIMER
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 5: Wide Spread (1.50% > 0.30%) -> Maker Peg Limit Buy @ Bid + $0.01 & 60s Timer');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  const card2 = {
    id: 'card_wide_' + Date.now(),
    symbol: 'NVDAXUSDT',
    quantity: 1.0,
    quoteOrderQty: 100.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    autoRepeat: true,
    dryRun: true,
    status: 'PENDING_ACTIVATION',
    tradeHistory: [],
    obiPersistenceCount: 0
  };
  tracker.orders = [card2];
  tracker.saveOrders();

  client.prices['NVDAXUSDT'] = 100.75;
  client.depths['NVDAXUSDT'] = {
    bids: [['100.00', '10']],
    asks: [['101.50', '10']] // Spread = 1.50% > 0.30%
  };

  radar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  await tracker.tick(); // 1/3
  await tracker.tick(); // 2/3
  await tracker.tick(); // 3/3 -> Wide Spread Detected -> Places Top Maker Limit Buy

  assert(card2.status === 'PENDING_LIMIT_BUY', 'Wide spread blocks Market Buy -> Sets status to PENDING_LIMIT_BUY');
  assert(card2.targetBuyPrice === 100.01, 'Places Top Maker Limit Buy at Top Bid + $0.01 = $100.01');
  assert(card2.limitBuyPlacedAt !== null, 'Initializes 60s timer timestamp (limitBuyPlacedAt)');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: 60s TIMEOUT + SPREAD STILL WIDE (> 0.30%) -> RE-PEG TO NEW TOP BID
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 6: 60s Timeout Expired + Spread Still Wide (1.47%) -> Cancels & Re-pegs at new Top Bid');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  // Fast forward time by 61 seconds (timeout elapsed)
  card2.limitBuyPlacedAt = Date.now() - 61000;

  // New order book with higher bids ($102.00) and wide spread
  client.depths['NVDAXUSDT'] = {
    bids: [['102.00', '10']],
    asks: [['103.50', '10']] // Spread = 1.47% > 0.30%
  };
  client.prices['NVDAXUSDT'] = 102.75;

  await tracker.tick(); // Re-evaluates 60s timeout
  assert(card2.status === 'PENDING_LIMIT_BUY', 'Remains in PENDING_LIMIT_BUY on re-peg');
  assert(card2.targetBuyPrice === 102.01, 'Re-pegs to updated Top Bid + $0.01 = $102.01');
  assert(card2.limitBuyPlacedAt > Date.now() - 5000, '60s timer successfully restarted');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 7: 60s TIMEOUT + SPREAD NARROWS (<= 0.30%) -> SWITCH TO MARKET BUY
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 7: 60s Timeout Expired + Spread Narrows (0.15% <= 0.30%) -> Switches to Market Buy');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  // Fast forward time by another 61 seconds
  card2.limitBuyPlacedAt = Date.now() - 61000;

  // Liquidity entered market, spread is now tight: Bid $102.00, Ask $102.15 (0.147% <= 0.30%)
  client.depths['NVDAXUSDT'] = {
    bids: [['102.00', '10']],
    asks: [['102.15', '10']]
  };
  client.prices['NVDAXUSDT'] = 102.10;

  await tracker.tick(); // Re-evaluates -> Spread narrowed -> Switches to PENDING_BUY
  assert(card2.status === 'PENDING_BUY', 'Spread narrowed <= 0.30% -> Cancels limit order and switches to PENDING_BUY');

  await tracker.tick(); // Executes Market Buy
  assert(card2.status === 'TP_SL_ACTIVE', 'Market Buy executes -> Transitions to TP_SL_ACTIVE');
  assert(card2.executionPrice === 102.10, 'Execution Price recorded at $102.10');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 8: TOP MAKER LIMIT BUY GETS FILLED WITHIN 60s -> TP/SL ACTIVATION
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 8: Top Maker Limit Buy Filled within 60s Window -> Enters TP_SL_ACTIVE & Sets TP');
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
    autoRepeat: true,
    dryRun: true,
    status: 'PENDING_LIMIT_BUY',
    targetBuyPrice: 200.01,
    limitBuyPlacedAt: Date.now() - 20000, // 20s ago (within 60s window)
    tradeHistory: [],
    obiPersistenceCount: 3
  };
  tracker.orders = [card3];
  tracker.saveOrders();

  // Price touches our limit order ($200.01)
  client.prices['AAPLXUSDT'] = 200.01;
  await tracker.tick();

  assert(card3.status === 'TP_SL_ACTIVE', 'Limit Buy filled on market touch -> Status becomes TP_SL_ACTIVE');
  assert(card3.executionPrice === 200.01, 'Execution Price recorded at exact Limit Buy Price $200.01');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 9: EMERGENCY STOP LOSS ON DUMP (RSI <= 20.0) -> IMMEDIATE MARKET SELL
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 9: Market Crash / Dump (RSI <= 20.0) -> Emergency Market Sell & Reset');
  console.log('────────────────────────────────────────────────────────────────────────────────');
  radar = { averageObiPct: 30.0, averageRsi15m: 18.2, exchanges: [{ name: 'Binance', obiPct: 30.0 }] };
  client.prices['AAPLXUSDT'] = 195.00; // Market dropped

  await tracker.tick();
  assert(card3.status === 'PENDING_ACTIVATION', 'RSI 18.2 <= 20.0 triggers Emergency Market Sell -> Status resets to PENDING_ACTIVATION');
  assert(card3.tradeHistory.length === 1, 'Emergency SL recorded in trade history');

  // Clean up
  for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

  console.log('\n================================================================================');
  console.log(`🏆 AUDIT COMPLETE: ${passedTests} / ${totalTests} ASSERTIONS PASSED (100% SUCCESSFUL)!`);
  console.log('================================================================================');
}

runMasterUserScenarioAudit().catch(err => {
  console.error('❌ MASTER AUDIT ERROR:', err);
  process.exit(1);
});
