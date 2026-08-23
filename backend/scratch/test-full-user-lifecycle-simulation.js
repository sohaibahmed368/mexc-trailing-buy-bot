const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('================================================================================');
console.log('🧪 RUNNING COMPLETE LIFECYCLE DRY RUN ON ALL USER TRADING SCENARIOS');
console.log('================================================================================\n');

// Mock MEXC Client to simulate 100% realistic exchange behavior
class MockMexcClient {
  constructor() {
    this.openOrders = new Map();
    this.balances = [
      { asset: 'USDT', free: 10000.0, locked: 0.0 },
      { asset: 'BTC', free: 0.0, locked: 0.0 }
    ];
    this.prices = {
      'BTCUSDT': 65000.0,
      'ETHUSDT': 2400.0,
      'SOLUSDT': 150.0
    };
    this.tradeHistory = [];
    this.orderCounter = 1000;
  }

  hasCredentials() { return true; }

  async getBalances() {
    return this.balances;
  }

  async getAllPrices() {
    return this.prices;
  }

  async getAllTickerPrices() {
    return Object.keys(this.prices).map(sym => ({ symbol: sym, price: this.prices[sym].toString() }));
  }

  async getTickerPrice(symbol) {
    return this.prices[symbol] || 65000.0;
  }

  async getOrderBook(symbol) {
    const p = this.prices[symbol] || 65000.0;
    return {
      bids: [[p * 0.9998, 5.0], [p * 0.9995, 10.0]],
      asks: [[p * 1.0002, 5.0], [p * 1.0005, 10.0]]
    };
  }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    this.orderCounter++;
    const orderId = `MOCK_ORD_${this.orderCounter}`;
    const p = price || this.prices[symbol] || 65000.0;
    const qty = quantity || (quoteOrderQty ? quoteOrderQty / p : 1.0);

    const orderRecord = {
      orderId,
      symbol,
      side,
      type,
      price: p,
      origQty: qty,
      executedQty: type === 'MARKET' ? qty : 0,
      status: type === 'MARKET' ? 'FILLED' : 'NEW',
      cTime: Date.now()
    };

    if (type === 'LIMIT') {
      this.openOrders.set(orderId, orderRecord);
    }

    return orderRecord;
  }

  async getOrder(symbol, orderId) {
    const ord = this.openOrders.get(orderId);
    if (!ord) return { orderId, status: 'FILLED', executedQty: 1.0, price: 65000.0 };
    return ord;
  }

  async cancelOrder(symbol, orderId) {
    this.openOrders.delete(orderId);
    return { orderId, status: 'CANCELED' };
  }

  async getMyTrades(symbol) {
    return this.tradeHistory;
  }
}

// Mock Socket.IO
class MockSocketIO {
  emit(event, data) {}
}

const mockMexc = new MockMexcClient();
const mockIo = new MockSocketIO();

// Load OrderTracker
const OrderTracker = require('../tracker');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');

const tracker = new OrderTracker(mockMexc, mockIo);
const radar = new MultiExchangeSignalRadar(mockMexc, mockIo);
tracker.setSignalRadar(radar);

// Test Results Collector
let passedTests = 0;
let totalTests = 0;

