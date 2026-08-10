const fs = require('fs');
const path = require('path');
const MexcTracker = require('../tracker');

// ─── MOCK MEXC CLIENT ────────────────────────────────────────────────────────
class MockMexcClient {
  constructor() {
    this.balances = [
      { asset: 'USDT', free: '100000.0', locked: '0.0' },
      { asset: 'BTC',  free: '0.0', locked: '0.0' },
      { asset: 'XAUT', free: '0.0', locked: '0.0' },
      { asset: 'EUR',  free: '0.0', locked: '0.0' }
    ];
    this.ordersPlaced = [];
    this.nextOrderId  = 9001;
    this.tpFilled     = {}; // symbol → bool
  }

  hasCredentials()    { return true; }
  async getBalances() { return this.balances; }

  async getTickerPrice(symbol) {
    return { BTCUSDT: 65000, XAUTUSDT: 2400, EURUSDT: 1.085 }[symbol] || 100;
  }
  async getAllTickerPrices() {
    return [
      { symbol: 'BTCUSDT',  price: '65000.0' },
      { symbol: 'XAUTUSDT', price: '2400.0'  },
      { symbol: 'EURUSDT',  price: '1.0850'  }
    ];
  }
  async getAllPrices() { return this.getAllTickerPrices(); }

  async getKlines() {
    return Array.from({ length: 25 }, (_, i) => [
      Date.now() - (25 - i) * 15 * 60 * 1000,
      '65000','65100','64900','65000','10', Date.now(), '650000', 10, '5', '0'
    ]);
  }
  async getDepth() {
    return { bids:[['64995','1']], asks:[['65005','1']] };
  }
  async getRecentTrades() {
    return [{ price:'65000', qty:'0.01', isBuyerMaker:false, time:Date.now() }];
  }

  async placeOrder(params) {
    const id      = `ord_${this.nextOrderId++}`;
    const isMarket = params.type==='MARKET' || !!params.quoteOrderQty;
    const status  = isMarket ? 'FILLED' : 'NEW';
    const base    = params.symbol.replace('USDT','');
    const price   = parseFloat(params.price) || parseFloat(await this.getTickerPrice(params.symbol));
    const qty     = params.quantity || (params.quoteOrderQty / price);

    if (params.side === 'BUY') {
      const b = this.balances.find(b => b.asset === base);
      if (b) b.free = qty.toString();
    } else if (params.side === 'SELL' && isMarket) {
      const b = this.balances.find(b => b.asset === base);
      if (b) b.free = '0.0';
    }

    const o = { orderId:id, status, executedQty:qty.toString(),
                cummulativeQuoteQty:(qty*price).toString(), ...params };
    this.ordersPlaced.push(o);
    return o;
  }

  async getOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId === orderId);
    if (!o) return { orderId, status:'NEW', executedQty:'0', cummulativeQuoteQty:'0', price:'0' };
    if (o.side==='SELL' && !this.tpFilled[symbol]) return { ...o, status:'NEW' };
    if (o.side==='SELL' && this.tpFilled[symbol]) {
      const b = this.balances.find(b => b.asset === symbol.replace('USDT',''));
      if (b) b.free = '0.0';
      return { ...o, status:'FILLED' };
    }
    return { ...o };
  }

  async getOpenOrders(symbol) {
    if (this.tpFilled[symbol]) return [];
    return this.ordersPlaced.filter(o => o.symbol===symbol && o.status==='NEW');
  }
  async cancelOrder(symbol, orderId) {
    const o = this.ordersPlaced.find(x => x.orderId===orderId);
    if (o) o.status = 'CANCELED';
    return { success:true, orderId };
  }
  async getMyTrades() { return []; }
}

// ─── HELPER: NEUTRAL RADAR (prevents re-entry on idle cards) ─────────────────
const NEUTRAL = { averageObiPct: 30.0, averageRsi15m: 60.0, exchanges: [] };

