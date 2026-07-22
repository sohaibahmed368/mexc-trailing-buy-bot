const fs = require('fs');
const MexcClient = require('../mexc-client');
const OrderTracker = require('../tracker');

async function test() {
  console.log('Testing MEXC Fee Tracking Feature...\n');
  const creds = JSON.parse(fs.readFileSync('C:/Users/Hi/.gemini/antigravity/scratch/mexc-trailing-buy-bot/backend/config/credentials.json'));
  const mexcClient = new MexcClient(creds.apiKey, creds.secretKey);
  const mockIo = { emit: () => {} };
  const tracker = new OrderTracker(mexcClient, mockIo);

  const fees = await tracker.getTotalMexcFeesPaid(true);
  console.log('--- TEST RESULT ---');
  console.log('USDT Fees Paid:      $', fees.usdtFees);
  console.log('MX Token Fees Paid:  ', fees.mxFees, 'MX');
  console.log('Total Fees in USDT:  $', fees.totalFeesInUsdt);
  console.log('Total Fills Counted: ', fees.feeCount);

  if (fees.feeCount > 0 && fees.totalFeesInUsdt > 0) {
    console.log('\n✅ VERIFICATION SUCCESSFUL: Fee tracking engine correctly fetched and calculated MEXC fees!');
  } else {
    console.log('\n❌ VERIFICATION FAILED: Fee engine returned 0 fees.');
  }
}

test().catch(console.error);
