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
    const status = this.fillStatusMap[orderId] || 'NEW';
    const price = await this.getTickerPrice(symbol);
    return {
      symbol,
      orderId,
      price: price.toString(),
      origQty: "1.0",
      executedQty: status === 'FILLED' ? "1.0" : "0.0",
      cummulativeQuoteQty: status === 'FILLED' ? price.toString() : "0.0",
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
    const initialPrice = mockClient.priceMap[sym];

    // Create Order with 0.1% Max Allowed Slippage as requested
    const order = await stockTracker.addOrder({
      symbol: sym,
      trailValue: '2.0',
      quantity: '2.0', // 2.0 tokens will exceed 0.1 top ask depth causing 1.2% > 0.1% slippage
      dryRun: false,
      takeProfit: '5.0',
      stopLoss: '3.0',
      maxSlippagePct: '0.1', // 0.1% max allowed slippage as requested!
      autoRepeat: true,
      startImmediately: false,
      activationOffset: '1.0',
      filterObi: true,
      filterVolumeSpike: false,
      filterRsi: false,
      filterSmartSl: false
    });

    assert(order.status === 'PENDING_ACTIVATION', `[${sym}] Created in PENDING_ACTIVATION state`);

    // Step 1: Dips below activation target
    mockClient.priceMap[sym] = initialPrice - 1.5;
    await stockTracker.tick();
    let liveOrder = stockTracker.orders.find(o => o.id === order.id);
    assert(liveOrder.status === 'RUNNING', `[${sym}] Activated to RUNNING state`);

    // Step 2: Rebounds to trigger buy
    const bottom = initialPrice - 1.5;
    mockClient.priceMap[sym] = bottom + 2.5; // Rebound > trailValue (2.0)
    await stockTracker.tick();
    liveOrder = stockTracker.orders.find(o => o.id === order.id);

    // Verify Pegged Limit Order was placed at (Top Bid + 0.02)
    const peggedCall = mockClient.placeCalls.find(c => c.symbol === sym && c.side === 'BUY' && c.type === 'LIMIT');
    assert(peggedCall !== undefined, `[${sym}] Market buy BLOCKED due to >0.1% slippage. Pegged LIMIT Buy placed!`);

    if (peggedCall) {
      const topBid = Math.round(((bottom + 2.5) * 0.999) * 100) / 100;
      const expectedPeggedPrice = Math.round((topBid + 0.02) * 10000) / 10000;
      assert(Math.abs(peggedCall.price - expectedPeggedPrice) < 0.0001, `[${sym}] Pegged Limit Buy Price calculated exactly as Top Bid (${topBid}) + 0.02 = ${peggedCall.price}`);
    }

    assert(liveOrder.status === 'PENDING_EXECUTION', `[${sym}] Order is in PENDING_EXECUTION state waiting for limit buy fill!`);

    // Verify NO Take Profit limit sell order is placed while waiting for buy fill!
    const prematureTpSellCall = mockClient.placeCalls.find(c => c.symbol === sym && c.side === 'SELL');
    assert(prematureTpSellCall === undefined, `[${sym}] Confirmed: NO Take Profit Sell placed while waiting for buy execution!`);

    // Step 3: Limit Buy Order Fills on MEXC!
    if (peggedCall) {
      mockClient.fillStatusMap[peggedCall.id] = 'FILLED';
      await stockTracker.tick(); // Process fill status update
      liveOrder = stockTracker.orders.find(o => o.id === order.id);
      assert(liveOrder.status === 'TP_SL_ACTIVE', `[${sym}] Limit Buy FILLED! Transitioned to TP_SL_ACTIVE state for TP/SL monitoring.`);
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
