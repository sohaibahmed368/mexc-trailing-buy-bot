const https = require('https');
const http = require('http');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function queryMexcDosPreMarket() {
  console.log("================================================================================");
  console.log("🔍 MEXC PRE-MARKET & SPOT MARKET DATA AUDIT FOR DOS COIN (DOSUSDT)");
  console.log("================================================================================");

  // 1. Check Spot / Pre-market ticker symbols matching DOS
  console.log("\n1️⃣ Checking MEXC Ticker 24h for DOSUSDT...");
  try {
    const ticker = await fetchUrl('https://api.mexc.com/api/v3/ticker/24hr?symbol=DOSUSDT');
    console.log("   DOSUSDT 24h Ticker Result:", ticker);
  } catch (e) {
    console.log("   DOSUSDT 24h Ticker Error:", e.message);
  }

  // 2. Fetch All Tickers to find exact DOS symbol name on MEXC (e.g. DOSUSDT, DOS_USDT, PRE_DOS, etc.)
  console.log("\n2️⃣ Searching all MEXC tickers matching 'DOS'...");
  try {
    const allTickers = await fetchUrl('https://api.mexc.com/api/v3/ticker/24hr');
    if (Array.isArray(allTickers)) {
      const dosMatches = allTickers.filter(t => t.symbol && t.symbol.toUpperCase().includes('DOS'));
      console.log(`   Found ${dosMatches.length} symbol matches containing 'DOS':`);
      dosMatches.forEach(m => {
        console.log(`   - Symbol: ${m.symbol} | Price: $${m.lastPrice} | 24h Vol: ${m.volume} ${m.symbol.replace('USDT','')} | 24h Quote Vol: $${m.quoteVolume} USDT`);
      });
    }
  } catch (e) {
    console.log("   All Tickers search error:", e.message);
  }

  // 3. Fetch Recent Trades for DOSUSDT to calculate Buy vs Sell Volume
  console.log("\n3️⃣ Querying Public Trade History (Trades) for DOSUSDT...");
  const symbolsToTry = ['DOSUSDT', 'DOS_USDT'];
  for (const sym of symbolsToTry) {
    try {
      const trades = await fetchUrl(`https://api.mexc.com/api/v3/trades?symbol=${sym}&limit=1000`);
      if (Array.isArray(trades) && trades.length > 0) {
        console.log(`\n📊 Found ${trades.length} Recent Trades for ${sym}:`);

        let totalBuyCoinQty = 0;
        let totalSellCoinQty = 0;
        let totalBuyUsdtVal = 0;
        let totalSellUsdtVal = 0;
        let buyTradeCount = 0;
        let sellTradeCount = 0;

        trades.forEach(t => {
          const qty = parseFloat(t.qty || t.quantity || 0);
          const price = parseFloat(t.price || 0);
          const usdtVal = qty * price;

          // isBuyerMaker === false means Taker Market BUY (Aggressive Buyer)
          // isBuyerMaker === true means Taker Market SELL (Aggressive Seller)
          if (t.isBuyerMaker) {
            totalSellCoinQty += qty;
            totalSellUsdtVal += usdtVal;
            sellTradeCount++;
          } else {
            totalBuyCoinQty += qty;
            totalBuyUsdtVal += usdtVal;
            buyTradeCount++;
          }
        });

        console.log(`   -----------------------------------------------------------------------------`);
        console.log(`   🟢 TOTAL BOUGHT COINS (Market Buy / Taker Buy): ${totalBuyCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })} DOS ($${totalBuyUsdtVal.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT) [${buyTradeCount} Trades]`);
        console.log(`   🔴 TOTAL SOLD COINS (Market Sell / Taker Sell): ${totalSellCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })} DOS ($${totalSellUsdtVal.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT) [${sellTradeCount} Trades]`);
        console.log(`   📦 COMBINED TOTAL TRADED VOLUME: ${(totalBuyCoinQty + totalSellCoinQty).toLocaleString('en-US', { maximumFractionDigits: 2 })} DOS ($${(totalBuyUsdtVal + totalSellUsdtVal).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT)`);
        console.log(`   ⚖️ BUY vs SELL RATIO: Buy ${((totalBuyUsdtVal / (totalBuyUsdtVal + totalSellUsdtVal || 1)) * 100).toFixed(1)}% vs Sell ${((totalSellUsdtVal / (totalBuyUsdtVal + totalSellUsdtVal || 1)) * 100).toFixed(1)}%`);
        console.log(`   -----------------------------------------------------------------------------`);
      }
    } catch (e) {
      console.log(`   Trade history query error for ${sym}:`, e.message);
    }
  }

  // 4. Query MEXC Pre-Market Web API Endpoint if available
  console.log("\n4️⃣ Checking MEXC OTC / Pre-Market Project API Endpoint...");
  try {
    const preMarketData = await fetchUrl('https://www.mexc.com/api/platform/otc/project/list');
    console.log("   MEXC Pre-Market Projects Endpoint Response:", typeof preMarketData === 'object' ? Object.keys(preMarketData) : preMarketData.substring(0, 200));
  } catch (e) {
    console.log("   Pre-market OTC endpoint error:", e.message);
  }
}

queryMexcDosPreMarket();
