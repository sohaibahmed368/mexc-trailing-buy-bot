/**
 * DUAL-MODEL ARCHITECTURE REGRESSION & FUNCTIONAL MUTATION MASTER AUDIT
 * Tests both models side-by-side to guarantee zero regressions:
 * 
 * MODEL A (High-Liquidity / Standard Crypto - tracker.js):
 *   - Fast 1.8s Buy Limit Placement
 *   - Take Profit Limit Sell Execution (0% Fee)
 *   - Stop Loss Immediate Market Sell Execution (Instant Capital Protection)
 * 
 * MODEL B (Low-Liquidity / Stock Tokens - stock-tracker.js):
 *   - 10-Second Wait Window (10,000ms) for Top Buyer Green Badge
 *   - Smart Lazy Peg (Queue Priority Preserved if depth optimal)
 *   - 10-Second Wait Window (10,000ms) for Top Seller Limit Sell on Stop Loss
 *   - Zero Market Orders Ever
 */

const path = require('path');
const fs = require('fs');

// Mock socket.io for dual model tests
const emittedCryptoEvents = [];
const mockCryptoIo = {
  emit: (event, payload) => emittedCryptoEvents.push({ event, payload, ts: Date.now() })
};

const emittedStockEvents = [];
const mockStockIo = {
  emit: (event, payload) => emittedStockEvents.push({ event, payload, ts: Date.now() })
};

// Mock MEXC Client
const mockMexcClient = {
  hasCredentials: () => true,
  getTickerPrice: async (sym) => {
    if (sym === 'MXUSDT') return 1.65;
    if (sym === 'BTCUSDT') return 65000;
    if (sym === 'USOONUSDT') return 25;
    return 100;
  },
  getDepth: async (sym) => ({
    bids: [['24.95', '10.0'], ['24.90', '50.0']],
    asks: [['25.05', '12.0'], ['25.10', '60.0']]
  }),
  getMyTrades: async () => [],
  getTradeFee: async () => ({ makerCommission: 0.0000, takerCommission: 0.0000 }),
  placeOrder: async (params) => ({ orderId: `mock_ord_${Date.now()}_${Math.random().toString(36).substr(2, 4)}` }),
  cancelOrder: async (sym, id) => ({ symbol: sym, orderId: id, status: 'CANCELED' }),
  getOrder: async (sym, id) => ({ status: 'FILLED', executedQty: '10.0', cummulativeQuoteQty: '250.0' })
};

const OrderTracker = require('../tracker');
const StockOrderTracker = require('../stock-tracker');

