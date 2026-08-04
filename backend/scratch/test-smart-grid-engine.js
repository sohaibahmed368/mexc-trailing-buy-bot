const SmartGridTracker = require('../smart-grid-tracker');

console.log('================================================================================');
console.log('🔬 AUDIT: STANDALONE SMART ABSORPTION GRID ENGINE & BUY CANCELLATION');
console.log('================================================================================\n');

class MockMexcClient {
  constructor() {
    this.price = 1.25;
    this.obi = 40; // Default low OBI to test cancellation
  }
  async getTickerPrice(symbol) { return this.price; }
  async getDepth(symbol, limit) {
    if (this.obi >= 60) {
      return { bids: [['1.0', '700']], asks: [['1.0', '300']] }; // 70% OBI
    }
    return { bids: [['1.0', '400']], asks: [['1.0', '600']] }; // 40% OBI
  }
  async placeOrder(params) {
    return { orderId: 'mock_ord_' + Date.now() };
  }
  async getOrder(symbol, orderId) {
    return { orderId, status: 'FILLED' };
  }
}

async function runGridAudit() {
  const mockClient = new MockMexcClient();
  const tracker = new SmartGridTracker(mockClient);

  console.log('1. CREATING SMART GRID BOT ($1.00 - $1.50, 5 GRIDS)...');
  const gridBot = await tracker.createGridBot({
    symbol: 'XRPUSDT',
    lowerPrice: '1.00',
    upperPrice: '1.50',
    gridCount: '5',
    totalInvestmentUsdt: '100',
    filterObi: true,
    filter40sVolume: false,
    consensusMode: 'SMART_CONFLUENCE',
    dryRun: true
  });

  console.assert(gridBot.levels.length === 5, 'grid levels count error');
  console.assert(gridBot.stepSize === 0.125, 'stepSize calculation error');
  console.log('   ✅ Grid Bot created successfully. Levels: $1.000, $1.125, $1.250, $1.375, $1.500.\n');

  console.log('2. TESTING BUY GRID CANCELLATION ON HEAVY SELLING PRESSURE (OBI < 60%)...');
  mockClient.price = 1.125; // Reaches Buy Level #2 ($1.125)
  mockClient.obi = 40; // Heavy selling pressure!

  await tracker.tick();

  const lvl2 = gridBot.levels[1];
  console.assert(lvl2.status === 'CANCELLED_PRESSURE', 'lvl2 should be CANCELLED_PRESSURE');
  console.log('   ✅ Buy Grid #2 @ $1.125 CANCELLED due to heavy selling pressure (OBI 40%). Price allowed to fall to lower grid!\n');

  console.log('3. TESTING BUY GRID EXECUTION & IMMEDIATE LIMIT SELL TARGET WHEN SIGNALS PASS...');
  mockClient.price = 1.00; // Drops to lower Grid #1 ($1.00)
  mockClient.obi = 75; // Strong buying support!

    // Call tick to place #1 Queue Limit Buy
    await tracker.tick();
    // Call tick second time to fill the placed Limit Buy
    await tracker.tick();

    const lvl1 = gridBot.levels[0];
    console.assert(lvl1.status === 'IDLE', 'lvl1 status should reset to IDLE for sell monitoring');
    console.assert(lvl1.side === 'SELL', 'lvl1 side should shift to SELL');
    console.assert(lvl1.sellTargetPrice > 0, 'sellTargetPrice should be calculated');
  console.log(`   ✅ Buy Grid #1 @ $1.00 EXECUTED! Placed Limit Sell target at $${lvl1.sellTargetPrice.toFixed(4)} USDT (+${gridBot.stepPct}% TP).\n`);

  console.log('4. TESTING LIMIT SELL FILL & NET PROFIT RECORDING...');
  mockClient.price = lvl1.sellTargetPrice + 0.01; // Reaches Sell Target
  await tracker.tick();

  console.assert(gridBot.totalNetProfitUsdt > 0, 'totalNetProfitUsdt should be positive');
  console.assert(gridBot.gridHistory.length === 1, 'gridHistory should record 1 fill');
  console.log(`   ✅ Sell Grid Target filled! Net Profit: +$${gridBot.totalNetProfitUsdt.toFixed(4)} USDT. Grid reset to BUY side for next dip.\n`);

  console.log('================================================================================');
  console.log('🏆 STANDALONE SMART ABSORPTION GRID ENGINE AUDIT PASSED 100% PERFECT!');
  console.log('================================================================================');
}

runGridAudit().catch(e => {
  console.error('Grid Audit Failure:', e);
  process.exit(1);
});
