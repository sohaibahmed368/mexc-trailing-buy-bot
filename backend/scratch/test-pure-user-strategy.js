const assert = require('assert');
const OrderTracker = require('../tracker');

async function testPureUserStrategy() {
  console.log('🧪 Testing Pure User Strategy (Top 10 OBI >= Target & 4h 15m RSI <= Target -> 3-Tick Buy -> TP Limit Sell -> Reset)...');

  const tracker = new OrderTracker();
  
  // Set single test card (ETHUSDT)
  const ethCard = {
    id: "ord_eth_master",
    symbol: "ETHUSDT",
    quoteOrderQty: 100,
    orderType: "MARKET",
    dryRun: true,
    status: "PENDING_ACTIVATION",
    takeProfit: 0.5,
    stopLoss: 0,
    filterObi: true,
    customObiThreshold: 55,
    customRsiThreshold: 49,
    autoRepeat: true,
    totalNetProfit: 0,
    tradeHistory: [],
    obiPersistenceCount: 0
  };

  tracker.orders = [ethCard];

  let mockObi = 50.0;
  let mockRsi = 55.0;
  let mockPrice = 2650.0;

  tracker.signalRadar = {
    getRadarMetrics: () => ({ averageObiPct: mockObi, averageRsi15m: mockRsi, exchanges: [] }),
    getMultiExchangeMetrics: async () => ({ averageObiPct: mockObi, averageRsi15m: mockRsi, exchanges: [] })
  };

  tracker.mexcClient = {
    hasCredentials: () => false,
    getAllPrices: async () => ({ ETHUSDT: String(mockPrice) }),
    getTickerPrice: async () => mockPrice,
    getBalances: async () => [],
    getDepth: async () => ({ bids: [['2649.0', '10']], asks: [['2650.0', '10']] }),
    placeOrder: async () => ({ orderId: 'test_order_1' }),
    getOrder: async () => ({ status: 'FILLED', executedQty: '0.0377', price: String(mockPrice) })
  };

  // 1. Initial State: OBI = 50% (< 55%) or RSI = 55 (> 49) -> MUST NOT BUY!
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must stay PENDING_ACTIVATION when conditions not met');
  assert(tracker.orders[0].obiPersistenceCount === 0, 'Persistence count must be 0');
  console.log('✅ Step 1: Gate blocked buy when OBI = 50% & RSI = 55.');

  // 2. Market Condition Matches: OBI = 56% (>= 55%) & RSI = 48 (<= 49)
  // Tick 1
  mockObi = 56.0;
  mockRsi = 48.0;
  await tracker.tick();
  assert(tracker.orders[0].obiPersistenceCount === 1, 'Tick 1/3 sustained');
  console.log('✅ Step 2: Conditions met (OBI 56% >= 55% & RSI 48 <= 49). Sustained Tick 1/3.');

  // 3. Flapping Check: OBI drops to 52% on Tick 2 -> Persistence counter must IMMEDIATELY RESET to 0!
  mockObi = 52.0;
  await tracker.tick();
  assert(tracker.orders[0].obiPersistenceCount === 0, 'Persistence counter must reset to 0 on signal drop');
  console.log('✅ Step 3: Signal flapped (OBI 52%). Persistence counter cleanly reset to 0/3.');

  // 4. Stable Signal: Sustains 3 consecutive ticks (Tick 1/3, 2/3, 3/3)
  mockObi = 56.0;
  await tracker.tick(); // 1/3
  assert(tracker.orders[0].obiPersistenceCount === 1);
  await tracker.tick(); // 2/3
  assert(tracker.orders[0].obiPersistenceCount === 2);
  await tracker.tick(); // 3/3 -> Transitions to PENDING_BUY
  assert(tracker.orders[0].status === 'PENDING_BUY', 'Must transition to PENDING_BUY on 3/3 ticks!');
  console.log('✅ Step 4: Sustained 3/3 consecutive ticks! Transitioned to PENDING_BUY.');

  // 5. Buy Execution -> TP_SL_ACTIVE (Holding)
  await tracker.tick();
  assert(tracker.orders[0].status === 'TP_SL_ACTIVE', 'Must be TP_SL_ACTIVE holding position');
  assert(tracker.orders[0].executionPrice === 2650.0, 'Execution price recorded');
  console.log(`✅ Step 5: Executed Market Buy at $${tracker.orders[0].executionPrice}. Card status: TP_SL_ACTIVE (Holding with TP Limit Sell).`);

  // 6. Take Profit Hit (+0.5%) -> Cycle Complete -> Reset to PENDING_ACTIVATION
  const tpPrice = 2650.0 * 1.005; // $2,663.25
  mockPrice = tpPrice + 1.0;
  await tracker.tick();
  assert(tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must reset to PENDING_ACTIVATION after TP hit!');
  assert(tracker.orders[0].tradeHistory.length === 1, 'Trade history recorded');
  assert(tracker.orders[0].totalNetProfit > 0, 'Profit captured');
  console.log(`✅ Step 6: TP Hit at $${mockPrice}! Captured +$${tracker.orders[0].totalNetProfit.toFixed(4)} USDT. Card cleanly reset to PENDING_ACTIVATION for next loop!`);

  // 7. Emergency RSI Stop Loss Check
  // Transition card to TP_SL_ACTIVE for SL test
  tracker.orders[0].status = 'TP_SL_ACTIVE';
  tracker.orders[0].executionPrice = 2650.0;
  mockPrice = 2500.0;
  mockRsi = 19.5; // RSI <= 20.0 (Emergency Crash)
  await tracker.tick();
  assert(tracker.orders[0].status === 'TRIGGERED' || tracker.orders[0].status === 'PENDING_ACTIVATION', 'Must trigger Emergency SL');
  console.log('✅ Step 7: Emergency Stop Loss triggered when 4h 15m RSI = 19.5 (<= 20.0)!');

  console.log('\n================================================================================');
  console.log('🏆 100% PURE USER STRATEGY LIFECYCLE TEST PASSED WITH ZERO FLUFF!');
  console.log('================================================================================\n');

  process.exit(0);
}

testPureUserStrategy().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
