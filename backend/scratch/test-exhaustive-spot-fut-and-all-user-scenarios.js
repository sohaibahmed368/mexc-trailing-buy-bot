/**
 * EXHAUSTIVE SPOT + FUTURES OBI & FULL LIFECYCLE SCENARIOS DRY RUN
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests EVERY requested user scenario with exact numerical values:
 *
 * SCENARIO 1: Spot + Futures Volume Aggregation & Threshold Filter Failures (OBI < 60% or RSI > 45) -> Blocked
 * SCENARIO 2: Spot + Futures OBI >= 60% & RSI <= 45 Confirmed for 3 Continuous Ticks -> Dual Gate Entry
 * SCENARIO 3: Tight Spread (<= 0.30%) -> Immediate Market Buy, Real TP Limit Sell Placed, TP Hit & Cycle Reset
 * SCENARIO 4: Low-Liquidity Asset with Wide Spread (> 0.30%) -> Blocks Market Buy, Places Top Maker Limit Buy @ Bid + $0.01, 60s Timer Loop, Auto Re-Peg, Switch to Market Buy
 * SCENARIO 5: Top Maker Limit Buy Filled within 60s -> TP_SL_ACTIVE & Take Profit
 * SCENARIO 6: Emergency Stop Loss on Market Dump (RSI <= 20.0) -> Immediate Emergency Market Sell & Safe Reset
 */

const fs = require('fs');
const path = require('path');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');
const MexcTracker = require('../tracker');

