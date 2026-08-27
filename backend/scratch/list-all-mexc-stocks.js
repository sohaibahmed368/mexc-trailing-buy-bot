const https = require('https');

function getAllTokenizedStockPairs() {
  const url = 'https://api.mexc.com/api/v3/exchangeInfo';
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const allSymbols = (json.symbols || []).map(s => s.symbol);
        const onStocks = allSymbols.filter(s => s.endsWith('ONUSDT'));
        const xStocks = allSymbols.filter(s => s.endsWith('XUSDT') && !s.includes('MAX') && !s.includes('FLUX'));
        console.log(`Found ${onStocks.length} *ONUSDT pairs:`, onStocks);
        console.log(`Found ${xStocks.length} *XUSDT pairs:`, xStocks);
      } catch (e) {
        console.error('Error:', e.message);
      }
    });
  });
}

getAllTokenizedStockPairs();
