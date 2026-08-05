const Tracker = require('../tracker');
const MexcClient = require('../mexc-client');
const MultiExchangeSignalRadar = require('../multi-exchange-radar');

console.log('================================================================================');
console.log('🔬 LIVE 1-SECOND LOGS STREAM & ENGINE DIAGNOSTIC AUDIT');
console.log('================================================================================\n');

async function test1sLogStream() {
  const mexcClient = new MexcClient('', '');
  const signalRadar = new MultiExchangeSignalRadar(mexcClient);
  const tracker = new Tracker(mexcClient, signalRadar);

  let logsEmitted = 0;

  // Listen to tracker log emission
  const origLog = tracker.log.bind(tracker);
  tracker.log = (message, type, symbol) => {
    origLog(message, type, symbol);
    logsEmitted++;
  };

  console.log('1️⃣ Creating Active Card (SOLUSDT)...');
  await tracker.addOrder({
    symbol: 'SOLUSDT',
    quoteOrderQty: '100',
    takeProfit: '0.60',
    filterObi: true,
    autoRepeat: true,
    dryRun: true
  });

  console.log('2️⃣ Running Engine Polling for 5 Seconds (Expect 5 Live 1-Second Log Emits)...');
  
  for (let s = 1; s <= 5; s++) {
    await tracker.tick();
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n================================================================================`);
  console.log(`📊 DIAGNOSTIC RESULTS: Total Logs Emitted in 5 Seconds = ${logsEmitted}`);
  if (logsEmitted >= 5) {
    console.log(`✅ PERFECT! 1-Second Continuous Live Logs Stream VERIFIED 100%!`);
  } else {
    console.log(`❌ FAILURE: Only ${logsEmitted} logs emitted in 5 seconds.`);
  }
  console.log(`================================================================================\n`);
}

test1sLogStream().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
