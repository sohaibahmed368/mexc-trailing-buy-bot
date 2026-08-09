const Tracker = require('../tracker');

class MockSignalRadar {
  constructor() {
    this.currentObi = 50.0;
    this.currentRsi = 50.0;
  }

  setRadarMetrics(obi, rsi) {
    this.currentObi = obi;
    this.currentRsi = rsi;
  }

  getRadarMetrics(symbol) {
    return {
      symbol,
      averageObiPct: this.currentObi,
      averageRsi15m: this.currentRsi,
      exchanges: [
        { name: 'Binance', obiPct: this.currentObi },
        { name: 'MEXC', obiPct: this.currentObi },
        { name: 'OKX', obiPct: this.currentObi },
        { name: 'Bybit', obiPct: this.currentObi }
      ]
    };
  }

  async getMultiExchangeMetrics(symbol) {
    return this.getRadarMetrics(symbol);
  }
}

class MockMexcClient {
  constructor() {
    this.price = 3000.0;
  }
  hasCredentials() { return true; }
  async getTickerPrice(symbol) { return this.price; }
  async getBalances() { return [{ asset: 'USDT', free: '1000', locked: '0' }]; }
  async placeOrder(params) { return { orderId: 'mock_ord_' + Date.now() }; }
  async cancelOrder(symbol, orderId) { return { status: 'CANCELED' }; }
  async getOrder(symbol, orderId) { return { status: 'FILLED', executedQty: '0.0333', price: '3018.0' }; }
}

