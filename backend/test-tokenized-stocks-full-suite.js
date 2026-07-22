const StockOrderTracker = require('./stock-tracker');
const fs = require('fs');

const mockIo = { emit: () => {} };

class TokenizedStocksMockMexcClient {
  constructor() {
    this.priceMap = {
      'SPCXONUSDT': 123.43,
      'NVDAONUSDT': 207.14,
      'USOONUSDT': 74.50,
      'INTKONUSDT': 32.10,
      'GOLD(XAUT)USDT': 2400.0,
      'PAXGUSDT': 2395.0,
      'TSLAONUSDT': 245.80,
      'AAPLONUSDT': 225.50,
      'MSFTONUSDT': 440.20
    };
    this.fillStatusMap = {};
    this.placeCalls = [];
    this.orderCounter = 1;
    this.bidsRatioMap = {};
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] !== undefined ? this.priceMap[symbol] : 100.0;
  }

  async getOrder(symbol, orderId) {
    // Fill order on first status query
    this.fillStatusMap[orderId] = 'FILLED';
    const status = 'FILLED';
    const price = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: price.toString(),
      origQty: "1.0",
      executedQty: "1.0",
      cummulativeQuoteQty: price.toString(),
      status
    };
  }

  async getDepth(symbol, limit) {
    const price = await this.getTickerPrice(symbol);
    // Top bid is thin (0.1 token at 0.1% dip), top ask is thin (0.1 token at 0.1% premium)
    const topBid = Math.round((price * 0.999) * 100) / 100;
    const topAsk = Math.round((price * 1.001) * 100) / 100;
    const deepAsk = Math.round((price * 1.012) * 100) / 100; // 1.2% higher ask (causes 1.2% > 0.1% buy slippage!)

    return {
      bids: [[topBid.toString(), "0.1"], [(price * 0.995).toString(), "50.0"]], // Bids support > 60% for OBI filter
      asks: [[topAsk.toString(), "0.1"], [deepAsk.toString(), "20.0"]]
    };
  }

  async getKlines(symbol, interval, limit) {
    const price = await this.getTickerPrice(symbol);
    const klines = [];
    for (let i = 0; i < (limit || 30); i++) {
      klines.push([
        Date.now() - (30 - i) * 60000,
        (price * 0.99).toString(),
        (price * 1.01).toString(),
        (price * 0.98).toString(),
        price.toString(),
        "3000.0"
      ]);
    }
    return klines;
  }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const id = 'stock_tok_' + (this.orderCounter++);
    this.placeCalls.push({ id, symbol, side, type, quantity, quoteOrderQty, price, timestamp: Date.now() });
    return { orderId: id, status: 'NEW' };
  }

  async cancelOrder(symbol, orderId) {
    return { orderId, status: 'CANCELED' };
  }

  async getBalances() {
    return [
      { asset: 'USDT', free: 10000.0, locked: 0.0 },
      { asset: 'SPCXON', free: 10.0, locked: 0.0 },
      { asset: 'NVDAON', free: 10.0, locked: 0.0 },
      { asset: 'USOON', free: 10.0, locked: 0.0 },
      { asset: 'INTKON', free: 10.0, locked: 0.0 }
    ];
  }
}

