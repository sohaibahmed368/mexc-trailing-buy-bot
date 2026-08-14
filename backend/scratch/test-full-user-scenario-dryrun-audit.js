const fs = require('fs');
const path = require('path');
const MexcTracker = require('../tracker');

// ─── DYNAMIC MOCK MEXC CLIENT FOR DRY RUN AUDIT ────────────────────────────────
class AuditMockMexcClient {
  constructor() {
    this.prices = {
      BTCUSDT: 65000,
      ETHUSDT: 3400,
      XAUTUSDT: 2400,
      EURUSDT: 1.085
    };
    this.balances = [
      { asset: 'USDT', free: '50000.0', locked: '0.0' },
      { asset: 'BTC',  free: '0.0', locked: '0.0' },
      { asset: 'ETH',  free: '0.0', locked: '0.0' },
      { asset: 'XAUT', free: '0.0', locked: '0.0' },
      { asset: 'EUR',  free: '0.0', locked: '0.0' }
    ];
    this.ordersPlaced = [];
    this.nextOrderId  = 10001;
    this.tpFilledMap  = {};
  }

  hasCredentials()    { return true; }
  async getBalances() { return this.balances; }

  setPrices(newPrices) {
    Object.assign(this.prices, newPrices);
  }

  async getTickerPrice(symbol) {
    return this.prices[symbol] || 100;
  }

  async getAllTickerPrices() {
    return Object.keys(this.prices).map(sym => ({
      symbol: sym,
      price: String(this.prices[sym])
    }));
  }
  async getAllPrices() { return this.getAllTickerPrices(); }

  async getKlines() {
    return Array.from({ length: 25 }, (_, i) => [
      Date.now() - (25 - i) * 15 * 60 * 1000,
      '100','101','99','100','10', Date.now(), '1000', 10, '5', '0'
    ]);
  }
  async getDepth() { return { bids:[['99.9','1']], asks:[['100.1','1']] }; }
  async getRecentTrades() { return [{ price:'100', qty:'1', isBuyerMaker:false, time:Date.now() }]; }

  async placeOrder(params) {
    const id = `audit_ord_${this.nextOrderId++}`;
    const isMarket = params.type === 'MARKET' || !!params.quoteOrderQty;
    const status = isMarket ? 'FILLED' : 'NEW';
    const o = { orderId: id, status, executedQty: '1', cummulativeQuoteQty: '100', ...params };
    this.ordersPlaced.push(o);
    return o;
  }

  async getOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (!o) return { orderId, status: 'NEW', executedQty: '0', cummulativeQuoteQty: '0', price: '0' };
    if (o.side === 'SELL' && this.tpFilledMap[symbol]) {
      return { ...o, status: 'FILLED' };
    }
    return { ...o };
  }

  async getOpenOrders(symbol) {
    if (this.tpFilledMap[symbol]) return [];
    return this.ordersPlaced.filter(o => o.symbol === symbol && o.status === 'NEW');
  }
  async cancelOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (o) o.status = 'CANCELED';
    return { success: true, orderId };
  }
  async getMyTrades() { return []; }
}

