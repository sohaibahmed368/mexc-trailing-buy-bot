/**
 * COMPREHENSIVE LIVE DRY RUN SCENARIO TEST SUITE
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests all active/configured cards for all required user scenarios:
 *   Scenario A: OBI below custom threshold -> BLOCKED (PENDING_ACTIVATION)
 *   Scenario B: RSI above custom threshold -> BLOCKED (PENDING_ACTIVATION)
 *   Scenario C: Both OBI & RSI conditions met -> IMMEDIATE BUY EXECUTION
 *   Scenario D: Price hits 100% Take Profit target (Exact Buy + TP%) -> TP SELL, Cycle Reset
 *   Scenario E: Market drops & RSI <= 20.0 -> EMERGENCY MARKET SELL, Cycle Reset
 */

const fs   = require('fs');
const path = require('path');
const MexcTracker = require('../tracker');

// Mock MEXC Client supporting dynamic price overrides for testing
class MockMexcClient {
  constructor() {
    this.prices = { ETHUSDT: 2950, BTCUSDT: 65000, XAUTUSDT: 2400, EURUSDT: 1.085, SOLUSDT: 165 };
    this.balances = [
      { asset: 'USDT', free: '100000.0', locked: '0.0' },
      { asset: 'ETH',  free: '0.0', locked: '0.0' },
      { asset: 'BTC',  free: '0.0', locked: '0.0' },
      { asset: 'XAUT', free: '0.0', locked: '0.0' },
      { asset: 'EUR',  free: '0.0', locked: '0.0' },
      { asset: 'SOL',  free: '0.0', locked: '0.0' }
    ];
    this.ordersPlaced = [];
    this.nextId = 1001;
    this.tpFilled = {};
  }

  hasCredentials()    { return true; }
  async getBalances() { return this.balances; }
  async getTickerPrice(symbol) {
    return this.prices[symbol] || 100;
  }
  async getAllTickerPrices() {
    return Object.keys(this.prices).map(sym => ({
      symbol: sym,
      price: this.prices[sym].toString()
    }));
  }
  async getAllPrices() { return this.getAllTickerPrices(); }
  async getKlines() {
    return Array.from({ length: 25 }, (_, i) => [
      Date.now() - (25 - i) * 15 * 60 * 1000,
      '2950', '2960', '2940', '2950', '1000', Date.now(), '2950000', 10, '500', '0'
    ]);
  }
  async getDepth() { return { bids: [['2948', '10']], asks: [['2952', '10']] }; }
  async getRecentTrades() { return [{ price: '2950', qty: '1', isBuyerMaker: false, time: Date.now() }]; }

  async placeOrder(params) {
    const id = `mock_ord_${this.nextId++}`;
    const isMarket = params.type === 'MARKET' || !!params.quoteOrderQty;
    const status = isMarket ? 'FILLED' : 'NEW';
    const base = (params.symbol || 'ETHUSDT').replace('USDT', '');
    const price = parseFloat(params.price) || (this.prices[params.symbol] || 2950);
    const qty = params.quantity || (params.quoteOrderQty / price);

    if (params.side === 'BUY') {
      const b = this.balances.find(b => b.asset === base);
      if (b) b.free = qty.toFixed(6);
    } else if (params.side === 'SELL' && isMarket) {
      const b = this.balances.find(b => b.asset === base);
      if (b) b.free = '0.0';
    }

    const o = { orderId: id, status, executedQty: qty.toString(), cummulativeQuoteQty: (qty * price).toString(), ...params };
    this.ordersPlaced.push(o);
    return o;
  }

  async getOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (!o) return { orderId, status: 'NEW', executedQty: '0', price: '0' };
    if (o.side === 'SELL' && !this.tpFilled[symbol]) return { ...o, status: 'NEW' };
    if (o.side === 'SELL' && this.tpFilled[symbol]) {
      const b = this.balances.find(b => b.asset === symbol.replace('USDT', ''));
      if (b) b.free = '0.0';
      return { ...o, status: 'FILLED' };
    }
    return { ...o };
  }

  async getOpenOrders(symbol) {
    if (this.tpFilled[symbol]) return [];
    return this.ordersPlaced.filter(o => o.symbol === symbol && o.status === 'NEW');
  }
  async cancelOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (o) o.status = 'CANCELED';
    return { success: true };
  }
  async getMyTrades() { return []; }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const NEUTRAL = { averageObiPct: 30.0, averageRsi15m: 60.0, exchanges: [] };

