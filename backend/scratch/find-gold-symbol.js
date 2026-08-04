const MexcClient = require('../mexc-client');

async function findGoldSymbols() {
  const client = new MexcClient();
  const tickers = await client.getAllTickerPrices();

  console.log('Searching MEXC active pairs for Gold / XAU / PAXG / GLD...');
  if (Array.isArray(tickers)) {
    const goldMatches = tickers.filter(t => {
      const s = (t.symbol || '').toUpperCase();
      return s.includes('GOLD') || s.includes('XAU') || s.includes('PAXG') || s.includes('GLD');
    });

    console.log(`Found ${goldMatches.length} Gold related trading pair(s) on MEXC:`);
    goldMatches.forEach(t => console.log(` - Symbol: ${t.symbol} | Price: $${t.price}`));
  }
}

findGoldSymbols().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
