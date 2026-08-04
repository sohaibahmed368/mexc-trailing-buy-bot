const MexcClient = require('../mexc-client');

async function testTimeSync() {
  const client = new MexcClient();
  console.log('Testing MEXC Time Sync...');
  await client.syncTimeOffset();
  console.log(`Calculated MEXC Server Time Offset: ${client.timeOffset} ms`);
  console.log('✅ MexcClient Time Sync test PASSED!');
}

testTimeSync().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