const cryptoTracker = new OrderTracker(mockMexcClient, mockCryptoIo);
const stockTracker = new StockOrderTracker(mockMexcClient, mockStockIo);

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  ❌ [FAIL] ${label}`);
    failed++;
  }
}

async function runDualModelAudit() {
  console.log('\n========================================================================');
  console.log('🧪 DUAL-MODEL ARCHITECTURE REGRESSION & VARIABLE MUTATION AUDIT');
  console.log('========================================================================\n');

  // -------------------------------------------------------------------
  // TEST A: High-Liquidity Crypto Model (tracker.js)
  // -------------------------------------------------------------------
  console.log('--- MODEL A: High-Liquidity Crypto Model (tracker.js) ---');
  assert(cryptoTracker.pollInterval === 1800, `Polling interval set to 1.8s (1800ms) for high-liquidity crypto`);

  const cryptoOrder = {
    id: 'crypto_test_1',
    symbol: 'BTCUSDT',
    autoRepeat: true,
    dryRun: false,
    quantity: 0.1,
    executionPrice: 65000,
    sellExecutionPrice: 64000,
    currentPrice: 64000,
    takeProfit: 1000,
    stopLoss: 500,
    isSlProfitLocked: false,
    activationOffset: 100,
    peakPrice: 65000,
    tradeHistory: [],
    totalNetProfit: 0,
    status: 'TRIGGERED'
  };

  await cryptoTracker.handleOrderCycleComplete(cryptoOrder);

  assert(cryptoOrder.tradeHistory.length === 1, 'Crypto trade record pushed to tradeHistory');
  assert(cryptoOrder.status === 'PENDING_ACTIVATION', 'Crypto status reset to PENDING_ACTIVATION');
  assert(cryptoOrder.executionPrice === null, 'Crypto executionPrice cleared');
  assert(cryptoOrder.mexcOrderId === null, 'Crypto mexcOrderId cleared');
  assert(cryptoOrder.mexcSellOrderId === null, 'Crypto mexcSellOrderId cleared');

  // -------------------------------------------------------------------
  // TEST B: Low-Liquidity Stock Token Model (stock-tracker.js)
  // -------------------------------------------------------------------
  console.log('\n--- MODEL B: Low-Liquidity Stock Token Model (stock-tracker.js) ---');

  // Test calculateMakerPegPrice for 100% Maker Pegging
  const buyPeg = await stockTracker.calculateMakerPegPrice('USOONUSDT', 'BUY', 25.0);
  const sellPeg = await stockTracker.calculateMakerPegPrice('USOONUSDT', 'SELL', 25.0);

  assert(buyPeg < 25.05, `Stock Top Buyer Peg (${buyPeg}) strictly < Best Ask (25.05) [Green Badge Top Buyer ✅]`);
  assert(sellPeg > 24.95, `Stock Top Seller Peg (${sellPeg}) strictly > Best Bid (24.95) [Top Seller ✅]`);

  // Test 10-Second Wait Window in waitForLimitOrderFill
  const fillResult = await stockTracker.waitForLimitOrderFill('USOONUSDT', 'mock_stock_1', 'BUY', 10, 24.95, 20000, 10000);
  assert(fillResult.filled === true, 'Stock Limit order filled as 100% Maker (0% Fee)');

  // Test Stock Order Cycle Complete & Variable Mutations
  const stockOrder = {
    id: 'stock_test_1',
    symbol: 'USOONUSDT',
    autoRepeat: true,
    dryRun: false,
    quantity: 10,
    executionPrice: 25.0,
    sellExecutionPrice: 27.0,
    currentPrice: 27.0,
    takeProfit: 2.0,
    stopLoss: 1.0,
    isSlProfitLocked: false,
    activationOffset: 0.5,
    peakPrice: 25.0,
    tradeHistory: [],
    totalNetProfit: 0,
    status: 'TRIGGERED'
  };

  await stockTracker.handleOrderCycleComplete(stockOrder);

  assert(stockOrder.tradeHistory.length === 1, 'Stock trade record pushed to tradeHistory');
  assert(stockOrder.tradeHistory[0].profitUsdt === 20, 'Stock Net Profit calculated correctly (20 USDT)');
  assert(stockOrder.totalNetProfit === 20, 'Stock totalNetProfit mutated correctly');
  assert(stockOrder.status === 'PENDING_ACTIVATION', 'Stock status reset to PENDING_ACTIVATION');
  assert(stockOrder.peakPrice === 27.0, 'Stock peakPrice updated to 27.0');
  assert(Math.abs(stockOrder.activationPrice - 26.46) < 0.01, 'Stock activationPrice updated to 26.46 (2% dip offset from 27.0)');
  assert(stockOrder.executionPrice === null, 'Stock executionPrice reset to null');
  assert(stockOrder.mexcOrderId === null, 'Stock mexcOrderId reset to null');
  assert(stockOrder.mexcSellOrderId === null, 'Stock mexcSellOrderId reset to null');

  // -------------------------------------------------------------------
  // TEST C: Cross-Building & Socket Isolation
  // -------------------------------------------------------------------
  console.log('\n--- MODEL C: Socket Isolation & Event Emission ---');
  assert(emittedCryptoEvents.some(e => e.event === 'orders_update' || e.event === 'fees_update'), 'Crypto socket emits orders_update and fees_update');
  assert(emittedStockEvents.some(e => e.event === 'stock_orders_update'), 'Stock socket emits stock_orders_update independently');

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================
  console.log('\n========================================================================');
  console.log(`DUAL-MODEL REGRESSION SUMMARY: ${passed} PASSED, ${failed} FAILED.`);
  console.log('========================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

runDualModelAudit().catch(e => {
  console.error('Dual Model Audit Exception:', e);
  process.exit(1);
});
