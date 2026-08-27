const https = require('https');

function checkMexcStockSymbols() {
  const url = 'https://api.mexc.com/api/v3/exchangeInfo';
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const allSymbols = (json.symbols || []).map(s => s.symbol);
        
        const nikeMatches = allSymbols.filter(s => s.includes('NIKE') || s.includes('NKE'));
        const onMatches = allSymbols.filter(s => s.endsWith('ONUSDT') || s.endsWith('XUSDT') || s.includes('ONDO'));
        
        console.log('NIKE matches on MEXC:', nikeMatches);
        console.log('ON / X tokenized stock matches on MEXC (sample 30):', onMatches.slice(0, 30));
      } catch (e) {
        console.error('Error parsing MEXC response:', e.message);
      }
    });
  }).on('error', (err) => {
    console.error('HTTPS error:', err.message);
  });
}

checkMexcStockSymbols();