async function runScenarioTestForCard(cardConfig, cardIndex, totalCards) {
  const sym = cardConfig.symbol;
  const customObi = cardConfig.customObiThreshold !== undefined ? parseFloat(cardConfig.customObiThreshold) : 60.0;
  const customRsi = cardConfig.customRsiThreshold !== undefined ? parseFloat(cardConfig.customRsiThreshold) : 45.0;
  const tpPct = cardConfig.takeProfit !== undefined ? parseFloat(cardConfig.takeProfit) : 0.6;
  const initialPrice = { ETHUSDT: 2950, BTCUSDT: 65000, XAUTUSDT: 2400, EURUSDT: 1.085, SOLUSDT: 165 }[sym] || 100;

  console.log(`\n────────────────────────────────────────────────────────────────────────────────`);
  console.log(`▶️  TESTING CARD [${cardIndex}/${totalCards}] — ${sym} (Dry Run Mode)`);
  console.log(`   Config: OBI Checkbox ✅ | Custom OBI ≥ ${customObi}% | Custom RSI ≤ ${customRsi} | TP +${tpPct}% | Initial Price: $${initialPrice}`);
  console.log(`────────────────────────────────────────────────────────────────────────────────`);

  const client = new MockMexcClient();
  client.prices[sym] = initialPrice;

  const tmpOrdersFile = path.join(__dirname, `tmp-test-${sym}-orders.json`);
  const tmpLogsFile   = path.join(__dirname, `tmp-test-${sym}-logs.json`);
  for (const f of [tmpOrdersFile, tmpLogsFile]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  const tracker = new MexcTracker(client, null);
  tracker.ordersPath = tmpOrdersFile;
  tracker.logsPath   = tmpLogsFile;
  tracker.orders     = [];
  tracker.placeOrderDelayMs = 50;

  let currentRadar = NEUTRAL;
  tracker.signalRadar = {
    getRadarMetrics: () => currentRadar,
    getMultiExchangeMetrics: async () => currentRadar
  };

  // Add order to tracker
  const createdOrder = await tracker.addOrder({
    symbol: sym,
    quoteOrderQty: cardConfig.quoteOrderQty || 100,
    takeProfit: tpPct,
    stopLoss: cardConfig.stopLoss || 1.5,
    filterObi: true,
    targetObi: customObi,
    targetRsi: customRsi,
    customObiThreshold: customObi,
    customRsiThreshold: customRsi,
    autoRepeat: true,
    dryRun: true // DRY RUN TEST
  });

  if (tracker.intervalId) {
    clearInterval(tracker.intervalId);
    tracker.intervalId = null;
  }

  let passedSteps = 0;
  const requiredSteps = 5;

  // ── STEP 1: Invalid OBI (below threshold) -> BLOCKED ─────────────────────
  const obiLow = customObi - 3.0;
  const rsiOk  = customRsi - 5.0;
  currentRadar = { averageObiPct: obiLow, averageRsi15m: rsiOk, exchanges: [{ name: 'Binance', obiPct: obiLow }] };
  client.prices[sym] = initialPrice;
  await tracker.tick();
  let cardState = tracker.getOrders()[0];

  if (cardState.status === 'PENDING_ACTIVATION') {
    console.log(`   ✅ STEP 1 PASSED: OBI ${obiLow}% < ${customObi}% → Blocked! Status: ${cardState.status}`);
    passedSteps++;
  } else {
    console.error(`   ❌ STEP 1 FAILED: Expected PENDING_ACTIVATION but got ${cardState.status}`);
  }

  // ── STEP 2: Invalid RSI (above threshold) -> BLOCKED ─────────────────────
  const obiOk   = customObi + 3.0;
  const rsiHigh = customRsi + 5.0;
  currentRadar = { averageObiPct: obiOk, averageRsi15m: rsiHigh, exchanges: [{ name: 'Binance', obiPct: obiOk }] };
  client.prices[sym] = initialPrice;
  await tracker.tick();
  cardState = tracker.getOrders()[0];

  if (cardState.status === 'PENDING_ACTIVATION') {
    console.log(`   ✅ STEP 2 PASSED: RSI ${rsiHigh} > ${customRsi} → Blocked! Status: ${cardState.status}`);
    passedSteps++;
  } else {
    console.error(`   ❌ STEP 2 FAILED: Expected PENDING_ACTIVATION but got ${cardState.status}`);
  }

  // ── STEP 3: Both Conditions Valid (OBI >= customObi AND RSI <= customRsi) -> ENTRY ──
  currentRadar = { averageObiPct: obiOk, averageRsi15m: rsiOk, exchanges: [{ name: 'Binance', obiPct: obiOk }] };
  client.prices[sym] = initialPrice;
  await tracker.tick(); // Tick 1 (persistence 1/3)
  await tracker.tick(); // Tick 2 (persistence 2/3)
  await tracker.tick(); // Tick 3 (persistence 3/3 -> PENDING_BUY)
  await tracker.tick(); // Tick 4 (executes Dry Run Buy -> TP_SL_ACTIVE)
  
  cardState = tracker.getOrders()[0];
  currentRadar = NEUTRAL;

  if (cardState.status === 'TP_SL_ACTIVE') {
    const execP = cardState.executionPrice || initialPrice;
    console.log(`   ✅ STEP 3 PASSED: OBI ${obiOk}% >= ${customObi}% & RSI ${rsiOk} <= ${customRsi} → ENTRY CONFIRMED! Status: ${cardState.status} | Exec Price: $${execP}`);
    passedSteps++;
  } else {
    console.error(`   ❌ STEP 3 FAILED: Expected TP_SL_ACTIVE but got ${cardState.status}`);
  }

  // ── STEP 4: 100% Take Profit Hit -> Market/Limit Sell & Reset ──────────────
  currentRadar = NEUTRAL; // Keep radar neutral so card doesn't re-trigger buy immediately
  const buyPrice = cardState.executionPrice || initialPrice;
  const tpTargetPrice = buyPrice * (1 + (tpPct / 100)) + 0.01;
  
  // Update mock client price to TP target price + offset
  client.prices[sym] = tpTargetPrice;
  await tracker.tick(); // Checks TP, executes 100% TP sell, resets to PENDING_ACTIVATION
  
  cardState = tracker.getOrders()[0];
  const cyclesCompleted = Array.isArray(cardState.tradeHistory) ? cardState.tradeHistory.length : 0;

  if (cardState.status === 'PENDING_ACTIVATION' && cyclesCompleted >= 1) {
    console.log(`   ✅ STEP 4 PASSED: Price reached TP Target $${tpTargetPrice.toFixed(4)} (+${tpPct}%) → 100% TP Executed & Card Reset! Status: ${cardState.status} | Cycles: ${cyclesCompleted}`);
    passedSteps++;
  } else {
    console.error(`   ❌ STEP 4 FAILED: Expected reset to PENDING_ACTIVATION with cycle >= 1 but got status ${cardState.status}, cycles ${cyclesCompleted}`);
  }

  // ── STEP 5: Re-entry and Emergency RSI <= 20 Stop Loss Test ────────────────
  currentRadar = { averageObiPct: obiOk, averageRsi15m: rsiOk, exchanges: [{ name: 'Binance', obiPct: obiOk }] };
  client.prices[sym] = initialPrice;
  await tracker.tick(); // Tick 1 (persistence 1/3)
  await tracker.tick(); // Tick 2 (persistence 2/3)
  await tracker.tick(); // Tick 3 (persistence 3/3 -> PENDING_BUY)
  await tracker.tick(); // Tick 4 (executes Dry Run Buy -> TP_SL_ACTIVE)

  cardState = tracker.getOrders()[0];
  console.log(`   ✓ Re-entered Card → Status: ${cardState.status}`);

  // Crash RSI to 18.0 (<= 20.0)
  currentRadar = { averageObiPct: 35.0, averageRsi15m: 18.0, exchanges: [{ name: 'Binance', obiPct: 35.0 }] };
  client.prices[sym] = initialPrice * 0.98;
  await tracker.tick(); // Triggers RSI Emergency Crash SL, resets to PENDING_ACTIVATION

  currentRadar = NEUTRAL;
  cardState = tracker.getOrders()[0];
  const finalCycles = Array.isArray(cardState.tradeHistory) ? cardState.tradeHistory.length : 0;

  if (cardState.status === 'PENDING_ACTIVATION' && finalCycles >= 2) {
    console.log(`   ✅ STEP 5 PASSED: RSI 18.0 (<= 20.0) Emergency SL Triggered → Market Sell Executed & Reset! Status: ${cardState.status} | Total Cycles: ${finalCycles}`);
    passedSteps++;
  } else {
    console.error(`   ❌ STEP 5 FAILED: Expected PENDING_ACTIVATION after RSI emergency SL but got ${cardState.status}, cycles ${finalCycles}`);
  }

  // Cleanup
  for (const f of [tmpOrdersFile, tmpLogsFile]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  return passedSteps === requiredSteps;
}

async function main() {
  console.log('================================================================================');
  console.log('🔬 LIVE DRY RUN SCENARIO VERIFICATION SUITE');
  console.log('   Testing all active tracking cards & custom configurations end-to-end');
  console.log('================================================================================');

  const cardsToTest = [
    { symbol: 'ETHUSDT', customObiThreshold: 62.5, customRsiThreshold: 38, takeProfit: 0.60, quoteOrderQty: 100 },
    { symbol: 'BTCUSDT', customObiThreshold: 60.0, customRsiThreshold: 45, takeProfit: 0.60, quoteOrderQty: 100 },
    { symbol: 'XAUTUSDT', customObiThreshold: 55.0, customRsiThreshold: 40, takeProfit: 0.40, quoteOrderQty: 100 },
    { symbol: 'EURUSDT', customObiThreshold: 55.0, customRsiThreshold: 50, takeProfit: 0.20, quoteOrderQty: 100 }
  ];

  let passedCards = 0;
  const totalCards = cardsToTest.length;

  for (let i = 0; i < cardsToTest.length; i++) {
    const success = await runScenarioTestForCard(cardsToTest[i], i + 1, totalCards);
    if (success) passedCards++;
  }

  console.log('\n================================================================================');
  console.log(`🏆 FINAL TEST RESULTS: ${passedCards} / ${totalCards} CARDS PASSED 100% SUCCESSFULLY!`);
  console.log('================================================================================');

  process.exit(passedCards === totalCards ? 0 : 1);
}

main().catch(err => {
  console.error('❌ Fatal error during test execution:', err);
  process.exit(1);
});
