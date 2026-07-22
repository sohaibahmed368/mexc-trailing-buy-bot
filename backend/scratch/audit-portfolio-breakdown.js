const MexcClient = require('../mexc-client');
const fs = require('fs');

async function auditPortfolio() {
  const creds = JSON.parse(fs.readFileSync('./backend/config/credentials.json', 'utf8'));
  const client = new MexcClient(creds.apiKey, creds.secretKey);

  console.log('========================================================================');
  console.log('🔍 MEXC LIVE ACCOUNT PORTFOLIO & AUDIT BREAKDOWN');
  console.log('========================================================================\n');

  try {
    const balances = await client.getBalances();
    console.log('📊 Current Live Account Balances:');
    let totalUsdtValuation = 0;

    for (const b of balances) {
      if (b.asset === 'USDT') {
        const usdtVal = b.free + b.locked;
        totalUsdtValuation += usdtVal;
        console.log(`  - USDT: Free ${b.free.toFixed(4)}, Locked ${b.locked.toFixed(4)} => Total: $${usdtVal.toFixed(4)} USDT`);
      } else {
        const symbol = b.asset + 'USDT';
        let price = 0;
        try {
          price = await client.getTickerPrice(symbol);
        } catch (e) {
          try {
            price = await client.getTickerPrice(b.asset + 'USDT');
          } catch (e2) {}
        }
        const totalQty = b.free + b.locked;
        const assetUsdtVal = totalQty * price;
        totalUsdtValuation += assetUsdtVal;
        console.log(`  - ${b.asset}: Qty ${(totalQty).toFixed(4)} @ $${price.toFixed(4)} USDT => Value: $${assetUsdtVal.toFixed(4)} USDT`);
      }
    }

    console.log('\n------------------------------------------------------------------------');
    console.log(`💰 Total Live Portfolio Valuation: $${totalUsdtValuation.toFixed(2)} USDT`);
    console.log(`📥 Initial Deposit Baseline: $2000.00 USDT`);
    console.log(`📉 Net Portfolio Variance vs Deposit: $${(totalUsdtValuation - 2000.0).toFixed(2)} USDT`);
    console.log('------------------------------------------------------------------------\n');

    // Card Profit Math Comparison
    const cardProfits = [
      { coin: 'GOLD', profit: 1.89 },
      { coin: 'SUI', profit: 2.43 },
      { coin: 'BTC', profit: 2.15 },
      { coin: 'XRP', profit: 3.98 },
      { coin: 'BNB', profit: -0.80 },
      { coin: 'ETH', profit: -1.00 },
      { coin: 'FNDO', profit: -1.00 },
      { coin: 'UNI', profit: -1.50 }
    ];

    const netCompletedProfit = cardProfits.reduce((acc, c) => acc + c.profit, 0);
    console.log(`📈 Sum of Active Card Cumulative Gains: +$${netCompletedProfit.toFixed(2)} USDT`);

  } catch (err) {
    console.error('Audit Error:', err.message);
  }
}

auditPortfolio();