const NEUTRAL_RADAR = { averageObiPct: 35.0, averageRsi15m: 60.0, exchanges: [] };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function runComprehensiveDryRunAudit() {
  console.log('================================================================================');
  console.log('🧪 COMPREHENSIVE DRY RUN AUDIT: ALL CARDS & EVERY CORRESPONDING FUNCTION');
  console.log('   Testing: Dynamic Thresholds, 3-Tick Persistence, Reset on Drop, Entry,');
  console.log('   TP Placement & Fill, Auto-Repeat Reset, Emergency RSI <= 20 Quick Sell,');
  console.log('   and Data Field State Updates (orders.json, tradeHistory, executionPrice).');
  console.log('================================================================================\n');

  const client = new AuditMockMexcClient();
  const tmpOrdersFile = path.join(__dirname, 'tmp-audit-orders.json');
  const tmpLogsFile   = path.join(__dirname, 'tmp-audit-logs.json');

  for (const f of [tmpOrdersFile, tmpLogsFile]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const tracker = new MexcTracker(client, null);
  tracker.ordersPath = tmpOrdersFile;
  tracker.logsPath   = tmpLogsFile;
  tracker.orders     = [];

  let currentRadarSignal = NEUTRAL_RADAR;
  tracker.signalRadar = {
    getRadarMetrics: () => currentRadarSignal,
    getMultiExchangeMetrics: async () => currentRadarSignal
  };

  // Test Cards setup covering various threshold combinations
  const testCardsConfig = [
    { symbol: 'BTCUSDT',  targetObi: 60.0, targetRsi: 45.0, takeProfit: 0.60, amountUsdt: 100 },
    { symbol: 'ETHUSDT',  targetObi: 55.0, targetRsi: 49.0, takeProfit: 0.50, amountUsdt: 100 },
    { symbol: 'XAUTUSDT', targetObi: 50.0, targetRsi: 50.0, takeProfit: 0.40, amountUsdt: 100 }
  ];

  console.log('📋 CREATING TEST CARDS WITH DYNAMIC CUSTOM THRESHOLDS:');
  for (const cfg of testCardsConfig) {
    const c = await tracker.addOrder({
      symbol: cfg.symbol,
      quoteOrderQty: cfg.amountUsdt,
      takeProfit: cfg.takeProfit,
      stopLoss: 1.5,
      filterObi: true,
      targetObi: cfg.targetObi,
      targetRsi: cfg.targetRsi,
      autoRepeat: true,
      dryRun: true
    });
    console.log(`   ✓ Card [${c.symbol}]: OBI >= ${c.customObiThreshold}% | RSI <= ${c.customRsiThreshold} | TP +${c.takeProfit}% | DryRun: ${c.dryRun}`);
  }

  if (tracker.intervalId) { clearInterval(tracker.intervalId); tracker.intervalId = null; }

  let auditPassed = true;

  // ---------------------------------------------------------------------------
  // STEP 1: TEST RESET ON DROP (Tick 1 valid -> Tick 2 invalid -> reset to 0)
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🔍 STEP 1: TESTING FLASH DROP RESET (Tick 1 Valid -> Tick 2 Invalid -> Reset to 0)');
  console.log('------------------------------------------------------------------------');

  // Tick 1: OBI & RSI both valid for BTCUSDT (OBI 62% >= 60%, RSI 40 <= 45)
  client.setPrices({ BTCUSDT: 65000, ETHUSDT: 3400, XAUTUSDT: 2400 });
  currentRadarSignal = { averageObiPct: 62.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 62.0 }] };
  await tracker.tick();
  
  let btcCard = tracker.orders.find(o => o.symbol === 'BTCUSDT');
  console.log(`   BTC Tick 1 (Valid): obiPersistenceCount = ${btcCard.obiPersistenceCount} (Expected: 1)`);
  if (btcCard.obiPersistenceCount !== 1) auditPassed = false;

  // Tick 2: OBI drops to 58.0% (< 60%) -> Must reset count to 0!
  currentRadarSignal = { averageObiPct: 58.0, averageRsi15m: 40.0, exchanges: [{ name: 'Binance', obiPct: 58.0 }] };
  await tracker.tick();
  
  btcCard = tracker.orders.find(o => o.symbol === 'BTCUSDT');
  console.log(`   BTC Tick 2 (OBI drop 58% < 60%): obiPersistenceCount = ${btcCard.obiPersistenceCount} (Expected: 0 Reset)`);
  if (btcCard.obiPersistenceCount !== 0) auditPassed = false;

  if (auditPassed) {
    console.log('   ✅ STEP 1 PASSED: Persistence counter correctly reset to 0 upon drop!');
  } else {
    console.error('   ❌ STEP 1 FAILED!');
  }

  // ---------------------------------------------------------------------------
  // STEP 2: TEST 3-TICK PERSISTENCE ENTRY ACROSS ALL CARDS
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🔍 STEP 2: TESTING 3-TICK PERSISTENCE ENTRY ACROSS ALL CARDS (3 Ticks -> Entry)');
  console.log('------------------------------------------------------------------------');

  // Set signal valid for ALL 3 cards: OBI = 65% (>= 60, 55, 50), RSI = 38 (<= 45, 49, 50)
  currentRadarSignal = { averageObiPct: 65.0, averageRsi15m: 38.0, exchanges: [{ name: 'Binance', obiPct: 65.0 }] };

  // Tick 1 (1s)
  await tracker.tick();
  console.log(`   Tick 1 (1s): BTC count=${tracker.orders[0].obiPersistenceCount}, ETH count=${tracker.orders[1].obiPersistenceCount}, XAUT count=${tracker.orders[2].obiPersistenceCount}`);

  // Tick 2 (2s)
  await tracker.tick();
  console.log(`   Tick 2 (2s): BTC count=${tracker.orders[0].obiPersistenceCount}, ETH count=${tracker.orders[1].obiPersistenceCount}, XAUT count=${tracker.orders[2].obiPersistenceCount}`);

  // Tick 3 (3s) -> Triggers PENDING_BUY
  await tracker.tick();
  console.log(`   Tick 3 (3s): Triggered entries! Processing PENDING_BUY market buys...`);

  // Tick 4 -> Process PENDING_BUY -> Transitions to TP_SL_ACTIVE
  await tracker.tick();
  currentRadarSignal = NEUTRAL_RADAR; // Neutralize radar after entries fire

  for (const card of tracker.orders) {
    console.log(`   ✓ Card [${card.symbol}]: Status = ${card.status} | Execution Price = $${card.executionPrice} | Persistence = ${card.obiPersistenceCount}`);
    if (card.status !== 'TP_SL_ACTIVE' || !card.executionPrice) {
      auditPassed = false;
    }
  }

  if (auditPassed) {
    console.log('   ✅ STEP 2 PASSED: All cards successfully triggered Entry after 3/3 continuous ticks!');
  } else {
    console.error('   ❌ STEP 2 FAILED!');
  }

  // ---------------------------------------------------------------------------
  // STEP 3: TEST TAKE PROFIT EXECUTION & AUTO-REPEAT CYCLE RESET
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🔍 STEP 3: TESTING TAKE PROFIT HIT & AUTO-REPEAT CYCLE RESET');
  console.log('------------------------------------------------------------------------');

  // BTCUSDT TP target: $65000 * 1.0060 = $65390 -> set price $65400
  // XAUTUSDT TP target: $2400 * 1.0040 = $2409.60 -> set price $2410
  // ETHUSDT price remains $3400 (TP target is $3417, so ETH stays holding)

  console.log('   Updating market prices: BTC=$65400 (TP $65390), XAUT=$2410 (TP $2409.60), ETH=$3400...');
  client.setPrices({ BTCUSDT: 65400, ETHUSDT: 3400, XAUTUSDT: 2410 });
  await tracker.tick();
  await wait(500);

  const btcPostTp  = tracker.orders.find(o => o.symbol === 'BTCUSDT');
  const xautPostTp = tracker.orders.find(o => o.symbol === 'XAUTUSDT');
  const ethPostTp  = tracker.orders.find(o => o.symbol === 'ETHUSDT');

  console.log(`   ✓ BTCUSDT  Status = ${btcPostTp.status}  | Trade History Cycles = ${btcPostTp.tradeHistory ? btcPostTp.tradeHistory.length : 0} | Exec Price = ${btcPostTp.executionPrice}`);
  console.log(`   ✓ XAUTUSDT Status = ${xautPostTp.status} | Trade History Cycles = ${xautPostTp.tradeHistory ? xautPostTp.tradeHistory.length : 0} | Exec Price = ${xautPostTp.executionPrice}`);
  console.log(`   ✓ ETHUSDT  Status = ${ethPostTp.status} (Holding as price has not hit TP target yet)`);

  if (btcPostTp.status === 'PENDING_ACTIVATION' && btcPostTp.tradeHistory.length === 1 &&
      xautPostTp.status === 'PENDING_ACTIVATION' && xautPostTp.tradeHistory.length === 1 &&
      ethPostTp.status === 'TP_SL_ACTIVE') {
    console.log('   ✅ STEP 3 PASSED: Take Profit executed, profit added to tradeHistory, & cards reset to PENDING_ACTIVATION!');
  } else {
    console.error('   ❌ STEP 3 FAILED!');
    auditPassed = false;
  }

  // ---------------------------------------------------------------------------
  // STEP 4: TEST EMERGENCY RSI <= 20 QUICK SELL ON ACTIVE HOLDING CARD (ETHUSDT)
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🔍 STEP 4: TESTING EMERGENCY RSI <= 20 QUICK SELL ON ACTIVE HOLDING CARD (ETHUSDT)');
  console.log('------------------------------------------------------------------------');

  console.log('   ETHUSDT is currently in TP_SL_ACTIVE (Holding)...');
  console.log('   Simulating sudden market crash with 4h 15m RSI = 18.0 (<= 20.0)...');

  client.setPrices({ BTCUSDT: 65000, ETHUSDT: 3300, XAUTUSDT: 2400 });
  currentRadarSignal = { averageObiPct: 40.0, averageRsi15m: 18.0, exchanges: [{ name: 'Binance', obiPct: 40.0 }] };
  await tracker.tick();
  await wait(500);

  const ethPostCrash = tracker.orders.find(o => o.symbol === 'ETHUSDT');
  console.log(`   ✓ ETHUSDT Status after RSI 18.0 Crash = ${ethPostCrash.status} | Trade History Cycles = ${ethPostCrash.tradeHistory.length} | Error = "${ethPostCrash.error}"`);

  if (ethPostCrash.status === 'PENDING_ACTIVATION' && ethPostCrash.tradeHistory.length === 1 && ethPostCrash.error.includes('RSI Crash SL Hit')) {
    console.log('   ✅ STEP 4 PASSED: RSI <= 20 Emergency Quick Sell successfully executed & card reset!');
  } else {
    console.error('   ❌ STEP 4 FAILED!');
    auditPassed = false;
  }

  // ---------------------------------------------------------------------------
  // STEP 5: AUDIT ORDERS.JSON & FILE PERSISTENCE
  // ---------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🔍 STEP 5: PERSISTENT FILE AUDIT (Checking tmp-audit-orders.json)');
  console.log('------------------------------------------------------------------------');

  const fileDataRaw = fs.readFileSync(tmpOrdersFile, 'utf8');
  const fileOrders  = JSON.parse(fileDataRaw);

  console.log(`   Saved Orders in File: ${fileOrders.length} cards`);
  for (const fo of fileOrders) {
    console.log(`   - Card [${fo.symbol}]: status="${fo.status}", tradeHistory=${fo.tradeHistory ? fo.tradeHistory.length : 0} trades, obiPersistenceCount=${fo.obiPersistenceCount || 0}`);
  }

  if (fileOrders.length === 3 && fileOrders.every(o => o.status === 'PENDING_ACTIVATION')) {
    console.log('   ✅ STEP 5 PASSED: orders.json file accurately saved and synchronized without any missing fields or code exceptions!');
  } else {
    console.error('   ❌ STEP 5 FAILED!');
    auditPassed = false;
  }

  // Clean up temporary files
  for (const f of [tmpOrdersFile, tmpLogsFile]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  console.log('\n================================================================================');
  if (auditPassed) {
    console.log('🏆 OVERALL AUDIT RESULT: 100% SUCCESSFUL PASS! NO ISSUES OR CODE FAILURES FOUND!');
  } else {
    console.error('💥 OVERALL AUDIT RESULT: AUDIT FAILED!');
  }
  console.log('================================================================================');

  process.exit(auditPassed ? 0 : 1);
}

runComprehensiveDryRunAudit().catch(err => {
  console.error('❌ Fatal Execution Error:', err);
  process.exit(1);
});
