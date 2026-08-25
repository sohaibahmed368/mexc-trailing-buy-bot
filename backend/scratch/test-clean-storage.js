const assert = require('assert');
const OrderTracker = require('../tracker');

async function testCleanStorage() {
  console.log('🧪 Testing Clean Storage Initialization...');
  const tracker = new OrderTracker();
  
  console.log(`📦 Loaded ${tracker.orders.length} cards in tracker:`);
  tracker.orders.forEach((o, i) => {
    console.log(`   ${i + 1}. ${o.symbol} | Status: ${o.status} | Auto-Repeat: ${o.autoRepeat}`);
  });

  assert(tracker.orders.length === 19, `Expected exactly 19 cards, got ${tracker.orders.length}`);
  
  // Verify unwanted coins like BTC, DOGE, BNB, LINK are NOT in the active tracker
  const symbols = tracker.orders.map(o => o.symbol);
  assert(!symbols.includes('BTCUSDT'), 'BTCUSDT should NOT be in active orders');
  assert(!symbols.includes('DOGEUSDT'), 'DOGEUSDT should NOT be in active orders');
  assert(!symbols.includes('BNBUSDT'), 'BNBUSDT should NOT be in active orders');
  assert(!symbols.includes('LINKUSDT'), 'LINKUSDT should NOT be in active orders');

  // Verify temporary holding coins have autoRepeat === false
  ['RENDERUSDT', 'OPUSDT', 'ARBUSDT', 'SHIBUSDT', 'APTUSDT', 'NEARUSDT', 'AVAXUSDT', 'SOLUSDT', 'SUIUSDT', 'TAOUSDT'].forEach(sym => {
    const card = tracker.orders.find(o => o.symbol === sym);
    if (card) {
      assert(card.autoRepeat === false, `${sym} must have autoRepeat === false!`);
    }
  });

  console.log('\n🏆 ALL CLEAN STORAGE INTEGRITY CHECKS PASSED!');
  process.exit(0);
}

testCleanStorage().catch(err => {
  console.error('❌ Test Failed:', err);
  process.exit(1);
});
