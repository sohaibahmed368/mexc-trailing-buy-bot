const path = require('path');
const fs = require('fs');
const Tracker = require('../tracker');

// Mock MEXC Client
class MockMexcClient {
  constructor() {
    this.prices = {};
    this.depths = {};
    this.orders = {};
    this.openOrders = [];
    this.nextOrderId = 1000;
  }

  hasCredentials() { return true; }

  async getPrices() {
    return this.prices;
  }

  async getTickerPrice(symbol) {
    const p = this.prices[symbol] || 100;
    return parseFloat(p);
  }

  async getAllTickerPrices() {
    return Object.keys(this.prices).map(sym => ({ symbol: sym, price: String(this.prices[sym]) }));
  }

  async getDepth(symbol, limit = 10) {
    if (this.depths[symbol]) return this.depths[symbol];
    const p = this.prices[symbol] || 100;
    return {
      bids: [[(p * 0.999).toFixed(4), '10']],
      asks: [[(p * 1.001).toFixed(4), '10']]
    };
  }

  async placeOrder(params) {
    const id = `mock_ord_${this.nextOrderId++}`;
    const orderObj = { orderId: id, status: 'NEW', ...params };
    this.orders[id] = orderObj;
    if (params.type === 'LIMIT') {
      this.openOrders.push(orderObj);
    }
    return { orderId: id, status: 'NEW' };
  }

  async getOrder(symbol, orderId) {
    return this.orders[orderId] || { orderId, status: 'NEW' };
  }

  async getOpenOrders(symbol) {
    return this.openOrders;
  }

  async cancelOrder(symbol, orderId) {
    this.openOrders = this.openOrders.filter(o => o.orderId !== orderId);
    if (this.orders[orderId]) this.orders[orderId].status = 'CANCELED';
    return { symbol, orderId, status: 'CANCELED' };
  }

  async getBalances() {
    return [{ asset: 'USDT', free: '1000', locked: '0' }, { asset: 'SOL', free: '0', locked: '0' }];
  }
}

