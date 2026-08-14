const OrderTracker = require('../tracker');
const path = require('path');

async function testRePeggingLoop() {
  console.log("=== TESTING 60-SECOND RE-PEGGING & SPREAD RE-EVALUATION LOOP ===");

  const tracker = new OrderTracker({
    ordersFilePath: path.join(__dirname, '../data/orders.json'),
    logsFilePath: path.join(__dirname, '../data/logs.json')
  });

  const testOrder = {
    symbol: 'NVDAXUSDT',
    status: 'PENDING_ACTIVATION',
    customRsiThreshold: 45,
    customObiThreshold: 60,
    checkRsi: true,
    checkObi: true,
    filterObi: true,
    dryRun: true,
    quoteOrderQty: 100,
    takeProfit: 0.6,
    maxSpreadPct: 0.30,
    obiPersistenceCount: 2 // Start at 2 so 1 tick triggers dual-gate
  };

  tracker.loadOrders = function() {
    this.orders = [testOrder];
    return this.orders;
  };

  tracker.saveOrders = function() {
    return true;
  };

  tracker.mexcClient.getTickerPrice = async function(symbol) {
    return 100.5;
  };

  // Mock Signal Radar for Top 10 Exchange OBI & RSI
  tracker.signalRadar = {
    getRadarMetrics: () => ({
      averageObiPct: 65.0,
      averageRsi15m: 40.0,
      exchanges: [{ name: 'MEXC', obiPct: 65.0 }]
    }),
    getMultiExchangeMetrics: async () => ({
      averageObiPct: 65.0,
      averageRsi15m: 40.0,
      exchanges: [{ name: 'MEXC', obiPct: 65.0 }]
    })
  };

  // Mock Market Data (Wide Spread: Bid = 100, Ask = 101 => Spread = 1.0%)
  tracker.fetchMarketData = async function(symbol) {
    return {
      price: 100.5,
      rsi1m: 40.0,
      obi: 65.0,
      bestBid: 100.0,
      bestAsk: 101.0,
      spreadPct: 1.0,
      candles: [{ close: 100.5 }, { close: 100.5 }]
    };
  };

  tracker.mexcClient.getDepth = async function(symbol, limit) {
    return {
      bids: [['100.00', '10']],
      asks: [['101.00', '10']]
    };
  };

  // Step 1: Initial Signal Trigger -> Wide Spread > 0.3% -> Places Top Limit Buy (100.01), 60s timer starts
  console.log("\n--- Step 1: Initial Signal Trigger ---");
  tracker.loadOrders();
  await tracker.tick();
  console.log(`Card Status: ${testOrder.status}`);
  console.log(`Target Buy Price: $${testOrder.targetBuyPrice}`);
  console.log(`Placed At: ${testOrder.limitBuyPlacedAt ? new Date(testOrder.limitBuyPlacedAt).toISOString() : 'N/A'}`);

  if (testOrder.status !== 'PENDING_LIMIT_BUY') {
    throw new Error(`Expected PENDING_LIMIT_BUY, got ${testOrder.status}`);
  }

  // Step 2: Simulate 60 seconds passing (Timeout Expired) with Spread still Wide (1.0%)
  console.log("\n--- Step 2: 60s Timeout Expired (Spread Still Wide > 0.3%) ---");
  testOrder.limitBuyPlacedAt = Date.now() - 61000; // Force 61s elapsed

  await tracker.tick();
  console.log(`Card Status: ${testOrder.status}`);
  console.log(`New Target Buy Price: $${testOrder.targetBuyPrice}`);
  console.log(`Re-placed At: ${new Date(testOrder.limitBuyPlacedAt).toISOString()}`);

  if (testOrder.status !== 'PENDING_LIMIT_BUY') {
    throw new Error(`Expected PENDING_LIMIT_BUY (re-pegged), got ${testOrder.status}`);
  }

  // Step 3: Simulate another 60s passing, but now Spread narrows <= 0.3% (Bid = 100, Ask = 100.2 => Spread = 0.2%)
  console.log("\n--- Step 3: 60s Timeout Expired (Spread Narrows <= 0.3%) ---");
  testOrder.limitBuyPlacedAt = Date.now() - 61000;

  tracker.mexcClient.getDepth = async function(symbol, limit) {
    return {
      bids: [['100.00', '10']],
      asks: [['100.20', '10']]
    };
  };

  await tracker.tick();
  console.log(`Card Status: ${testOrder.status}`);

  if (testOrder.status !== 'PENDING_BUY') {
    throw new Error(`Expected PENDING_BUY (Market Buy switch), got ${testOrder.status}`);
  }

  // Step 4: Next tick -> Executes Market Buy -> Transitions to TP_SL_ACTIVE
  console.log("\n--- Step 4: Market Buy Execution ---");
  await tracker.tick();
  console.log(`Final Card Status: ${testOrder.status}`);
  console.log(`Execution Price: $${testOrder.executionPrice}`);

  if (testOrder.status !== 'TP_SL_ACTIVE') {
    throw new Error(`Expected TP_SL_ACTIVE, got ${testOrder.status}`);
  }

  console.log("\n✅ ALL 60-SECOND RE-PEGGING & SPREAD RE-EVALUATION TESTS PASSED PERFECTLY!");
}

testRePeggingLoop().catch(err => {
  console.error("❌ Test Failed:", err);
  process.exit(1);
});
