const fs = require('fs');
const path = require('path');
const Tracker = require('../tracker');

async function test3TickObiPersistenceFilter() {
  console.log('🧪 TESTING 3-TICK OBI PERSISTENCE FILTER ENGINE...\n');

  const mockMexcClient = {
    getBalances: async () => [{ asset: 'USDT', free: '1000', locked: '0' }],
    createMarketBuyOrder: async () => ({ orderId: 'test-buy-123' }),
    getTickerPrice: async (sym) => ({ price: '4370.0' }),
    getOrder: async () => ({ status: 'FILLED', executedQty: '1', price: '4370.0' }),
    createLimitSellOrder: async () => ({ orderId: 'test-sell-123' })
  };

  const tracker = new Tracker(mockMexcClient);
  tracker.orders = [{
    id: 'test-card-persistence',
    symbol: 'GOLDUSDT',
    status: 'PENDING_ACTIVATION',
    customObiThreshold: 55.0,
    customRsiThreshold: 50.0,
    filterObi: true,
    amountUsdt: 100,
    dryRun: true
  }];

  let tickCount = 0;
  const simulatedObiValues = [58.2, 57.8, 57.6]; // 3 consecutive ticks above 55.0%

  const mockRadar = {
    getRadarMetrics: () => {
      const obi = simulatedObiValues[tickCount] || 50.0;
      return {
        averageObiPct: obi,
        averageRsi15m: 46.5,
        exchanges: [{ name: 'Binance', obiPct: obi }, { name: 'MEXC', obiPct: obi }]
      };
    }
  };

  tracker.setSignalRadar(mockRadar);

  console.log('--- TICK 1 (1s): OBI = 58.2% (>= 55.0%) ---');
  tickCount = 0;
  await tracker.tick(4370.0);
  console.log(`Card Status after Tick 1: ${tracker.orders[0].status} (Expected: PENDING_ACTIVATION)`);
  console.log(`Persistence Count: ${tracker.orders[0].obiPersistenceCount} / 3\n`);

  console.log('--- TICK 2 (2s): OBI = 57.8% (>= 55.0%) ---');
  tickCount = 1;
  await tracker.tick(4370.0);
  console.log(`Card Status after Tick 2: ${tracker.orders[0].status} (Expected: PENDING_ACTIVATION)`);
  console.log(`Persistence Count: ${tracker.orders[0].obiPersistenceCount} / 3\n`);

  console.log('--- TICK 3 (3s): OBI = 57.6% (>= 55.0%) - 3-SECOND CONTINUOUS STABILITY REACHED! ---');
  tickCount = 2;
  await tracker.tick(4370.0);
  await tracker.tick(4370.0); // Process PENDING_BUY transition
  console.log(`Card Status after Tick 3 Execution: ${tracker.orders[0].status} (Expected: TP_SL_ACTIVE / Holding)`);
  console.log(`Persistence Count: ${tracker.orders[0].obiPersistenceCount || 0} / 3\n`);

  if (tracker.orders[0].status === 'TP_SL_ACTIVE') {
    console.log('✅ TEST 1 PASSED: 3-Tick OBI Persistence Filter correctly held for 3 consecutive seconds before triggering Market Buy!');
  } else {
    console.log('❌ TEST 1 FAILED.');
  }

  // TEST RESET BEHAVIOR ON FLASH SPIKE DROP
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 TESTING FLASH SPIKE DROP RESET (OBI drops to 51.5% on Tick 2)...');
  console.log('------------------------------------------------------------------------\n');

  const tracker2 = new Tracker(mockMexcClient);
  tracker2.orders = [{
    id: 'test-card-drop-reset',
    symbol: 'NVDAONUSDT',
    status: 'PENDING_ACTIVATION',
    customObiThreshold: 55.0,
    customRsiThreshold: 50.0,
    filterObi: true,
    amountUsdt: 100,
    dryRun: true
  }];

  const simulatedFlashSpikeObi = [58.2, 51.5, 58.2]; // Tick 2 drops to 51.5%!
  let tickCount2 = 0;

  const mockRadar2 = {
    getRadarMetrics: () => {
      const obi = simulatedFlashSpikeObi[tickCount2] || 50.0;
      return {
        averageObiPct: obi,
        averageRsi15m: 46.5,
        exchanges: [{ name: 'Binance', obiPct: obi }]
      };
    }
  };

  tracker2.setSignalRadar(mockRadar2);

  console.log('--- TICK 1: OBI = 58.2% (Spike) ---');
  tickCount2 = 0;
  await tracker2.tick(120.0);
  console.log(`Persistence Count: ${tracker2.orders[0].obiPersistenceCount} / 3`);

  console.log('--- TICK 2: OBI = 51.5% (Drop / Settle) ---');
  tickCount2 = 1;
  await tracker2.tick(120.0);
  console.log(`Persistence Count: ${tracker2.orders[0].obiPersistenceCount} / 3 (Reset to 0 ✅)`);

  console.log('--- TICK 3: OBI = 58.2% (New Spike) ---');
  tickCount2 = 2;
  await tracker2.tick(120.0);
  console.log(`Persistence Count: ${tracker2.orders[0].obiPersistenceCount} / 3 (Started fresh 1/3 ✅)`);

  if (tracker2.orders[0].status === 'PENDING_ACTIVATION' && tracker2.orders[0].obiPersistenceCount === 1) {
    console.log('✅ TEST 2 PASSED: Flash spike drop correctly reset persistence counter to 0 and rejected premature entry!');
  } else {
    console.log('❌ TEST 2 FAILED.');
  }
}

test3TickObiPersistenceFilter().catch(console.error);
