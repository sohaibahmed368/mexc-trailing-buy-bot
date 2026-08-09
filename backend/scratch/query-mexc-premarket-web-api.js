const https = require('https');

function fetchWebJson(url) {
  return new Promise((resolve) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://www.mexc.com',
        'Referer': 'https://www.mexc.com/pre-market'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data.substring(0, 300) });
        }
      });
    }).on('error', (err) => resolve({ error: err.message }));
  });
}

async function testPremarketEndpoints() {
  console.log("================================================================================");
  console.log("🔍 TESTING MEXC PRE-MARKET PLATFORM WEB APIS FOR DOS COIN");
  console.log("================================================================================");

  const endpointsToTest = [
    'https://www.mexc.com/api/platform/otc/project/list?pageSize=50&pageNo=1',
    'https://www.mexc.com/api/platform/otc/project/detail?symbol=DOS',
    'https://www.mexc.com/api/platform/otc/order/list?symbol=DOS',
    'https://www.mexc.com/api/platform/spot/premarket/symbol/list',
    'https://www.mexc.com/api/platform/spot/premarket/trade/list?symbol=DOSUSDT',
    'https://www.mexc.com/api/platform/otc/trade/history?symbol=DOS',
    'https://www.mexc.com/api/platform/spot/market/symbols'
  ];

  for (const ep of endpointsToTest) {
    console.log(`\nTesting endpoint: ${ep}`);
    const res = await fetchWebJson(ep);
    if (res.code !== undefined || res.data !== undefined || res.success !== undefined) {
      console.log("   ✅ Response Code / Keys:", res.code, res.msg || res.message, Object.keys(res));
      if (res.data) {
        if (Array.isArray(res.data)) {
          console.log(`   Data items count: ${res.data.length}`);
          const dosItem = res.data.find(item => JSON.stringify(item).toUpperCase().includes('DOS'));
          if (dosItem) {
            console.log("   🎯 DOS MATCH FOUND:", JSON.stringify(dosItem, null, 2));
          } else {
            console.log("   Sample items:", res.data.slice(0, 2));
          }
        } else {
          console.log("   Data Content:", JSON.stringify(res.data).substring(0, 500));
        }
      }
    } else {
      console.log("   Response raw snippet:", JSON.stringify(res).substring(0, 150));
    }
  }
}

testPremarketEndpoints();