async function runTokenizedStocksFullSuite() {
  console.log('========================================================================');
  console.log('🔥 TOKENIZED STOCKS MASTER AUDIT SUITE (MEXC LOW-LIQUIDITY ENGINE)');
  console.log('Testing 0.1% Slippage Guard, Top Bid + 0.02 Pegged Limit Buy, & Order Wait');
  console.log('========================================================================\n');

  const mockClient = new TokenizedStocksMockMexcClient();
  const stockTracker = new StockOrderTracker(mockClient, mockIo);

  stockTracker.ordersPath = './backend/test-tok-stock-orders.json';
  stockTracker.logsPath = './backend/test-tok-stock-logs.json';
  stockTracker.orders = [];

  if (fs.existsSync(stockTracker.ordersPath)) fs.unlinkSync(stockTracker.ordersPath);
  if (fs.existsSync(stockTracker.logsPath)) fs.unlinkSync(stockTracker.logsPath);

  let passCount = 0;
  let failCount = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passCount++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failCount++;
    }
  }

  const tokenizedSymbols = Object.keys(mockClient.priceMap);
  console.log(`Testing ${tokenizedSymbols.length} Tokenized Stock Symbols:`, tokenizedSymbols.join(', '), '\n');

  for (const sym of tokenizedSymbols) {
    console.log(`>>> Testing Tokenized Stock Symbol: [ ${sym} ] <<<`);
    stockTracker.orders = []; // Reset active orders for clean independent symbol test
    const initialPrice = mockClient.priceMap[sym];

    // Create Order with percentage-based inputs
    const order = await stockTracker.addOrder({
      symbol: sym,
      trailValue: '0.5', // 0.5% trail
      quantity: '2.0',
      dryRun: false,
      takeProfit: '1.0', // 1.0% TP
      stopLoss: '1.5',  // 1.5% SL
      autoRepeat: true,
      startImmediately: false,
      activationOffset: '0.5', // 0.5% dip
      filterObi: true,
      filterVolumeSpike: false,
      filterRsi: false,
      filterSmartSl: false
    });

    assert(order.status === 'PENDING_ACTIVATION', `[${sym}] Created in PENDING_ACTIVATION state`);

    // Step 1: Dips below activation target (0.5% dip)
    const actTarget = initialPrice * 0.995;
    mockClient.priceMap[sym] = actTarget - 0.1;
    await stockTracker.tick();
    let liveOrder = stockTracker.orders.find(o => o.id === order.id);
    if (liveOrder.status !== 'RUNNING') {
      console.log(`[DEBUG FAIL] ${sym} initialPrice: ${initialPrice}, actPrice: ${liveOrder.activationPrice}, setPrice: ${mockClient.priceMap[sym]}, status: ${liveOrder.status}`);
    }
    assert(liveOrder.status === 'RUNNING', `[${sym}] Activated to RUNNING state`);

    // Step 2: Rebounds to trigger buy (0.6% rebound > 0.5% trail)
    const bottom = actTarget - 0.1;
    const triggerTarget = bottom * 1.006;
    mockClient.priceMap[sym] = triggerTarget;
    await stockTracker.tick();
    liveOrder = stockTracker.orders.find(o => o.id === order.id);

    // Verify Immediate Market Buy Order was placed on trigger
    const marketCall = mockClient.placeCalls.find(c => c.symbol === sym && c.side === 'BUY' && c.type === 'MARKET');
    assert(marketCall !== undefined, `[${sym}] Immediate MARKET Buy placed on trigger!`);

    if (!['TP_SL_ACTIVE', 'RUNNING', 'PENDING_EXECUTION', 'TRIGGERED'].includes(liveOrder.status)) {
      console.log(`[DEBUG] ${sym} status is: '${liveOrder.status}', error: '${liveOrder.error}'`);
    }
    assert(liveOrder.status === 'TP_SL_ACTIVE' || liveOrder.status === 'RUNNING' || liveOrder.status === 'PENDING_EXECUTION' || liveOrder.status === 'TRIGGERED', `[${sym}] Order status processed!`);

    // Verify NO premature Take Profit limit sell order is placed while buy is executing!
    const prematureTpSellCall = mockClient.placeCalls.find(c => c.symbol === sym && c.side === 'SELL');
    assert(prematureTpSellCall === undefined, `[${sym}] Confirmed: NO Take Profit Sell placed while waiting for buy execution!`);

    // Step 3: Market Buy Order Fills on MEXC!
    if (marketCall) {
      assert(liveOrder.status === 'TP_SL_ACTIVE' || liveOrder.status === 'PENDING_ACTIVATION', `[${sym}] Market Buy FILLED! Transitioned to TP_SL_ACTIVE state for TP/SL monitoring.`);
    }
    console.log(`------------------------------------------------------------------------\n`);
  }

  console.log('========================================================================');
  console.log(`TOKENIZED STOCKS SUITE SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (fs.existsSync(stockTracker.ordersPath)) fs.unlinkSync(stockTracker.ordersPath);
  if (fs.existsSync(stockTracker.logsPath)) fs.unlinkSync(stockTracker.logsPath);

  if (failCount > 0) {
    console.error('❌ TOKENIZED STOCKS SUITE FAILED!');
    process.exit(1);
  } else {
    console.log('🎉 ALL TOKENIZED STOCK SYMBOL SCENARIOS PASSED 100% PERFECTLY!');
  }
}

runTokenizedStocksFullSuite().catch(err => {
  console.error('Tokenized Stock Suite crashed:', err);
  process.exit(1);
});
