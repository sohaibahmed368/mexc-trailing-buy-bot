const assert = require('assert');
const OrderTracker = require('../tracker');

async function testDynamicPerCardThresholds() {
  console.log('🧪 Testing Multi-Card Dynamic Per-Card Threshold Evaluation (Zero Hardcoding)...');

  const tracker = new OrderTracker();

  // Create 4 distinct cards with different OBI/RSI configurations
  const card1 = {
    id: "card_1_strict_60_45",
    symbol: "BTCUSDT",
    status: "PENDING_ACTIVATION",
    customObiThreshold: 60.0,
    customRsiThreshold: 45.0,
    filterObi: true,
    obiPersistenceCount: 0
  };

  const card2 = {
    id: "card_2_medium_58_46",
    symbol: "ETHUSDT",
    status: "PENDING_ACTIVATION",
    customObiThreshold: 58.0,
    customRsiThreshold: 46.0,
    filterObi: true,
    obiPersistenceCount: 0
  };

  const card3 = {
    id: "card_3_standard_55_50",
    symbol: "GOLD(XAUT)USDT",
    status: "PENDING_ACTIVATION",
    customObiThreshold: 55.0,
    customRsiThreshold: 50.0,
    filterObi: true,
    obiPersistenceCount: 0
  };

  const card4 = {
    id: "card_4_ultra_strict_65_40",
    symbol: "SOLUSDT",
    status: "PENDING_ACTIVATION",
    targetObi: 65.0,
    targetRsi: 40.0,
    filterObi: true,
    obiPersistenceCount: 0
  };

  tracker.orders = [card1, card2, card3, card4];

  // Market Conditions per symbol
  let marketSignals = {
    BTCUSDT: { averageObiPct: 58.0, averageRsi15m: 46.0 },        // Should FAIL Card 1 (Req >= 60% & <= 45)
    ETHUSDT: { averageObiPct: 58.0, averageRsi15m: 46.0 },        // Should PASS Card 2 (Req >= 58% & <= 46)
    'GOLD(XAUT)USDT': { averageObiPct: 56.0, averageRsi15m: 49.0 }, // Should PASS Card 3 (Req >= 55% & <= 50)
    SOLUSDT: { averageObiPct: 62.0, averageRsi15m: 42.0 }         // Should FAIL Card 4 (Req >= 65% & <= 40)
  };

  tracker.signalRadar = {
    getRadarMetrics: (sym) => marketSignals[sym] || { averageObiPct: 50.0, averageRsi15m: 50.0, exchanges: [] },
    getMultiExchangeMetrics: async (sym) => marketSignals[sym] || { averageObiPct: 50.0, averageRsi15m: 50.0, exchanges: [] }
  };

  tracker.mexcClient = {
    hasCredentials: () => false,
    getAllPrices: async () => ({ BTCUSDT: '60000', ETHUSDT: '2650', 'GOLD(XAUT)USDT': '2650', SOLUSDT: '140' }),
    getTickerPrice: async (sym) => 100,
    getBalances: async () => [],
    getDepth: async () => ({ bids: [['100', '1']], asks: [['100.1', '1']] }),
    placeOrder: async () => ({ orderId: 'test_id' }),
    getOrder: async () => ({ status: 'FILLED', executedQty: '1', price: '100' })
  };

  // Run Tick 1: Check independent evaluation
  await tracker.tick();

  // Assertions:
  // Card 1: 58.0% < 60.0% & 46.0 > 45.0 -> MUST FAIL (persistence = 0)
  assert(card1.obiPersistenceCount === 0, 'Card 1 must FAIL when OBI 58% < 60% or RSI 46 > 45');
  console.log(`✅ Card 1 (BTCUSDT | Req: OBI>=60%, RSI<=45): Correctly BLOCKED (Market OBI: 58%, RSI: 46). Persistence: ${card1.obiPersistenceCount}/3`);

  // Card 2: 58.0% >= 58.0% & 46.0 <= 46.0 -> MUST PASS (persistence = 1)
  assert(card2.obiPersistenceCount === 1, 'Card 2 must PASS when OBI 58% >= 58% & RSI 46 <= 46');
  console.log(`✅ Card 2 (ETHUSDT | Req: OBI>=58%, RSI<=46): Correctly PASSED (Market OBI: 58%, RSI: 46). Persistence: ${card2.obiPersistenceCount}/3`);

  // Card 3: 56.0% >= 55.0% & 49.0 <= 50.0 -> MUST PASS (persistence = 1)
  assert(card3.obiPersistenceCount === 1, 'Card 3 must PASS when OBI 56% >= 55% & RSI 49 <= 50');
  console.log(`✅ Card 3 (GOLD | Req: OBI>=55%, RSI<=50): Correctly PASSED (Market OBI: 56%, RSI: 49). Persistence: ${card3.obiPersistenceCount}/3`);

  // Card 4: 62.0% < 65.0% & 42.0 > 40.0 -> MUST FAIL (persistence = 0)
  assert(card4.obiPersistenceCount === 0, 'Card 4 must FAIL when OBI 62% < 65% or RSI 42 > 40');
  console.log(`✅ Card 4 (SOLUSDT | Req: OBI>=65%, RSI<=40): Correctly BLOCKED (Market OBI: 62%, RSI: 42). Persistence: ${card4.obiPersistenceCount}/3`);

  // Update Market Conditions for Card 1 & Card 4 to PASS
  marketSignals.BTCUSDT = { averageObiPct: 61.5, averageRsi15m: 44.0 };
  marketSignals.SOLUSDT = { averageObiPct: 66.0, averageRsi15m: 38.5 };

  await tracker.tick(); // Tick 2

  assert(card1.obiPersistenceCount === 1, 'Card 1 must now PASS on 61.5% OBI & 44.0 RSI');
  assert(card4.obiPersistenceCount === 1, 'Card 4 must now PASS on 66.0% OBI & 38.5 RSI');
  console.log(`\n✅ Tick 2: Market conditions improved for Card 1 & Card 4. Both now correctly accumulating persistence ticks (1/3)!`);

  console.log('\n================================================================================');
  console.log('🏆 MULTI-CARD INDEPENDENT DYNAMIC THRESHOLD TEST PASSED 100% CLEANLY!');
  console.log('================================================================================\n');

  process.exit(0);
}

testDynamicPerCardThresholds().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
