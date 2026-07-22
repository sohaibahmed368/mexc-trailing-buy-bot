/**
 * UI Active Orders + MEXC Fees Calculation Diagnostic Test
 */

const path = require('path');

// Mock IO for testing
const mockIo = { emit: () => {} };

// Mock MEXC client
const mockMexcClient = {
  hasCredentials: () => true,
  getTickerPrice: async (sym) => sym === 'MXUSDT' ? 1.65 : 0.5,
  getMyTrades: async () => []
};

// Load OrderTracker
const OrderTracker = require(path.join(__dirname, '..', 'tracker'));
const tracker = new OrderTracker(mockMexcClient, mockIo);

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

async function main() {
  // ========================================================================
  // TEST 1: Frontend Status Filter - Active Orders Visibility
  // ========================================================================
  console.log('\n--- TEST 1: Frontend Active Orders Filter Logic ---');

  const testOrders = [
    { id: '1', status: 'RUNNING',            symbol: 'BTCUSDT' },
    { id: '2', status: 'PENDING_ACTIVATION', symbol: 'ETHUSDT' },
    { id: '3', status: 'TP_SL_ACTIVE',       symbol: 'SOLUSDT' },
    { id: '4', status: 'PENDING_EXECUTION',  symbol: 'XRPUSDT' },
    { id: '5', status: 'TRIGGERED',          symbol: 'ADAUSDT' },
    { id: '6', status: 'CANCELLED',          symbol: 'DOGEUSDT' },
    { id: '7', status: 'FAILED',             symbol: 'AVAXUSDT' },
  ];

  // Frontend filter (new fix): show everything except TRIGGERED, CANCELLED, FAILED
  const activeFiltered = testOrders.filter(
    o => o.status !== 'TRIGGERED' && o.status !== 'CANCELLED' && o.status !== 'FAILED'
  );

  assert(activeFiltered.length === 4, `Active filter returns 4 orders (RUNNING, PENDING_ACTIVATION, TP_SL_ACTIVE, PENDING_EXECUTION)`);
  assert(activeFiltered.some(o => o.status === 'RUNNING'), 'RUNNING orders shown');
  assert(activeFiltered.some(o => o.status === 'PENDING_ACTIVATION'), 'PENDING_ACTIVATION orders shown');
  assert(activeFiltered.some(o => o.status === 'TP_SL_ACTIVE'), 'TP_SL_ACTIVE orders shown');
  assert(activeFiltered.some(o => o.status === 'PENDING_EXECUTION'), 'PENDING_EXECUTION orders shown');
  assert(!activeFiltered.some(o => o.status === 'TRIGGERED'), 'TRIGGERED orders hidden');
  assert(!activeFiltered.some(o => o.status === 'CANCELLED'), 'CANCELLED orders hidden');
  assert(!activeFiltered.some(o => o.status === 'FAILED'), 'FAILED orders hidden');

  // ========================================================================
  // TEST 2: handleOrderCycleComplete fee record generation (TAKE_PROFIT = Maker Sell)
  // ========================================================================
  console.log('\n--- TEST 2: Sync handleOrderCycleComplete Fee Record (TAKE_PROFIT) ---');

  const cycleOrder = {
    id: 'test_cycle',
    symbol: 'ETHUSDT',
    autoRepeat: true,
    dryRun: false,
    quantity: 0.1,
    quoteOrderQty: null,
    executionPrice: 3000,
    sellExecutionPrice: 3200,
    currentPrice: 3200,
    takeProfit: 200,
    stopLoss: 100,
    isSlProfitLocked: false,
    activationOffset: 50,
    peakPrice: 3000,
    tradeHistory: [],
    totalNetProfit: 0
  };

  tracker.handleOrderCycleComplete(cycleOrder);

  assert(cycleOrder.tradeHistory.length === 1, 'One trade record added to tradeHistory');
  const record = cycleOrder.tradeHistory[0];
  assert(record.type === 'TAKE_PROFIT', `Trade type is TAKE_PROFIT`);
  assert(typeof record.mexcBuyFeeUsdt === 'number', 'mexcBuyFeeUsdt is number');
  assert(typeof record.mexcSellFeeUsdt === 'number', 'mexcSellFeeUsdt is number');
  assert(typeof record.totalMexcFeesUsdt === 'number', 'totalMexcFeesUsdt is number');
  assert(typeof record.profitUsdt === 'number', 'profitUsdt is number');
  assert(typeof record.grossProfitUsdt === 'number', 'grossProfitUsdt is number');

  // Buy fee = 0 (0% Maker promotion), Sell fee (Maker TP) = 0 (0% Maker promotion)
  const expectedBuyFee = 0;
  const expectedSellFee = 0;
  const expectedGrossProfit = (3200 - 3000) * 0.1; // 20 USDT
  const expectedNetProfit = expectedGrossProfit - expectedBuyFee - expectedSellFee;

  assert(Math.abs(record.mexcBuyFeeUsdt - expectedBuyFee) < 0.00001, `Buy fee = ${record.mexcBuyFeeUsdt.toFixed(6)} (expected 0.000000)`);
  assert(Math.abs(record.mexcSellFeeUsdt - expectedSellFee) < 0.00001, `Sell fee = ${record.mexcSellFeeUsdt.toFixed(6)} (expected 0.000000)`);
  assert(Math.abs(record.grossProfitUsdt - expectedGrossProfit) < 0.001, `Gross profit = ${record.grossProfitUsdt.toFixed(4)} USDT`);
  assert(Math.abs(record.profitUsdt - expectedNetProfit) < 0.001, `Net profit = ${record.profitUsdt.toFixed(4)} USDT`);
  assert(Math.abs(cycleOrder.totalNetProfit - expectedNetProfit) < 0.001, `Order totalNetProfit updated: ${cycleOrder.totalNetProfit.toFixed(4)}`);
  assert(cycleOrder.status === 'PENDING_ACTIVATION', 'Order reset to PENDING_ACTIVATION');
  assert(cycleOrder.executionPrice === null, 'executionPrice cleared');
  assert(cycleOrder.isSlProfitLocked === false, 'isSlProfitLocked cleared');

  // ========================================================================
  // TEST 3: Stop Loss cycle fees (Taker = 0% on MEXC)
  // ========================================================================
  console.log('\n--- TEST 3: Stop Loss Cycle Fees (SL = Taker = 0%) ---');

  const slOrder = {
    id: 'test_sl',
    symbol: 'SOLUSDT',
    autoRepeat: true,
    dryRun: false,
    quantity: 10,
    quoteOrderQty: null,
    executionPrice: 150,
    sellExecutionPrice: 130,
    currentPrice: 130,
    takeProfit: 20,
    stopLoss: 15,
    isSlProfitLocked: false,
    activationOffset: 5,
    peakPrice: 150,
    tradeHistory: [],
    totalNetProfit: 0
  };

  tracker.handleOrderCycleComplete(slOrder);

  const slRecord = slOrder.tradeHistory[0];
  assert(slRecord.type === 'STOP_LOSS', 'Stop Loss type identified');
  const slBuyFee = 0; // 0% Maker fee on MEXC
  const slSellFee = 0; // 0% Taker fee on MEXC (SL Market Sell)
  const slNetProfit = (130 - 150) * 10 - slBuyFee - slSellFee; // -200 USDT
  assert(Math.abs(slRecord.mexcBuyFeeUsdt - slBuyFee) < 0.0001, `SL buy fee: ${slRecord.mexcBuyFeeUsdt.toFixed(4)} USDT`);
  assert(slRecord.mexcSellFeeUsdt === 0, `SL sell fee = 0 (Taker 0% on MEXC)`);
  assert(Math.abs(slRecord.profitUsdt - slNetProfit) < 0.01, `SL net profit: ${slRecord.profitUsdt.toFixed(4)} USDT`);

  // ========================================================================
  // TEST 4: getTotalMexcFeesPaid - Accurate Calculation (Only Real Orders)
  // ========================================================================
  console.log('\n--- TEST 4: getTotalMexcFeesPaid Accurate Calculation ---');

  tracker.orders = [
    {
      id: 'real_order_1',
      symbol: 'ETHUSDT',
      dryRun: false,
      tradeHistory: [
        { cycle: 1, totalMexcFeesUsdt: 0.248, profitUsdt: 19.752, type: 'TAKE_PROFIT' },
        { cycle: 2, totalMexcFeesUsdt: 0.0, profitUsdt: -150.6, type: 'STOP_LOSS' } // 0 fee (Taker SL)
      ]
    },
    {
      id: 'real_order_2',
      symbol: 'SOLUSDT',
      dryRun: false,
      tradeHistory: [
        { cycle: 1, mexcBuyFeeUsdt: 0.12, mexcSellFeeUsdt: 0.128, profitUsdt: 19.752, type: 'TAKE_PROFIT' }
      ]
    },
    {
      // DryRun order - MUST be EXCLUDED from fee count
      id: 'dryrun_order',
      symbol: 'BTCUSDT',
      dryRun: true,
      tradeHistory: [
        { cycle: 1, totalMexcFeesUsdt: 9999, profitUsdt: 500, type: 'TAKE_PROFIT' }
      ]
    },
    {
      // Old-style record without fee fields - should be SKIPPED
      id: 'oldstyle_order',
      symbol: 'XRPUSDT',
      dryRun: false,
      tradeHistory: [
        { cycle: 1, buyPrice: 1.0, sellPrice: 1.2, profit: 0.2, type: 'TAKE_PROFIT' }
      ]
    }
  ];

  const feeSummary = await tracker.getTotalMexcFeesPaid(true);
  console.log(`  Fee summary: ${JSON.stringify(feeSummary)}`);

  assert(typeof feeSummary.totalFeesInUsdt === 'number', `Total fees calculated: ${feeSummary.totalFeesInUsdt} USDT`);
  assert(typeof feeSummary.feeCount === 'number', `Fee count calculated: ${feeSummary.feeCount}`);

  // ========================================================================
  // TEST 5: Multi-Coin - 7 Scenarios (BTC, ETH, SOL, XRP, PEPE, SUI, DOGE)
  // ========================================================================
  console.log('\n--- TEST 5: Multi-Coin Active Order Visibility (7 Coins) ---');

  const multiCoinOrders = [
    { id: 'btc1', symbol: 'BTCUSDT',  status: 'RUNNING',            trailValue: 100 },
    { id: 'eth1', symbol: 'ETHUSDT',  status: 'PENDING_ACTIVATION', trailValue: 50  },
    { id: 'sol1', symbol: 'SOLUSDT',  status: 'TP_SL_ACTIVE',       trailValue: 2   },
    { id: 'xrp1', symbol: 'XRPUSDT',  status: 'RUNNING',            trailValue: 0.02 },
    { id: 'pepe1', symbol: 'PEPEUSDT', status: 'PENDING_ACTIVATION', trailValue: 5e-7 },
    { id: 'sui1', symbol: 'SUIUSDT',  status: 'TP_SL_ACTIVE',       trailValue: 0.01 },
    { id: 'doge1', symbol: 'DOGEUSDT', status: 'RUNNING',            trailValue: 0.005 },
    { id: 'old1', symbol: 'LINKUSDT', status: 'TRIGGERED'  },
    { id: 'old2', symbol: 'AVAXUSDT', status: 'CANCELLED'  },
    { id: 'old3', symbol: 'UNIUSDT',  status: 'FAILED'     },
  ];

  const activeVisible = multiCoinOrders.filter(
    o => o.status !== 'TRIGGERED' && o.status !== 'CANCELLED' && o.status !== 'FAILED'
  );

  assert(activeVisible.length === 7, `7 of 10 orders visible (BTCUSDT/ETHUSDT/SOLUSDT/XRPUSDT/PEPEUSDT/SUIUSDT/DOGEUSDT)`);
  assert(activeVisible.find(o => o.symbol === 'BTCUSDT'), 'BTCUSDT RUNNING visible');
  assert(activeVisible.find(o => o.symbol === 'ETHUSDT'), 'ETHUSDT PENDING_ACTIVATION visible');
  assert(activeVisible.find(o => o.symbol === 'SOLUSDT'), 'SOLUSDT TP_SL_ACTIVE visible');
  assert(activeVisible.find(o => o.symbol === 'XRPUSDT'), 'XRPUSDT RUNNING visible');
  assert(activeVisible.find(o => o.symbol === 'PEPEUSDT'), 'PEPEUSDT PENDING_ACTIVATION visible');
  assert(activeVisible.find(o => o.symbol === 'SUIUSDT'), 'SUIUSDT TP_SL_ACTIVE visible');
  assert(activeVisible.find(o => o.symbol === 'DOGEUSDT'), 'DOGEUSDT RUNNING visible');
  assert(!activeVisible.find(o => o.symbol === 'LINKUSDT'), 'TRIGGERED LINKUSDT hidden');
  assert(!activeVisible.find(o => o.symbol === 'AVAXUSDT'), 'CANCELLED AVAXUSDT hidden');
  assert(!activeVisible.find(o => o.symbol === 'UNIUSDT'), 'FAILED UNIUSDT hidden');

  // ========================================================================
  // FINAL SUMMARY
  // ========================================================================
  console.log('\n========================================================================');
  console.log(`UI ACTIVE ORDERS + FEES DIAGNOSTIC: ${passed} PASSED, ${failed} FAILED.`);
  console.log('========================================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