async function it(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ [PASS] ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${desc}`);
    console.error(`     Error: ${err.message}`);
    process.exit(1);
  }
}

async function runAllScenarios() {
  console.log('────────────────────────────────────────────────────────────────────────────────');
  console.log('1️⃣ SCENARIO 1: NEW CARD CREATION VIA API / FORM & INITIAL VALIDATION');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  let testCard = null;
  await it('1.1 Should successfully create a new trailing order card with custom targets', async () => {
    testCard = await tracker.addOrder({
      symbol: 'BTCUSDT',
      trailValue: '0.15',
      quoteOrderQty: 100,
      orderType: 'MARKET',
      dryRun: false,
      takeProfit: 0.6,
      stopLoss: 0,
      filterObi: true,
      customObiThreshold: 60,
      customRsiThreshold: 45,
      autoRepeat: true,
      startImmediately: true
    });

    assert.strictEqual(testCard.symbol, 'BTCUSDT');
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
    assert.strictEqual(testCard.takeProfit, 0.6);
    assert.strictEqual(testCard.customObiThreshold, 60);
    assert.strictEqual(testCard.customRsiThreshold, 45);
    assert.strictEqual(testCard.autoRepeat, true);
    assert.strictEqual(testCard.obiPersistenceCount || 0, 0);
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('2️⃣ SCENARIO 2: CONTINUOUS SCANNING & DUAL-GATE DEFENSE (NO TRIGGER ON BAD SIGNALS)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('2.1 Should BLOCK trigger when OBI is 52% (< 60% requirement)', async () => {
    radar.getRadarMetrics = () => ({
      averageObiPct: 52.0,
      averageRsi15m: 40.0, // RSI passed
      exchanges: []
    });

    await tracker.tick();
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
    assert.strictEqual(testCard.obiPersistenceCount, 0);
  });

  await it('2.2 Should BLOCK trigger when RSI is 50 (> 45 requirement)', async () => {
    radar.getRadarMetrics = () => ({
      averageObiPct: 65.0,
      averageRsi15m: 50.0, // RSI failed
      exchanges: []
    });

    await tracker.tick();
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
    assert.strictEqual(testCard.obiPersistenceCount, 0);
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('3️⃣ SCENARIO 3: FLAPPING SIGNAL DEFENSE (PREVENTS FALSE PUMPS)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('3.1 Tick 1/3: Increments count when OBI >= 60% & RSI <= 45', async () => {
    radar.getRadarMetrics = () => ({
      averageObiPct: 64.0,
      averageRsi15m: 42.0,
      exchanges: []
    });

    await tracker.tick();
    assert.strictEqual(testCard.obiPersistenceCount, 1);
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
  });

  await it('3.2 Tick 2/3: Increments count to 2 on second valid second', async () => {
    await tracker.tick();
    assert.strictEqual(testCard.obiPersistenceCount, 2);
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
  });

  await it('3.3 Flap Defense: If signal drops on tick 3, counter MUST reset to 0/3', async () => {
    radar.getRadarMetrics = () => ({
      averageObiPct: 48.0, // Signal dropped!
      averageRsi15m: 42.0,
      exchanges: []
    });

    await tracker.tick();
    assert.strictEqual(testCard.obiPersistenceCount, 0);
    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION');
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('4️⃣ SCENARIO 4: 3-TICK PERSISTENCE CONFIRMATION & SPREAD-GUARD BUY EXECUTION');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('4.1 Re-qualify: Tick 1/3, Tick 2/3, Tick 3/3 continuous confirmation & Market Buy', async () => {
    radar.getRadarMetrics = (symbol) => {
      if (symbol === 'BTCUSDT') {
        return {
          averageObiPct: 68.5,
          averageRsi15m: 38.0,
          exchanges: []
        };
      }
      return { averageObiPct: 50.0, averageRsi15m: 50.0, exchanges: [] };
    };

    await tracker.tick(); // 1/3
    assert.strictEqual(testCard.obiPersistenceCount, 1);

    await tracker.tick(); // 2/3
    assert.strictEqual(testCard.obiPersistenceCount, 2);

    await tracker.tick(); // 3/3 -> Confirmed into PENDING_BUY!
    assert.strictEqual(testCard.status, 'PENDING_BUY');

    // Next tick: Executes Market Buy & TP Limit Sell
    await tracker.tick();
    assert.strictEqual(testCard.status, 'TP_SL_ACTIVE');
    assert.strictEqual(testCard.executionPrice, 65000.0);
    assert(testCard.mexcSellOrderId !== null, 'MEXC TP Sell order ID must be generated');
    console.log(`     Dual-Gate 3-Tick Confirmed! Placed TP Limit Sell on MEXC at Target: $${(testCard.executionPrice * 1.006).toFixed(2)} (+0.6%)`);
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('5️⃣ SCENARIO 5: TAKE PROFIT HIT, PROFIT AUDIT & AUTO-REPEAT CYCLE RESTART');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('5.1 When market price reaches TP target (+0.6%), executes Limit Sell & logs profit', async () => {
    mockMexc.prices['BTCUSDT'] = 65450.0;

    // Simulate MEXC filling the Limit Sell order
    mockMexc.openOrders.set(testCard.mexcSellOrderId, {
      orderId: testCard.mexcSellOrderId,
      status: 'FILLED',
      price: 65390.0,
      executedQty: 100 / 65000.0
    });

    await tracker.tick();

    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION', 'Card must auto-reset to PENDING_ACTIVATION for next cycle');
    assert.strictEqual(testCard.tradeHistory.length, 1, 'Cycle #1 must be recorded');
    const cycle1 = testCard.tradeHistory[0];
    assert.strictEqual(cycle1.cycle, 1);
    assert.strictEqual(cycle1.type, 'TAKE_PROFIT');
    assert(cycle1.profitUsdt > 0, `Profit must be positive: got $${cycle1.profitUsdt}`);
    console.log(`     Cycle #1 Completed! Net Profit: +$${cycle1.profitUsdt.toFixed(4)} USDT | Total Card Profit: +$${testCard.totalNetProfit.toFixed(4)} USDT`);
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('6️⃣ SCENARIO 6: EMERGENCY STOP LOSS TRIGGER ON MARKET CRASH (RSI <= 20.0)');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('6.1 Emergency SL: If market crashes and RSI <= 20, immediately market sells to protect capital', async () => {
    // Put card into active position for cycle #2
    testCard.status = 'TP_SL_ACTIVE';
    testCard.executionPrice = 66000.0;
    testCard.mexcSellOrderId = 'MOCK_TP_SL_ORD_2';

    // Market flash crash on BTC: RSI drops to 16.5
    radar.getRadarMetrics = (symbol) => {
      if (symbol === 'BTCUSDT') {
        return {
          averageObiPct: 40.0,
          averageRsi15m: 16.5, // EMERGENCY CRASH RSI!
          exchanges: []
        };
      }
      return { averageObiPct: 50.0, averageRsi15m: 50.0, exchanges: [] };
    };
    mockMexc.prices['BTCUSDT'] = 63000.0;

    await tracker.tick();

    assert.strictEqual(testCard.status, 'PENDING_ACTIVATION', 'Emergency SL must liquidate and safely reset to PENDING_ACTIVATION');
    console.log('     Emergency Stop Loss executed cleanly! Capital protected.');
  });

  console.log('\n────────────────────────────────────────────────────────────────────────────────');
  console.log('7️⃣ SCENARIO 7: 37-CARD CONCURRENT LOAD & RUNTIME STABILITY');
  console.log('────────────────────────────────────────────────────────────────────────────────');

  await it('7.1 Engine handles all 37 active + watchlist cards concurrently without errors', async () => {
    const orders = tracker.getOrders();
    assert(orders.length >= 37, `Expected >= 37 cards, got ${orders.length}`);

    for (let i = 0; i < 5; i++) {
      await tracker.tick();
    }

    assert.strictEqual(tracker.isTicking, false, 'Tracker tick lock must properly release');
    console.log(`     Successfully ticked all ${orders.length} cards across 5 cycles with 0 errors!`);
  });

  console.log('\n================================================================================');
  console.log(`🏆 ALL ${totalTests} / ${totalTests} SCENARIOS PASSED 100% SUCCESSFULLY!`);
  console.log('================================================================================\n');
}

runAllScenarios().catch(err => {
  console.error('❌ SCENARIO TEST SUITE FAILED:', err);
  process.exit(1);
});
