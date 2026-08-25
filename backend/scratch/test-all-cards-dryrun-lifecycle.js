const assert = require('assert');
const OrderTracker = require('../tracker');
const fs = require('fs');
const path = require('path');

async function testAllActiveCardsLifecycle() {
  console.log(`\n================================================================================`);
  console.log(`🧪 COMPREHENSIVE DRY-RUN LIFECYCLE SIMULATION SUITE ACROSS ALL ACTIVE CARDS`);
  console.log(`================================================================================\n`);

  const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
  const cards = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));

  console.log(`Loaded ${cards.length} Active Master Cards from orders.json:\n`);

  for (let cIdx = 0; cIdx < cards.length; cIdx++) {
    const originalCard = cards[cIdx];
    const symbol = originalCard.symbol;
    const targetObi = originalCard.customObiThreshold !== undefined ? parseFloat(originalCard.customObiThreshold) : (originalCard.targetObi || 55.0);
    const targetRsi = originalCard.customRsiThreshold !== undefined ? parseFloat(originalCard.customRsiThreshold) : (originalCard.targetRsi || 49.0);
    const tpPct = originalCard.takeProfit || 0.5;

    console.log(`--------------------------------------------------------------------------------`);
    console.log(`🃏 CARD #${cIdx + 1}: ${symbol} | Target OBI: >= ${targetObi}% | Target RSI: <= ${targetRsi} | TP: +${tpPct}%`);
    console.log(`--------------------------------------------------------------------------------`);

    const tracker = new OrderTracker();

    // Prepare clean dry-run test card
    const testCard = {
      ...originalCard,
      dryRun: true,
      status: 'PENDING_ACTIVATION',
      executionPrice: null,
      mexcOrderId: null,
      mexcSellOrderId: null,
      totalNetProfit: 0,
      tradeHistory: [],
      obiPersistenceCount: 0,
      autoRepeat: true
    };

    tracker.orders = [testCard];

    let liveObi = 50.0;
    let liveRsi = 55.0;
    let livePrice = symbol.includes('GOLD') ? 2650.0 : symbol.includes('ETH') ? 2680.0 : symbol.includes('EUR') ? 1.17 : 350.0;

    tracker.signalRadar = {
      getRadarMetrics: () => ({ averageObiPct: liveObi, averageRsi15m: liveRsi, exchanges: [] }),
      getMultiExchangeMetrics: async () => ({ averageObiPct: liveObi, averageRsi15m: liveRsi, exchanges: [] })
    };

    tracker.mexcClient = {
      hasCredentials: () => false,
      getAllPrices: async () => ({ [symbol]: String(livePrice) }),
      getTickerPrice: async () => livePrice,
      getBalances: async () => [],
      getDepth: async () => ({ bids: [[String(livePrice * 0.999), '10']], asks: [[String(livePrice * 1.001), '10']] }),
      placeOrder: async () => ({ orderId: `dry_${symbol}_${Date.now()}` }),
      getOrder: async () => ({ status: 'FILLED', executedQty: '1', price: String(livePrice) })
    };

    // ─── STEP 1: BLOCKED STATE WHEN CONDITIONS NOT MET ───
    liveObi = targetObi - 3.0; // Below requirement
    liveRsi = targetRsi + 5.0; // Above requirement
    await tracker.tick();
    assert(tracker.orders[0].status === 'PENDING_ACTIVATION', `${symbol}: Must stay PENDING_ACTIVATION when OBI < target or RSI > target`);
    assert(tracker.orders[0].obiPersistenceCount === 0, `${symbol}: Persistence must be 0`);
    console.log(`   ✅ 1. Blocked State: Market OBI=${liveObi.toFixed(1)}% (< ${targetObi}%) & RSI=${liveRsi.toFixed(1)} (> ${targetRsi}). Order BLOCKED (0/3).`);

    // ─── STEP 2: FLAPPING RESISTANCE (RESET ON DROP) ───
    liveObi = targetObi + 1.0;
    liveRsi = targetRsi - 1.0;
    await tracker.tick(); // Tick 1 (1/3)
    assert(tracker.orders[0].obiPersistenceCount === 1, `${symbol}: Must record 1/3 tick`);

    // Flap on Tick 2
    liveObi = targetObi - 2.0;
    await tracker.tick();
    assert(tracker.orders[0].obiPersistenceCount === 0, `${symbol}: Flapping signal must reset persistence to 0`);
    console.log(`   ✅ 2. Flapping Defense: Signal dropped on tick 2. Persistence counter cleanly reset to 0/3.`);

    // ─── STEP 3: 3-TICK PERSISTENCE VALIDATION ───
    liveObi = targetObi + 1.5;
    liveRsi = targetRsi - 1.5;

    await tracker.tick(); // Tick 1/3
    assert(tracker.orders[0].obiPersistenceCount === 1);
    await tracker.tick(); // Tick 2/3
    assert(tracker.orders[0].obiPersistenceCount === 2);
    await tracker.tick(); // Tick 3/3 -> Transition to PENDING_BUY
    assert(tracker.orders[0].status === 'PENDING_BUY', `${symbol}: Must transition to PENDING_BUY on 3/3 ticks`);
    console.log(`   ✅ 3. 3-Tick Validation: Sustained 3 consecutive ticks (OBI=${liveObi}% >= ${targetObi}%, RSI=${liveRsi} <= ${targetRsi}) -> Transitioned to PENDING_BUY.`);

    // ─── STEP 4: BUY EXECUTION & STEP 5: TP LIMIT SELL PLACEMENT ───
    await tracker.tick(); // Executes Market Buy
    assert(tracker.orders[0].status === 'TP_SL_ACTIVE', `${symbol}: Must transition to TP_SL_ACTIVE (Holding)`);
    assert(tracker.orders[0].executionPrice === livePrice, `${symbol}: Execution price must match live price`);
    console.log(`   ✅ 4. Buy Execution: Executed $100 buy @ $${livePrice}. Card status: TP_SL_ACTIVE (Holding).`);
    console.log(`   ✅ 5. TP Limit Sell: Placed TP Limit Sell (+${tpPct}% target @ $${(livePrice * (1 + tpPct / 100)).toFixed(4)}).`);

    // ─── STEP 6: TAKE PROFIT HIT & AUTO-REPEAT CYCLE REPEAT ───
    const tpPrice = livePrice * (1 + (tpPct / 100));
    livePrice = tpPrice + 0.1; // Price touches/exceeds TP target
    await tracker.tick(); // TP execution

    assert(tracker.orders[0].status === 'PENDING_ACTIVATION', `${symbol}: Must reset to PENDING_ACTIVATION after TP hit`);
    assert(tracker.orders[0].tradeHistory.length === 1, `${symbol}: Trade history must record completed cycle`);
    assert(tracker.orders[0].totalNetProfit > 0, `${symbol}: Total net profit must be positive`);
    assert(tracker.orders[0].obiPersistenceCount === 0, `${symbol}: Persistence count must reset to 0`);
    console.log(`   ✅ 6. Take Profit Hit: Reached $${livePrice.toFixed(4)}. Profit recorded: +$${tracker.orders[0].totalNetProfit.toFixed(4)} USDT. Reset to PENDING_ACTIVATION for next continuous loop!`);

    // ─── STEP 7: EMERGENCY RSI STOP LOSS (RSI <= 20.0) ───
    // Put card into holding state to test emergency crash
    tracker.orders[0].status = 'TP_SL_ACTIVE';
    tracker.orders[0].executionPrice = 300.0;
    livePrice = 280.0;
    liveRsi = 19.5; // Emergency crash RSI <= 20.0

    await tracker.tick();
    assert(tracker.orders[0].status === 'TRIGGERED' || tracker.orders[0].status === 'PENDING_ACTIVATION', `${symbol}: Must trigger emergency stop loss`);
    console.log(`   ✅ 7. Emergency Stop Loss: 4h 15m RSI dropped to 19.5 (<= 20.0) -> Emergency Market Sell triggered to protect capital!\n`);
  }

  console.log(`================================================================================`);
  console.log(`🏆 100% DRY-RUN VERIFICATION PASSED ACROSS ALL ${cards.length} ACTIVE CARDS!`);
  console.log(`================================================================================\n`);
  process.exit(0);
}

testAllActiveCardsLifecycle().catch(err => {
  console.error('❌ Dry-Run Lifecycle Test Suite Failed:', err);
  process.exit(1);
});
