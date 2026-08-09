const https = require('https');

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

async function queryMexcGrvtStats() {
  console.log("================================================================================");
  console.log("🔍 MEXC PRE-MARKET & HISTORICAL AUDIT FOR GRVT COIN (GRVTUSDT)");
  console.log("================================================================================");

  // 1. Ticker 24h for GRVTUSDT
  console.log("\n1️⃣ Checking MEXC Ticker 24h for GRVTUSDT...");
  try {
    const ticker = await fetchUrl('https://api.mexc.com/api/v3/ticker/24hr?symbol=GRVTUSDT');
    console.log("   GRVTUSDT 24h Ticker Result:", ticker);
  } catch (e) {
    console.log("   GRVTUSDT 24h Ticker Error:", e.message);
  }

  // 2. Search all tickers matching GRVT
  console.log("\n2️⃣ Searching all MEXC tickers matching 'GRVT'...");
  try {
    const allTickers = await fetchUrl('https://api.mexc.com/api/v3/ticker/24hr');
    if (Array.isArray(allTickers)) {
      const grvtMatches = allTickers.filter(t => t.symbol && t.symbol.toUpperCase().includes('GRVT'));
      console.log(`   Found ${grvtMatches.length} symbol matches containing 'GRVT':`);
      grvtMatches.forEach(m => {
        console.log(`   - Symbol: ${m.symbol} | Price: $${m.lastPrice} | 24h Vol: ${m.volume} GRVT | 24h Quote Vol: $${m.quoteVolume} USDT`);
      });
    }
  } catch (e) {
    console.log("   All Tickers search error:", e.message);
  }

  // 3. Query Trades for GRVTUSDT to calculate Buy vs Sell Volume
  console.log("\n3️⃣ Querying Public Trade History (Trades) for GRVTUSDT...");
  const symbolsToTry = ['GRVTUSDT', 'GRVT_USDT'];
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
        console.log(`   🟢 BUY SIDE VOLUME (Taker Buy): ${totalBuyCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })} GRVT ($${totalBuyUsdtVal.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT) [${buyTradeCount} Trades]`);
        console.log(`   🔴 SELL SIDE VOLUME (Taker Sell): ${totalSellCoinQty.toLocaleString('en-US', { maximumFractionDigits: 2 })} GRVT ($${totalSellUsdtVal.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT) [${sellTradeCount} Trades]`);
        console.log(`   📦 TOTAL TRADED VOLUME: ${(totalBuyCoinQty + totalSellCoinQty).toLocaleString('en-US', { maximumFractionDigits: 2 })} GRVT ($${(totalBuyUsdtVal + totalSellUsdtVal).toLocaleString('en-US', { maximumFractionDigits: 2 })} USDT)`);
        console.log(`   ⚖️ BUY vs SELL RATIO: Buy ${((totalBuyUsdtVal / (totalBuyUsdtVal + totalSellUsdtVal || 1)) * 100).toFixed(1)}% vs Sell ${((totalSellUsdtVal / (totalBuyUsdtVal + totalSellUsdtVal || 1)) * 100).toFixed(1)}%`);
        console.log(`   -----------------------------------------------------------------------------`);
      }
    } catch (e) {
      console.log(`   Trade history query error for ${sym}:`, e.message);
    }
  }
}

queryMexcGrvtStats();
