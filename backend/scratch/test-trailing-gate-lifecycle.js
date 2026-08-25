const assert = require('assert');
const OrderTracker = require('../tracker');

async function testTrailingGateLifecycle() {
  console.log('🧪 Testing Complete Trailing Dip + Rebound + Dual Gate Lifecycle...');

  const tracker = new OrderTracker();
  
  // Create a test card for SHIBUSDT
  const testCard = {
    id: 'test_shib_1',
    symbol: 'SHIBUSDT',
    trailValue: '0.15',
    quoteOrderQty: 100,
    orderType: 'MARKET',
    dryRun: true,
    status: 'PENDING_ACTIVATION',
    startImmediately: false,
    peakPrice: 0.00001400,
    activationOffset: 0.15,
    activationPrice: 0.00001400 * (1 - 0.0015), // 0.000013979
    customObiThreshold: 55,
    customRsiThreshold: 49,
    filterObi: true,
    autoRepeat: true,
    obiPersistenceCount: 0
  };

  tracker.orders = [testCard];

  // Mock SignalRadar that returns OBI = 56% (PASS) and RSI = 45 (PASS)
  tracker.signalRadar = {
    getRadarMetrics: () => ({ averageObiPct: 56.0, averageRsi15m: 45.0, exchanges: [] }),
    getMultiExchangeMetrics: async () => ({ averageObiPct: 56.0, averageRsi15m: 45.0, exchanges: [] })
  };

  // Mock MEXC Client
  let currentMockPrice = 0.00001400;
  tracker.mexcClient = {
    hasCredentials: () => false,
    getAllPrices: async () => ({ SHIBUSDT: String(currentMockPrice) }),
    getTickerPrice: async () => currentMockPrice,
    getBalances: async () => [],
    getDepth: async () => ({ bids: [['0.00001390', '1000000']], asks: [['0.00001391', '1000000']] }),
    placeOrder: async () => ({ orderId: 'test_buy_1' }),
    getOrder: async () => ({ status: 'FILLED', executedQty: '7000000', price: String(currentMockPrice) })
  };

  // Tick 1: Price is at peak ($0.00001400 > activationPrice $0.000013979)
  // Even though OBI & RSI pass, it MUST NOT BUY because price has not dipped to activationPrice!
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must NOT buy when price > activationPrice!');
  console.log('✅ Tick 1: Blocked instant buy at peak price ($0.00001400 > $0.000013979).');

  // Tick 2: Price dips to $0.00001390 (< activationPrice $0.000013979)
  // Trailing bottom is set to 0.00001390, triggerPrice = 0.00001390 * 1.0015 = 0.0000139208
  currentMockPrice = 0.00001390;
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must NOT buy at bottom before rebound!');
  assert(tracker.orders[0].bottomPrice === 0.00001390, 'Bottom price must be recorded');
  console.log(`✅ Tick 2: Bottom price recorded at $${tracker.orders[0].bottomPrice}. Buy Trigger set to $${tracker.orders[0].triggerPrice.toFixed(8)}.`);

  // Tick 3: Price drops further to $0.00001380
  // New bottom must update, must still not buy
  currentMockPrice = 0.00001380;
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must NOT buy while dipping!');
  assert(tracker.orders[0].bottomPrice === 0.00001380, 'Bottom price must update lower');
  console.log(`✅ Tick 3: Bottom shifted down to $${tracker.orders[0].bottomPrice}. Trigger recalculated to $${tracker.orders[0].triggerPrice.toFixed(8)}.`);

  // Tick 4: Price rebounds to trigger price ($0.00001383 >= triggerPrice)
  // Persistence 1/3
  currentMockPrice = 0.00001383;
  await tracker.tick();
  assert(tracker.orders[0].obiPersistenceCount === 1, 'Persistence tick 1/3 must record');
  console.log('✅ Tick 4: Rebound reached trigger price. Sustained 1/3 persistence ticks.');

  // Tick 5: Persistence 2/3
  await tracker.tick();
  assert(tracker.orders[0].obiPersistenceCount === 2, 'Persistence tick 2/3 must record');
  console.log('✅ Tick 5: Sustained 2/3 persistence ticks.');

  // Tick 6: Persistence 3/3 -> Transition to PENDING_BUY
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_BUY', 'Must transition to PENDING_BUY on 3/3 persistence!');
  console.log('✅ Tick 6: 3/3 Ticks Sustained! Transitioned to PENDING_BUY.');

  // Tick 6b: Market Buy Execution -> TP_SL_ACTIVE
  await tracker.tick();
  assert(tracker.orders[0].status === 'TP_SL_ACTIVE', 'Must transition to TP_SL_ACTIVE after buy execution!');
  console.log('✅ Tick 6b: Market Buy Executed and TP/SL active.');

  // Tick 7: TP Hit -> Cycle Complete -> Reset to PENDING_ACTIVATION with fresh peak and dip requirement
  tracker.orders[0].takeProfit = 0.5;
  const tpTarget = tracker.orders[0].executionPrice * 1.005;
  currentMockPrice = tpTarget + 0.0000001;
  await tracker.tick();

  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must reset to PENDING_ACTIVATION after TP hit!');
  assert(tracker.orders[0].startImmediately === false, 'startImmediately must be FALSE after TP hit!');
  assert(tracker.orders[0].bottomPrice === null, 'bottomPrice must be reset to null');
  assert(tracker.orders[0].triggerPrice === null, 'triggerPrice must be reset to null');
  assert(tracker.orders[0].activationPrice < tracker.orders[0].peakPrice, 'activationPrice must require dip below sell price!');
  console.log(`✅ Tick 7: TP Hit! Trade recorded. Reset to PENDING_ACTIVATION (startImmediately=false, Req Dip to $${tracker.orders[0].activationPrice.toFixed(8)}).`);

  // Tick 8: Price still at sell price -> Must NOT immediately rebuy!
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must NOT immediately rebuy after TP sell!');
  console.log('✅ Tick 8: Rebuy blocked! Bot patiently waiting for next dip.');

  console.log('\n🏆 ALL TRAILING GATE LIFECYCLE TESTS PASSED 100% CLEANLY!');
  process.exit(0);
}

testTrailingGateLifecycle().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
