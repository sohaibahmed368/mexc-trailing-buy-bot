const https = require('https');

function getMexcSymbols() {
  const url = 'https://api.mexc.com/api/v3/exchangeInfo';
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        const allSymbols = (json.symbols || []).map(s => s.symbol);
        const goldMatches = allSymbols.filter(s => s.includes('PAXG') || s.includes('XAUT') || s.includes('GOLD'));
        console.log('Matches on MEXC for GOLD/PAXG/XAUT:', goldMatches);
      } catch (e) {
        console.error('Error parsing MEXC response:', e.message);
      }
    });
  }).on('error', (err) => {
    console.error('HTTPS error:', err.message);
  });
}

getMexcSymbols();