async function runComprehensiveUserScenarioTest() {
  console.log('================================================================================');
  console.log('🧪 COMPREHENSIVE USER EXACT SCENARIO TEST FOR NEWLY CREATED CARDS');
  console.log('================================================================================\n');

  const scratchDir = path.join(__dirname);
  const ordersPath = path.join(scratchDir, 'tmp-user-scenario-orders.json');
  const logsPath = path.join(scratchDir, 'tmp-user-scenario-logs.json');
  const auditPath = path.join(scratchDir, 'tmp-user-scenario-audit.log');

  if (fs.existsSync(ordersPath)) fs.unlinkSync(ordersPath);
  if (fs.existsSync(logsPath)) fs.unlinkSync(logsPath);
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);

  fs.writeFileSync(ordersPath, JSON.stringify([]));
  fs.writeFileSync(logsPath, JSON.stringify([]));

  const client = new MockMexcClient();
  const tracker = new Tracker(client);
  
  tracker.ordersPath = ordersPath;
  tracker.logsPath = logsPath;
  tracker.auditLogPath = auditPath;
  tracker.orders = [];

  let currentRadar = { averageObiPct: 50.0, averageRsi15m: 55.0, exchanges: [{ name: 'Binance', obiPct: 50.0 }] };
  tracker.signalRadar = {
    getSymbolRadar: () => currentRadar
  };

  const sym = 'SOLUSDT';
  client.prices[sym] = 150.0;

  // Create a NEW Card (e.g. SOLUSDT with OBI >= 60%, RSI <= 45, TP 1.5%)
  console.log('📌 1. CREATING NEW CARD: SOLUSDT (Custom OBI ≥ 60%, Custom RSI ≤ 45, TP 1.5%)');
  const newCard = {
    id: 'card_sol_' + Date.now(),
    symbol: sym,
    quantity: 1.0,
    quoteOrderQty: 150.0,
    enableObiCheck: true,
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    takeProfit: 1.5,
    maxSpreadPct: 0.30,
    dryRun: false,
    status: 'PENDING_ACTIVATION',
    tradeHistory: [],
    obiPersistenceCount: 0
  };
  tracker.orders.push(newCard);
  tracker.saveOrders();

  // ---------------------------------------------------------------------------
  // SCENARIO 1: OBI & RSI Filters (Blocking until criteria met)
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 1: OBI & RSI Filter Verification ---');
  // 1a: OBI < 60%
  currentRadar = { averageObiPct: 55.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 55.0 }] };
  await tracker.tick();
  let card = tracker.getOrders()[0];
  console.log(`   Step 1a (OBI 55% < 60%): Status = ${card.status} (Expected: PENDING_ACTIVATION)`);
  if (card.status !== 'PENDING_ACTIVATION') throw new Error('Failed 1a');

  // 1b: RSI > 45
  currentRadar = { averageObiPct: 65.0, averageRsi15m: 48.0, exchanges: [{ name: 'Binance', obiPct: 48.0 }] };
  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   Step 1b (RSI 48 > 45): Status = ${card.status} (Expected: PENDING_ACTIVATION)`);
  if (card.status !== 'PENDING_ACTIVATION') throw new Error('Failed 1b');

  // ---------------------------------------------------------------------------
  // SCENARIO 2: 3-Tick Persistence Confirmation & Tight Spread (<= 0.3%) -> Market Buy
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 2: 3-Tick Persistence & Tight Spread (<= 0.3%) Market Buy ---');
  currentRadar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  // Depth with tight spread (0.13%)
  client.depths[sym] = {
    bids: [['150.00', '10']],
    asks: [['150.20', '10']]
  };

  await tracker.tick(); // Tick 1
  await tracker.tick(); // Tick 2
  await tracker.tick(); // Tick 3 -> PENDING_BUY
  card = tracker.getOrders()[0];
  console.log(`   3 Ticks Passed -> Status = ${card.status} (Expected: PENDING_BUY)`);

  await tracker.tick(); // Executes Market Buy -> TP_SL_ACTIVE
  card = tracker.getOrders()[0];
  console.log(`   Market Buy Executed -> Status = ${card.status} | Exec Price = $${card.executionPrice} | Sell Order ID = ${card.mexcSellOrderId}`);
  if (card.status !== 'TP_SL_ACTIVE' || !card.mexcSellOrderId) throw new Error('Failed Scenario 2 Market Buy');

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Take Profit Hit -> Sell & Reset
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 3: Take Profit Target Hit (+1.5%) ---');
  currentRadar = { averageObiPct: 50.0, averageRsi15m: 50.0, exchanges: [{ name: 'Binance', obiPct: 50.0 }] };
  const tpTarget = 150.0 * 1.015 + 0.5; // $152.75 (> 1.5% TP)
  client.prices[sym] = tpTarget;
  client.openOrders = []; // Simulate limit sell filled on MEXC

  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   Price reached $${tpTarget} -> Status = ${card.status} | Completed Cycles = ${card.tradeHistory.length}`);
  if (card.status !== 'PENDING_ACTIVATION' || card.tradeHistory.length !== 1) throw new Error('Failed Scenario 3 TP');

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Wide Spread (> 0.3%) -> Maker Peg Limit Buy & 60s Timeout Loop
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 4: Wide Spread (> 0.3%) Maker Peg Limit Buy & 60s Timeout Loop ---');
  // Set wide spread depth (0.67% spread: bid 150.00, ask 151.00)
  client.depths[sym] = {
    bids: [['150.00', '10']],
    asks: [['151.00', '10']]
  };
  client.prices[sym] = 150.0;
  currentRadar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };

  await tracker.tick(); // Tick 1
  await tracker.tick(); // Tick 2
  await tracker.tick(); // Tick 3 -> Wide Spread router places Top Maker Peg Limit Buy (150.00 + 0.01 = 150.01)

  card = tracker.getOrders()[0];
  console.log(`   Wide Spread Detected (0.67% > 0.30%) -> Status = ${card.status} | Target Buy Price = $${card.targetBuyPrice} (Top Bid + $0.01)`);
  if (card.status !== 'PENDING_LIMIT_BUY' || card.targetBuyPrice !== 150.01) throw new Error('Failed Scenario 4 Limit Buy Placement');

  // 4a: Simulate 60-Second Timeout with Spread Still Wide -> Re-Peg Limit Buy
  console.log('\n--- SCENARIO 4a: 60s Timeout Expired & Spread Still Wide -> Auto Re-Peg ---');
  card.limitBuyPlacedAt = Date.now() - 65000; // Force > 60s elapsed
  // New top bid is now 150.50
  client.depths[sym] = {
    bids: [['150.50', '10']],
    asks: [['151.60', '10']]
  };
  client.prices[sym] = 150.50;

  await tracker.tick(); // Triggers 60s timeout handling & re-peg
  card = tracker.getOrders()[0];
  console.log(`   60s Expired (Spread 0.73% > 0.30%) -> Re-Pegged Limit Buy at $${card.targetBuyPrice} (New Top Bid 150.50 + $0.01) | Status = ${card.status}`);
  if (card.status !== 'PENDING_LIMIT_BUY' || card.targetBuyPrice !== 150.51) throw new Error('Failed Scenario 4a Re-Peg');

  // 4b: Simulate 60-Second Timeout with Spread Now Narrowed (<= 0.3%) -> Switch to Market Buy!
  console.log('\n--- SCENARIO 4b: 60s Timeout Expired & Spread Narrowed (<= 0.3%) -> Switch to Market Buy ---');
  card.limitBuyPlacedAt = Date.now() - 65000; // Force > 60s elapsed
  // Spread narrowed to 0.13%
  client.depths[sym] = {
    bids: [['150.50', '10']],
    asks: [['150.70', '10']]
  };

  await tracker.tick(); // Re-evaluates spread: narrow! -> Switches to PENDING_BUY
  card = tracker.getOrders()[0];
  console.log(`   60s Expired (Spread 0.13% <= 0.30%) -> Switched to PENDING_BUY | Status = ${card.status}`);
  if (card.status !== 'PENDING_BUY') throw new Error('Failed Scenario 4b Narrowed Spread Switch');

  await tracker.tick(); // Executes Market Buy -> TP_SL_ACTIVE
  card = tracker.getOrders()[0];
  console.log(`   Market Buy Executed -> Status = ${card.status} | Exec Price = $${card.executionPrice}`);
  if (card.status !== 'TP_SL_ACTIVE') throw new Error('Failed Scenario 4b Market Buy Execution');

  // ---------------------------------------------------------------------------
  // SCENARIO 5: RSI < 20 Emergency Crash Stop Loss Trigger
  // ---------------------------------------------------------------------------
  console.log('\n--- SCENARIO 5: RSI < 20 Emergency Stop Loss Trigger ---');
  // Crash RSI to 18.0 (<= 20.0)
  currentRadar = { averageObiPct: 30.0, averageRsi15m: 18.0, exchanges: [{ name: 'Binance', obiPct: 30.0 }] };
  client.prices[sym] = 145.0; // Dropped price

  await tracker.tick(); // Triggers RSI Emergency Crash SL
  card = tracker.getOrders()[0];
  console.log(`   RSI 18.0 (<= 20.0) -> Emergency Market Sell Executed | Status = ${card.status} | Total Completed Cycles = ${card.tradeHistory.length}`);
  if (card.status !== 'PENDING_ACTIVATION' || card.tradeHistory.length !== 2) throw new Error('Failed Scenario 5 Emergency SL');

  // Step 2d: Next tick processes PENDING_BUY in dry run mode
  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   Processed Buy -> Status = ${card.status}, Execution Price = $${card.executionPrice}`);
  if (card.status !== 'TP_SL_ACTIVE' || card.executionPrice !== 100) {
    throw new Error(`Failed Scenario 2 Market Buy assertion. Status: ${card.status}, ExecutionPrice: ${card.executionPrice}`);
  }
  console.log(`   ✅ Market Buy executed! Card is now ACTIVE holding asset at $100.00.\n`);

  // ==========================================
  // SCENARIO 3: Take Profit Execution (0.6% Profit)
  // Execution Price = $100.00. TP (0.6%) Target = $100.60
  // ==========================================
  console.log('🔹 SCENARIO 3: Take Profit Market Monitoring & Sell Execution');
  console.log('   Setting market price to $100.30 (Below TP target of $100.60)...');
  mockMexcClient.tickerPrice = 100.30;
  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   Price $100.30 -> Status = ${card.status} (Expected: TP_SL_ACTIVE)`);
  if (card.status !== 'TP_SL_ACTIVE') throw new Error('Card exited early before reaching TP target');

  console.log('   Setting market price to $100.65 (Above TP target of $100.60)...');
  mockMexcClient.tickerPrice = 100.65;
  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   Price $100.65 -> Status = ${card.status} (Expected: PENDING_ACTIVATION - Reset for next cycle)`);
  console.log(`   Trade History Count = ${card.tradeHistory ? card.tradeHistory.length : 0}`);
  if (card.status !== 'PENDING_ACTIVATION' || !card.tradeHistory || card.tradeHistory.length !== 1) {
    throw new Error(`Take profit execution failed. Status: ${card.status}, Trades: ${card.tradeHistory ? card.tradeHistory.length : 0}`);
  }
  console.log(`   ✅ Take Profit executed at $100.65! Profit locked, cycle completed & card reset to PENDING_ACTIVATION.\n`);

  // ==========================================
  // SCENARIO 4: RSI < 20 Emergency Stop Loss Trigger
  // Trigger entry again, then simulate RSI dropping to 18.0
  // ==========================================
  console.log('🔹 SCENARIO 4: Emergency RSI < 20 Stop Loss Trigger');
  mockMexcClient.tickerPrice = 100.0;
  currentRadar = { averageObiPct: 65.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };
  
  // 3 ticks to trigger dual gate again
  await tracker.tick();
  await tracker.tick();
  await tracker.tick(); // Dual gate triggers PENDING_BUY
  await tracker.tick(); // Market buy executes -> TP_SL_ACTIVE
  card = tracker.getOrders()[0];
  console.log(`   Re-entered Trade -> Status = ${card.status}, Execution Price = $${card.executionPrice}`);
  if (card.status !== 'TP_SL_ACTIVE') throw new Error('Re-entry failed for Scenario 4');

  console.log('   Simulating Market Dump with RSI dropping to 18.0 (Below 20 threshold)...');
  currentRadar = { averageObiPct: 50.0, averageRsi15m: 18.0, exchanges: [{ name: 'Binance', obiPct: 50.0 }] };
  await tracker.tick();
  card = tracker.getOrders()[0];
  console.log(`   RSI 18.0 -> Status = ${card.status} (Expected: PENDING_ACTIVATION - Emergency Sold)`);
  console.log(`   Trade History Count = ${card.tradeHistory ? card.tradeHistory.length : 0}`);
  if (card.status !== 'PENDING_ACTIVATION' || card.tradeHistory.length !== 2) {
    throw new Error(`RSI < 20 Emergency Stop Loss failed. Status: ${card.status}`);
  }
  console.log(`   ✅ Emergency RSI < 20 Sell executed at 18.0 RSI! Card safety reset back to PENDING_ACTIVATION.\n`);

  console.log('===============================================================');
  console.log('🎉 ALL USER SCENARIOS VERIFIED 100% SUCCESSFUL IN DRY RUN!');
  console.log('===============================================================');
}

runComprehensiveUserScenarioTest().catch(err => {
  console.error('❌ SCENARIO TEST ERROR:', err);
  process.exit(1);
});
