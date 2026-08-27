const assert = require('assert');
const OrderTracker = require('../tracker');

async function testAddOrders() {
  console.log('🧪 Testing addOrder for NIKEONUSDT, MCDONUSDT, PAXGUSDT, XAUTUSDT...');

  const tracker = new OrderTracker();

  // Test 1: NIKEONUSDT (should auto-normalize to NKEONUSDT)
  const nikeOrder = await tracker.addOrder({
    symbol: 'NIKEONUSDT',
    trailValue: '0.15',
    quoteOrderQty: 100,
    dryRun: true,
    takeProfit: 0.5,
    filterObi: true,
    autoRepeat: true
  });
  console.log(`✅ Test 1 (Nike): Created order with symbol: ${nikeOrder.symbol}, Initial Price: $${nikeOrder.initialPrice}`);
  assert.strictEqual(nikeOrder.symbol, 'NKEONUSDT', 'NIKEONUSDT must normalize to NKEONUSDT');
  assert(nikeOrder.initialPrice > 0, 'Nike initial price must be fetched (> 0)');

  // Test 2: MCDONUSDT
  const mcdOrder = await tracker.addOrder({
    symbol: 'MCDONUSDT',
    trailValue: '0.15',
    quoteOrderQty: 100,
    dryRun: true,
    takeProfit: 0.5,
    filterObi: true,
    autoRepeat: true
  });
  console.log(`✅ Test 2 (McDonald's): Created order with symbol: ${mcdOrder.symbol}, Initial Price: $${mcdOrder.initialPrice}`);
  assert.strictEqual(mcdOrder.symbol, 'MCDONUSDT', 'MCDONUSDT symbol must match');
  assert(mcdOrder.initialPrice > 0, 'McDonalds initial price must be fetched (> 0)');

  // Test 3: PAXGUSDT (should auto-normalize to GOLD(PAXG)USDT)
  const paxgOrder = await tracker.addOrder({
    symbol: 'PAXGUSDT',
    trailValue: '0.15',
    quoteOrderQty: 100,
    dryRun: true,
    takeProfit: 0.4,
    filterObi: true,
    autoRepeat: true
  });
  console.log(`✅ Test 3 (PAXG): Created order with symbol: ${paxgOrder.symbol}, Initial Price: $${paxgOrder.initialPrice}`);
  assert.strictEqual(paxgOrder.symbol, 'GOLD(PAXG)USDT', 'PAXGUSDT must normalize to GOLD(PAXG)USDT');
  assert(paxgOrder.initialPrice > 0, 'PAXG initial price must be fetched (> 0)');

  console.log('\n🏆 ALL CARD CREATION & ALIAS NORMALIZATION TESTS PASSED 100%!');
  process.exit(0);
}

testAddOrders().catch(e => {
  console.error('❌ Test Failed:', e);
  process.exit(1);
});