async function runDryRunTestSuite() {
  console.log("================================================================================");
  console.log("🧪 DRY RUN FULL END-TO-END SCENARIO & FUNCTION TEST SUITE");
  console.log("   Testing Card Creation, Custom Thresholds, Signal Triggers, TP Hit & RSI <= 20 SL");
  console.log("================================================================================");

  const tracker = new Tracker();
  const mockRadar = new MockSignalRadar();
  const mockMexc = new MockMexcClient();

  tracker.signalRadar = mockRadar;
  tracker.mexcClient = mockMexc;
  tracker.orders = []; // Start clean

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Card Creation & Waiting State (Custom Thresholds, No Instant Buy)
  // ---------------------------------------------------------------------------
  console.log("\n▶️ SCENARIO 1: Creating Dry Run Card with Custom OBI (62.5%) & Custom RSI (38.0)...");
  const card = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '0.15',
    quantity: '',
    quoteOrderQty: '100',
    orderType: 'MARKET',
    dryRun: true,
    activationPrice: '',
    takeProfit: '0.60',
    stopLoss: '0',
    filterSmartSl: false,
    slBuffer: '0.15',
    filterObi: true,
    customObiThreshold: '62.5',
    customRsiThreshold: '38.0',
    filterVolume: false,
    filterRsi: false,
    autoRepeat: true,
    activationOffset: '0.15',
    startImmediately: true
  });

  console.log(`   ✓ Card Created ID: ${card.id}`);
  console.log(`   ✓ Initial Status: ${card.status} (Expected: PENDING_ACTIVATION)`);
  console.log(`   ✓ Custom OBI Threshold: ${card.customObiThreshold}% (Expected: 62.5%)`);
  console.log(`   ✓ Custom RSI Threshold: ${card.customRsiThreshold} (Expected: 38.0)`);

  if (card.status !== 'PENDING_ACTIVATION') throw new Error("SCENARIO 1 FAILED: Card did not start in PENDING_ACTIVATION!");
  if (card.customObiThreshold !== 62.5 || card.customRsiThreshold !== 38.0) throw new Error("SCENARIO 1 FAILED: Custom thresholds not set correctly!");

  // Test Deduplication Guard: Adding same symbol again should replace/update card without duplicate buy
  const card2 = await tracker.addOrder({
    symbol: 'ETHUSDT',
    trailValue: '0.15',
    quoteOrderQty: '100',
    dryRun: true,
    filterObi: true,
    customObiThreshold: '62.5',
    customRsiThreshold: '38.0',
    takeProfit: '0.60',
    autoRepeat: true
  });
  console.log(`   ✓ Duplicate Guard Verified: Total Cards in Tracker = ${tracker.orders.length} (Expected: 1)`);
  if (tracker.orders.length !== 1) throw new Error("Deduplication Guard Failed!");

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Neutral Market Tick (Signal Not Met)
  // ---------------------------------------------------------------------------
  console.log("\n▶️ SCENARIO 2: Tick with OBI = 58.0% (< 62.5%) & RSI = 42.0 (> 38.0)...");
  mockRadar.setRadarMetrics(58.0, 42.0);
  await tracker.tick({ ETHUSDT: 3000.0 });
  const cardAfterNeutral = tracker.orders[0];
  console.log(`   ✓ Status After Neutral Tick: ${cardAfterNeutral.status} (Expected: PENDING_ACTIVATION)`);
  if (cardAfterNeutral.status !== 'PENDING_ACTIVATION') throw new Error("SCENARIO 2 FAILED: Triggered prematurely on neutral tick!");

  // ---------------------------------------------------------------------------
  // SCENARIO 3: Custom Dual Gate Signal Trigger & Entry Execution
  // ---------------------------------------------------------------------------
  console.log("\n▶️ SCENARIO 3: Tick with Signal Met (OBI = 64.0% >= 62.5% & RSI = 35.0 <= 38.0)...");
  mockRadar.setRadarMetrics(64.0, 35.0);
  await tracker.tick({ ETHUSDT: 3000.0 });
  
  // Tick again to simulate execution transition
  await tracker.tick({ ETHUSDT: 3000.0 });
  const cardAfterTrigger = tracker.orders[0];
  console.log(`   ✓ Status After Signal Trigger: ${cardAfterTrigger.status} (Expected: TP_SL_ACTIVE / Holding)`);
  console.log(`   ✓ Execution Price: $${cardAfterTrigger.executionPrice} USDT`);
  const expectedTp = 3000.0 * 1.006;
  console.log(`   ✓ TP Target Price (+0.60%): $${expectedTp.toFixed(4)} USDT`);
  if (cardAfterTrigger.status !== 'TP_SL_ACTIVE') throw new Error("SCENARIO 3 FAILED: Card did not transition to TP_SL_ACTIVE!");

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Normal Take Profit Hit (+0.60%)
  // ---------------------------------------------------------------------------
  console.log("\n▶️ SCENARIO 4: Price Rises to $3,018.50 USDT (>= $3,018.00 TP Target)...");
  mockRadar.setRadarMetrics(50.0, 50.0);
  mockMexc.price = 3018.50;
  await tracker.tick({ ETHUSDT: 3018.50 });
  const cardAfterTp = tracker.orders[0];
  console.log(`   ✓ Status After TP Hit: ${cardAfterTp.status} (Expected: PENDING_ACTIVATION)`);
  console.log(`   ✓ Total Net Profit Accumulated: +$${cardAfterTp.totalNetProfit.toFixed(4)} USDT`);
  if (cardAfterTp.status !== 'PENDING_ACTIVATION') throw new Error(`SCENARIO 4 FAILED: Auto-Repeat reset failed after TP Hit! Actual Status: ${cardAfterTp.status}`);
  if (cardAfterTp.totalNetProfit <= 0) throw new Error("SCENARIO 4 FAILED: Net profit was not accumulated after TP Hit!");

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Smart RSI Crash Stop Loss Guard (RSI <= 20.0 Emergency Market Sell)
  // ---------------------------------------------------------------------------
  console.log("\n▶️ SCENARIO 5: Testing RSI <= 20.0 Emergency Stop Loss Market Sell Guard...");
  // Manually put card into TP_SL_ACTIVE holding state for scenario testing
  cardAfterTp.status = 'TP_SL_ACTIVE';
  cardAfterTp.executionPrice = 3000.0;
  mockMexc.price = 2950.0;
  
  console.log("   Simulating Market Crash: Price drops to $2,950.00 & 4h 15m RSI drops to 18.5 (<= 20.0)...");
  mockRadar.setRadarMetrics(65.0, 18.5); // OBI high but RSI crash <= 20.0
  await tracker.tick({ ETHUSDT: 2950.0 });
  
  const cardAfterRsiSl = tracker.orders[0];
  console.log(`   ✓ Status After Emergency SL: ${cardAfterRsiSl.status} (Expected: PENDING_ACTIVATION or TRIGGERED)`);
  console.log(`   ✓ Error/SL Log: ${cardAfterRsiSl.error}`);
  if (!cardAfterRsiSl.error || !cardAfterRsiSl.error.includes('RSI Crash SL Hit')) {
    throw new Error("SCENARIO 5 FAILED: Emergency RSI Crash Stop Loss did not trigger!");
  }

  console.log("\n================================================================================");
  console.log("🏆 ALL 5 DRY RUN SCENARIOS & FUNCTIONS PASSED 100% SUCCESSFULLY!");
  console.log("================================================================================");

  if (tracker.intervalId) clearInterval(tracker.intervalId);
  process.exit(0);
}

runDryRunTestSuite().catch(err => {
  console.error("❌ TEST SUITE FAILED:", err);
  process.exit(1);
});