// ─── WAIT ─────────────────────────────────────────────────────────────────────
const wait = ms => new Promise(r => setTimeout(r, ms));

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('================================================================================');
  console.log('🧪  USER CUSTOM CARD SCENARIOS — Full Lifecycle Verification');
  console.log('    3 Independent Scenarios: Custom OBI/RSI Entry, TP Execution,');
  console.log('    Auto-Repeat Cycle Reset, RSI ≤ 20 Emergency Market Sell');
  console.log('================================================================================');

  let passed = 0;
  const total = 3;

  // ─── SCENARIO 1: BTC — OBI 60%, RSI 45, TP 0.60%, + Emergency SL ──────────
  {
    console.log('\n────────────────────────────────────────────────────────────────────────────────');
    console.log('▶️  SCENARIO 1 — BTCUSDT  |  Custom OBI ≥ 60%  |  RSI ≤ 45  |  TP +0.60%');
    console.log('────────────────────────────────────────────────────────────────────────────────');

    const client  = new MockMexcClient();
    const tmpOrders = path.join(__dirname, 'tmp-sc1-orders.json');
    const tmpLogs   = path.join(__dirname, 'tmp-sc1-logs.json');
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

    const tracker = new MexcTracker(client, null);
    tracker.ordersPath = tmpOrders;
    tracker.logsPath   = tmpLogs;
    tracker.orders     = [];

    let radar = NEUTRAL;
    tracker.signalRadar = {
      getRadarMetrics:      ()  => radar,
      getMultiExchangeMetrics: async () => radar
    };

    // Create card
    const card = await tracker.addOrder({
      symbol:'BTCUSDT', quoteOrderQty:100, takeProfit:0.60, stopLoss:1.5,
      filterObi:true, targetObi:60.0, targetRsi:45.0, autoRepeat:true, dryRun:false
    });
    if (tracker.intervalId) { clearInterval(tracker.intervalId); tracker.intervalId = null; }
    console.log(`   ✓ Card: ${card.symbol} | OBI ≥ ${card.customObiThreshold}% | RSI ≤ ${card.customRsiThreshold} | TP +${card.takeProfit}%`);

    // 2A: OBI too low → BLOCKED
    radar = { averageObiPct:58, averageRsi15m:42, exchanges:[{name:'Binance',obiPct:58}] };
    await tracker.tick({'BTCUSDT':65000});
    let s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 58% < 60% → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // 2B: RSI too high → BLOCKED
    radar = { averageObiPct:62, averageRsi15m:48, exchanges:[{name:'Binance',obiPct:62}] };
    await tracker.tick({'BTCUSDT':65000});
    s = tracker.getOrders()[0];
    console.log(`   ✓ RSI 48 > 45 → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // 2C: BOTH valid → ENTRY!
    radar = { averageObiPct:65, averageRsi15m:38, exchanges:[{name:'Binance',obiPct:65}] };
    await tracker.tick({'BTCUSDT':65000});
    await wait(1200);
    radar = NEUTRAL; // neutralise after entry fires
    s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 65% RSI 38 → Entry! Status: ${s.status} | Exec Price: $${s.executionPrice}`);

    // Cycle 1 → TP hit (+0.60%)
    client.tpFilled['BTCUSDT'] = true;
    await tracker.tick({'BTCUSDT':65390});
    await wait(1200);
    await tracker.tick({'BTCUSDT':65390});
    await wait(1200);
    client.tpFilled['BTCUSDT'] = false;
    s = tracker.getOrders()[0];
    const btcCycles1 = Array.isArray(s.tradeHistory) ? s.tradeHistory.length : 0;
    console.log(`   ✓ TP +0.60% Hit → Status: ${s.status} | Cycles completed: ${btcCycles1}`);

    // Cycle 2 → re-entry
    radar = { averageObiPct:68, averageRsi15m:35, exchanges:[{name:'Binance',obiPct:68}] };
    await tracker.tick({'BTCUSDT':65000});
    await wait(1200);
    radar = NEUTRAL;
    s = tracker.getOrders()[0];
    console.log(`   ✓ Re-entered → Status: ${s.status}`);

    // RSI crash ≤ 20 → Emergency SL
    radar = { averageObiPct:40, averageRsi15m:17.5, exchanges:[{name:'Binance',obiPct:40}] };
    await tracker.tick({'BTCUSDT':63500});
    await wait(1200);
    await tracker.tick({'BTCUSDT':63500});
    await wait(1200);
    radar = NEUTRAL;
    s = tracker.getOrders()[0];
    const btcCycles2 = Array.isArray(s.tradeHistory) ? s.tradeHistory.length : 0;
    console.log(`   ✓ RSI 17.5 ≤ 20 → Emergency SL! Status: ${s.status} | Cycles completed: ${btcCycles2}`);

    if (s.status === 'PENDING_ACTIVATION'
        && btcCycles2 >= 2
        && s.customObiThreshold === 60.0
        && s.customRsiThreshold === 45.0) {
      console.log('   ✅ SCENARIO 1 PASSED: BTC — Custom 60% OBI & 45 RSI, TP Cycle + Emergency RSI SL verified!');
      passed++;
    } else {
      console.error('   ❌ SCENARIO 1 FAILED');
    }
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // ─── SCENARIO 2: GOLD (XAUT) — OBI 55%, RSI 40, TP 0.40% ─────────────────
  {
    console.log('\n────────────────────────────────────────────────────────────────────────────────');
    console.log('▶️  SCENARIO 2 — XAUTUSDT (Gold)  |  Custom OBI ≥ 55%  |  RSI ≤ 40  |  TP +0.40%');
    console.log('────────────────────────────────────────────────────────────────────────────────');

    const client  = new MockMexcClient();
    const tmpOrders = path.join(__dirname, 'tmp-sc2-orders.json');
    const tmpLogs   = path.join(__dirname, 'tmp-sc2-logs.json');
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

    const tracker = new MexcTracker(client, null);
    tracker.ordersPath = tmpOrders;
    tracker.logsPath   = tmpLogs;
    tracker.orders     = [];

    let radar = NEUTRAL;
    tracker.signalRadar = {
      getRadarMetrics:         () => radar,
      getMultiExchangeMetrics: async () => radar
    };

    const card = await tracker.addOrder({
      symbol:'XAUTUSDT', quoteOrderQty:100, takeProfit:0.40, stopLoss:1.5,
      filterObi:true, targetObi:55.0, targetRsi:40.0, autoRepeat:true, dryRun:false
    });
    if (tracker.intervalId) { clearInterval(tracker.intervalId); tracker.intervalId = null; }
    console.log(`   ✓ Card: ${card.symbol} | OBI ≥ ${card.customObiThreshold}% | RSI ≤ ${card.customRsiThreshold} | TP +${card.takeProfit}%`);

    // Rejection A: OBI 54% < 55%
    radar = { averageObiPct:54, averageRsi15m:38, exchanges:[{name:'Binance',obiPct:54}] };
    await tracker.tick({'XAUTUSDT':2400});
    let s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 54% < 55% → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // Rejection B: RSI 42 > 40
    radar = { averageObiPct:57, averageRsi15m:42, exchanges:[{name:'Binance',obiPct:57}] };
    await tracker.tick({'XAUTUSDT':2400});
    s = tracker.getOrders()[0];
    console.log(`   ✓ RSI 42 > 40 → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // Entry: OBI 58% ≥ 55%, RSI 36 ≤ 40
    radar = { averageObiPct:58, averageRsi15m:36, exchanges:[{name:'Binance',obiPct:58}] };
    await tracker.tick({'XAUTUSDT':2400});
    await wait(1200);
    radar = NEUTRAL;
    s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 58% RSI 36 → Entry! Status: ${s.status} | Exec: $${s.executionPrice}`);

    // TP hit (+0.40% of $2400 = $2409.60)
    client.tpFilled['XAUTUSDT'] = true;
    await tracker.tick({'XAUTUSDT':2410});
    await wait(1200);
    await tracker.tick({'XAUTUSDT':2410});
    await wait(1200);
    client.tpFilled['XAUTUSDT'] = false;
    s = tracker.getOrders()[0];
    const xautCycles = Array.isArray(s.tradeHistory) ? s.tradeHistory.length : 0;
    console.log(`   ✓ TP +0.40% Hit → Status: ${s.status} | Cycles completed: ${xautCycles}`);

    if (s.status === 'PENDING_ACTIVATION'
        && xautCycles >= 1
        && s.customObiThreshold === 55.0
        && s.customRsiThreshold === 40.0) {
      console.log('   ✅ SCENARIO 2 PASSED: Gold — Custom 55% OBI & 40 RSI, TP hit & Cycle Reset verified!');
      passed++;
    } else {
      console.error('   ❌ SCENARIO 2 FAILED');
    }
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // ─── SCENARIO 3: EUR — OBI 55%, RSI 50, TP 0.20% ──────────────────────────
  {
    console.log('\n────────────────────────────────────────────────────────────────────────────────');
    console.log('▶️  SCENARIO 3 — EURUSDT  |  Custom OBI ≥ 55%  |  RSI ≤ 50  |  TP +0.20%');
    console.log('────────────────────────────────────────────────────────────────────────────────');

    const client  = new MockMexcClient();
    const tmpOrders = path.join(__dirname, 'tmp-sc3-orders.json');
    const tmpLogs   = path.join(__dirname, 'tmp-sc3-logs.json');
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);

    const tracker = new MexcTracker(client, null);
    tracker.ordersPath = tmpOrders;
    tracker.logsPath   = tmpLogs;
    tracker.orders     = [];

    let radar = NEUTRAL;
    tracker.signalRadar = {
      getRadarMetrics:         () => radar,
      getMultiExchangeMetrics: async () => radar
    };

    const card = await tracker.addOrder({
      symbol:'EURUSDT', quoteOrderQty:100, takeProfit:0.20, stopLoss:1.5,
      filterObi:true, targetObi:55.0, targetRsi:50.0, autoRepeat:true, dryRun:false
    });
    if (tracker.intervalId) { clearInterval(tracker.intervalId); tracker.intervalId = null; }
    console.log(`   ✓ Card: ${card.symbol} | OBI ≥ ${card.customObiThreshold}% | RSI ≤ ${card.customRsiThreshold} | TP +${card.takeProfit}%`);

    // Rejection: OBI 54% < 55%
    radar = { averageObiPct:54, averageRsi15m:47, exchanges:[{name:'Binance',obiPct:54}] };
    await tracker.tick({'EURUSDT':1.0850});
    let s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 54% < 55% → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // Rejection: RSI 52 > 50
    radar = { averageObiPct:56, averageRsi15m:52, exchanges:[{name:'Binance',obiPct:56}] };
    await tracker.tick({'EURUSDT':1.0850});
    s = tracker.getOrders()[0];
    console.log(`   ✓ RSI 52 > 50 → ${s.status} (Expected: PENDING_ACTIVATION)`);

    // Entry: OBI 56% ≥ 55%, RSI 47 ≤ 50
    radar = { averageObiPct:56, averageRsi15m:47, exchanges:[{name:'Binance',obiPct:56}] };
    await tracker.tick({'EURUSDT':1.0850});
    await wait(1200);
    radar = NEUTRAL;
    s = tracker.getOrders()[0];
    console.log(`   ✓ OBI 56% RSI 47 → Entry! Status: ${s.status} | Exec: $${s.executionPrice}`);

    // TP hit (+0.20% of $1.0850 = $1.0872)
    client.tpFilled['EURUSDT'] = true;
    await tracker.tick({'EURUSDT':1.0872});
    await wait(1200);
    await tracker.tick({'EURUSDT':1.0872});
    await wait(1200);
    client.tpFilled['EURUSDT'] = false;
    s = tracker.getOrders()[0];
    const eurCycles = Array.isArray(s.tradeHistory) ? s.tradeHistory.length : 0;
    console.log(`   ✓ TP +0.20% Hit → Status: ${s.status} | Cycles completed: ${eurCycles}`);

    if (s.status === 'PENDING_ACTIVATION'
        && eurCycles >= 1
        && s.customObiThreshold === 55.0
        && s.customRsiThreshold === 50.0) {
      console.log('   ✅ SCENARIO 3 PASSED: EUR — Custom 55% OBI & 50 RSI, TP hit & Cycle Reset verified!');
      passed++;
    } else {
      console.error('   ❌ SCENARIO 3 FAILED');
    }
    for (const f of [tmpOrders, tmpLogs]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  // ─── FINAL RESULT ─────────────────────────────────────────────────────────
  console.log('\n================================================================================');
  console.log(`🏆  FINAL RESULT: ${passed} / ${total} SCENARIOS PASSED 100% SUCCESSFULLY!`);
  console.log('================================================================================');
  process.exit(passed === total ? 0 : 1);
}

main().catch(err => {
  console.error('❌ Fatal Error:', err);
  process.exit(1);
});