class MockMexcClient {
  constructor() {
    this.prices = { BTCUSDT: 65000, NVDAXUSDT: 100.0, AAPLXUSDT: 200.0 };
    this.depths = {};
    this.ordersPlaced = [];
    this.openOrders = [];
    this.nextId = 10001;
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
    return this.depths[sym] || { bids: [['64990.00', '10']], asks: [['65010.00', '10']] };
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

async function runExhaustiveAllScenarioAudit() {
  console.log('================================================================================');
  console.log('🧪 EXHAUSTIVE SPOT + FUTURES OBI & COMPLETE USER TRADING SCENARIOS AUDIT');
  console.log('================================================================================\n');

  const tmpOrders = path.join(__dirname, 'tmp-exhaustive-orders.json');
  const tmpLogs = path.join(__dirname, 'tmp-exhaustive-logs.json');
  for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

  const client = new MockMexcClient();
  const tracker = new MexcTracker(client);
  tracker.ordersPath = tmpOrders;
  tracker.logsPath = tmpLogs;

  const radarEngine = new MultiExchangeSignalRadar();

  let passedAssertions = 0;
  let totalAssertions = 0;

  function assert(condition, message) {
    totalAssertions++;
    if (condition) {
      passedAssertions++;
      console.log(`   ✅ PASS: ${message}`);
    } else {
      console.error(`   ❌ FAIL: ${message}`);
      throw new Error(`Assertion Failed: ${message}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: SPOT + FUTURES VOLUME CALCULATION & THRESHOLD BLOCKING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 1: Spot (100-Depth) + Futures (100-Depth) OBI Calculation & Filter Failures');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  // Generate 100 Spot depth & 100 Futures depth where Sellers dominate (OBI = 45.45% < 60%)
  const spotBidsSellers = Array.from({ length: 100 }, (_, i) => [(65000 - i * 5).toString(), '0.31']); // ~$2M Buy
  const spotAsksSellers = Array.from({ length: 100 }, (_, i) => [(65000 + i * 5).toString(), '0.31']); // ~$2M Sell
  const futBidsSellers  = Array.from({ length: 100 }, (_, i) => [(65000 - i * 5).toString(), '0.46']); // ~$3M Buy
  const futAsksSellers  = Array.from({ length: 100 }, (_, i) => [(65000 + i * 5).toString(), '0.62']); // ~$4M Sell

  const sVol1 = radarEngine.calculateDepthVolume(spotBidsSellers, spotAsksSellers);
  const fVol1 = radarEngine.calculateDepthVolume(futBidsSellers, futAsksSellers);
  const totalB1 = sVol1.buyVol + fVol1.buyVol;
  const totalS1 = sVol1.sellVol + fVol1.sellVol;
  const obiVal1 = (totalB1 / (totalB1 + totalS1)) * 100;

  console.log(`   Spot Buy Vol: $${sVol1.buyVol.toFixed(0)} | Spot Sell Vol: $${sVol1.sellVol.toFixed(0)}`);
  console.log(`   Fut Buy Vol:  $${fVol1.buyVol.toFixed(0)} | Fut Sell Vol:  $${fVol1.sellVol.toFixed(0)}`);
  console.log(`   Combined Spot + Fut OBI: ${obiVal1.toFixed(2)}% (Target: >= 60.0%)`);

  const card1 = {
    id: 'card_btc_' + Date.now(),
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

  let currentRadar = {
    averageObiPct: obiVal1,
    averageRsi15m: 38.0,
    exchanges: [{ name: 'Binance', obiPct: obiVal1 }, { name: 'Bybit', obiPct: obiVal1 }]
  };
  tracker.signalRadar = {
    getRadarMetrics: () => currentRadar,
    getMultiExchangeMetrics: async () => currentRadar
  };

  await tracker.tick();
  assert(card1.status === 'PENDING_ACTIVATION', 'Combined OBI 45.45% < 60% blocks entry (Status remains PENDING_ACTIVATION)');
  assert(card1.obiPersistenceCount === 0, 'Persistence count remains 0 when OBI threshold not met');

  // Case 1b: OBI >= 60% (65%), but RSI > 45 (48.5) -> Blocked
  currentRadar = {
    averageObiPct: 65.0,
    averageRsi15m: 48.5,
    exchanges: [{ name: 'Binance', obiPct: 65.0 }]
  };
  await tracker.tick();
  assert(card1.status === 'PENDING_ACTIVATION', 'RSI 48.5 > 45 blocks entry even if OBI is 65%');
  assert(card1.obiPersistenceCount === 0, 'Persistence count remains 0 when RSI threshold not met');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: 3-TICK PERSISTENCE CONFIRMATION (OBI >= 60% & RSI <= 45)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 2: 3-Tick Continuous Stability Check (Sustained 3 Seconds -> PENDING_BUY)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  currentRadar = {
    averageObiPct: 66.5, // Combined Spot + Futures OBI >= 60%
    averageRsi15m: 38.2, // 4h 15m RSI <= 45
    exchanges: [
      { name: 'Binance', obiPct: 66.5 }, { name: 'Bybit', obiPct: 67.0 },
      { name: 'MEXC', obiPct: 65.8 }, { name: 'Gate.io', obiPct: 66.2 },
      { name: 'Bitget', obiPct: 66.9 }, { name: 'OKX', obiPct: 66.1 }
    ]
  };

  await tracker.tick(); // Tick 1 (1/3)
  assert(card1.obiPersistenceCount === 1, 'Tick 1: Combined OBI 66.5% & RSI 38.2 sustained -> Persistence 1/3');
  assert(card1.status === 'PENDING_ACTIVATION', 'Status remains PENDING_ACTIVATION at 1/3 ticks');

  await tracker.tick(); // Tick 2 (2/3)
  assert(card1.obiPersistenceCount === 2, 'Tick 2: Sustained 2/3 ticks');
  assert(card1.status === 'PENDING_ACTIVATION', 'Status remains PENDING_ACTIVATION at 2/3 ticks');

  await tracker.tick(); // Tick 3 (3/3 confirmed -> PENDING_BUY)
  assert(card1.status === 'PENDING_BUY', 'Tick 3: 3/3 Ticks fully sustained -> Dual Gate Passed! Status: PENDING_BUY');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: TIGHT SPREAD (<= 0.30%) -> MARKET BUY + REAL TP LIMIT SELL + CYCLE RESET
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 3: Tight Spread (0.03% <= 0.30%) -> Market Buy + TP Limit Sell @ +0.60% + Reset');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  client.depths['BTCUSDT'] = {
    bids: [['64990.00', '10']],
    asks: [['65010.00', '10']] // Spread = 0.03% <= 0.30%
  };
  client.prices['BTCUSDT'] = 65000.0;

  await tracker.tick(); // Executes Market Buy -> Transitions to TP_SL_ACTIVE
  assert(card1.status === 'TP_SL_ACTIVE', 'Tight Spread (0.03%) executed Market Buy -> Status: TP_SL_ACTIVE');
  assert(card1.executionPrice === 65000.0, 'Execution Price recorded accurately @ $65,000.00');

  // Simulate Take Profit Target Reached (+0.60% TP -> $65,390.00)
  const tpTarget = 65000.0 * 1.006 + 5.0; // $65,395.00
  client.prices['BTCUSDT'] = tpTarget;
  currentRadar = { averageObiPct: 50.0, averageRsi15m: 55.0, exchanges: [] };

  await tracker.tick(); // TP Hit -> Finalizes trade cycle and resets
  assert(card1.status === 'PENDING_ACTIVATION', 'Take Profit hit (+0.60%) -> Cycle #1 completed and reset to PENDING_ACTIVATION');
  assert(card1.tradeHistory.length === 1, 'Trade history records 1 completed profitable cycle');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: LOW LIQUIDITY / WIDE SPREAD (> 0.30%) & 60s RE-PEGGING LOOP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 4: Low-Liquidity Asset (NVDAX) with Wide Spread (1.50% > 0.30%) & 60s Timer Loop');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  const card2 = {
    id: 'card_nvdax_' + Date.now(),
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

  currentRadar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };

  await tracker.tick(); // 1/3
  await tracker.tick(); // 2/3
  await tracker.tick(); // 3/3 -> Wide Spread Detected -> Places Top Maker Limit Buy

  assert(card2.status === 'PENDING_LIMIT_BUY', 'Wide spread (1.50%) blocks Market Buy -> Sets status to PENDING_LIMIT_BUY');
  assert(card2.targetBuyPrice === 100.01, 'Places Top Maker Limit Buy at Top Bid + $0.01 ($100.01)');
  assert(card2.limitBuyPlacedAt !== null, 'Initializes 60s timer (limitBuyPlacedAt timestamp saved)');

  // Step 4a: 60s Timeout Expired & Spread Still Wide (1.47%) -> Auto Re-peg
  card2.limitBuyPlacedAt = Date.now() - 61000; // 61 seconds elapsed
  client.depths['NVDAXUSDT'] = {
    bids: [['102.00', '10']],
    asks: [['103.50', '10']] // Still Wide: 1.47% > 0.30%
  };
  client.prices['NVDAXUSDT'] = 102.75;

  await tracker.tick(); // Re-evaluates
  assert(card2.status === 'PENDING_LIMIT_BUY', 'Status remains PENDING_LIMIT_BUY after 60s timeout re-peg');
  assert(card2.targetBuyPrice === 102.01, 'Re-pegs to updated Top Bid + $0.01 ($102.01)');
  assert(card2.limitBuyPlacedAt > Date.now() - 5000, '60-second timer successfully restarted for next cycle');

  // Step 4b: 60s Timeout Expired & Spread Narrows (0.15% <= 0.30%) -> Switch to Market Buy
  card2.limitBuyPlacedAt = Date.now() - 61000;
  client.depths['NVDAXUSDT'] = {
    bids: [['102.00', '10']],
    asks: [['102.15', '10']] // Narrow Spread: 0.147% <= 0.30%
  };
  client.prices['NVDAXUSDT'] = 102.10;

  await tracker.tick(); // Cancels limit order and switches to PENDING_BUY
  assert(card2.status === 'PENDING_BUY', 'Spread narrowed <= 0.30% -> Cancels limit order and switches to PENDING_BUY');

  await tracker.tick(); // Executes Market Buy
  assert(card2.status === 'TP_SL_ACTIVE', 'Market Buy executed -> Transitions to TP_SL_ACTIVE');
  assert(card2.executionPrice === 102.10, 'Execution Price recorded at $102.10');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: TOP MAKER LIMIT BUY FILLED WITHIN 60s WINDOW
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 5: Top Maker Limit Buy Filled within 60s Window -> Transitions to TP_SL_ACTIVE');
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
    limitBuyPlacedAt: Date.now() - 18000, // Placed 18s ago (well within 60s)
    tradeHistory: [],
    obiPersistenceCount: 3
  };
  tracker.orders = [card3];
  tracker.saveOrders();

  // Price touches our limit buy price ($200.01)
  client.prices['AAPLXUSDT'] = 200.01;
  await tracker.tick();

  assert(card3.status === 'TP_SL_ACTIVE', 'Limit Buy fill detected on market touch -> Status becomes TP_SL_ACTIVE');
  assert(card3.executionPrice === 200.01, 'Execution Price recorded accurately at exact limit price $200.01');

  // ─────────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: EMERGENCY STOP LOSS ON MARKET DUMP (RSI <= 20.0)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('▶️ SCENARIO 6: Market Crash / Dump (RSI <= 20.0) -> Immediate Emergency Market Sell & Reset');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  currentRadar = { averageObiPct: 25.0, averageRsi15m: 17.5, exchanges: [] };
  client.prices['AAPLXUSDT'] = 194.00; // Market dropped

  await tracker.tick();
  assert(card3.status === 'PENDING_ACTIVATION', '4h 15m RSI = 17.5 (<= 20.0) triggers Immediate Market Sell & resets card to PENDING_ACTIVATION');
  assert(card3.tradeHistory.length === 1, 'Emergency Stop Loss trade recorded in card history');

  // Clean up
  for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

  console.log('\n================================================================================');
  console.log(`🏆 AUDIT COMPLETE: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED (100% SUCCESSFUL)!`);
  console.log('================================================================================');
  process.exit(0);
}

runExhaustiveAllScenarioAudit().catch(err => {
  console.error('❌ EXHAUSTIVE AUDIT ERROR:', err);
  process.exit(1);
});
