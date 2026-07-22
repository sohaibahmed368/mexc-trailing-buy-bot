const OrderTracker = require('../tracker');
const StockOrderTracker = require('../stock-tracker');
const assert = require('assert');

console.log('========================================================================');
console.log('🌐 ALL-COIN MEXC ASSET LIST 100% MAKER SAFETY & RACE CONDITION AUDIT');
console.log('========================================================================\n');

class AllCoinMexcClient {
  constructor() {
    this.priceMap = {
      // Majors
      'BTCUSDT': 65000.0,
      'ETHUSDT': 3500.0,
      'SOLUSDT': 150.00,
      'BNBUSDT': 580.00,
      'XRPUSDT': 0.60,
      
      // High Volatility Altcoins & Memes
      'SUIUSDT': 3.4567,
      'ONDOUSDT': 0.4040,
      'PEPEUSDT': 0.00001234,
      'SHIBUSDT': 0.00001785,
      'DOGEUSDT': 0.1250,
      'FLOKIUSDT': 0.000155,
      'BONKUSDT': 0.000021,
      'WIFUSDT': 2.35,
      'FETUSDT': 1.45,
      'NEARUSDT': 4.80,

      // Low Liquidity & Tokenized Stocks
      'LOWLIQUSDT': 0.05,
      'GOLDONUSDT': 2400.0,
      'NVDAONUSDT': 120.0,
      'TSLAONUSDT': 250.0,
      'AAPLONUSDT': 220.0,
      'SPCXONUSDT': 130.0
    };
  }

  hasCredentials() { return true; }

  async getTickerPrice(symbol) {
    return this.priceMap[symbol] || 10.0;
  }

  async getDepth(symbol, limit = 10) {
    const p = await this.getTickerPrice(symbol);
    let tick = 0.0001;
    if (p >= 1000) tick = 0.01;
    else if (p >= 10) tick = 0.001;
    else if (p < 0.1) tick = 0.000001;

    return {
      bids: [[(p).toFixed(6), '1000.0'], [(p - tick).toFixed(6), '2000.0']],
      asks: [[(p + tick).toFixed(6), '1000.0'], [(p + tick * 2).toFixed(6), '2000.0']]
    };
  }
}

async function runAllCoinMakerSafetyAudit() {
  const mockClient = new AllCoinMexcClient();
  const dummyIo = { emit: () => {} };
  const tracker = new OrderTracker(mockClient, dummyIo);
  const stockTracker = new StockOrderTracker(mockClient, dummyIo);

  const symbols = Object.keys(mockClient.priceMap);
  let passCount = 0;
  let failCount = 0;

  console.log(`⏳ Testing 1-Tick Safety Buffer across ${symbols.length} MEXC Coins & Assets...\n`);

  for (const sym of symbols) {
    try {
      const depth = await mockClient.getDepth(sym);
      const bestBid = parseFloat(depth.bids[0][0]);
      const bestAsk = parseFloat(depth.asks[0][0]);

      // Calculate Peg Prices
      const tr = sym.endsWith('ONUSDT') ? stockTracker : tracker;
      const buyPeg = await tr.calculateMakerPegPrice(sym, 'BUY', bestAsk);
      const sellPeg = await tr.calculateMakerPegPrice(sym, 'SELL', bestBid);

      // Verify BUY rule: buyPeg MUST be strictly < bestAsk
      const buyPassed = buyPeg < bestAsk;
      // Verify SELL rule: sellPeg MUST be strictly > bestBid
      const sellPassed = sellPeg > bestBid;

      // Simulate 150ms ping race condition: Ask drops by 1 tick, Bid rises by 1 tick
      let tick = 0.0001;
      if (bestBid >= 1000) tick = 0.01;
      else if (bestBid >= 10) tick = 0.001;
      else if (bestBid < 0.1) tick = 0.000001;

      const shiftedAsk = bestAsk - tick;
      const shiftedBid = bestBid + tick;

      // Race condition verification: buyPeg must not match shiftedAsk as taker
      const buyRacePassed = buyPeg < shiftedAsk;
      const sellRacePassed = sellPeg > shiftedBid;

      if (buyPassed && sellPassed && buyRacePassed && sellRacePassed) {
        console.log(`  ✅ [PASS] [${sym.padEnd(12)}] 100% MAKER GUARANTEED! BuyPeg: ${buyPeg} (< Ask ${bestAsk}), SellPeg: ${sellPeg} (> Bid ${bestBid})`);
        passCount++;
      } else {
        console.error(`  ❌ [FAIL] [${sym.padEnd(12)}] Maker peg failed: buyPeg=${buyPeg}, bestAsk=${bestAsk}, sellPeg=${sellPeg}, bestBid=${bestBid}`);
        failCount++;
      }
    } catch (e) {
      console.error(`  ❌ [ERROR] [${sym.padEnd(12)}] Exception: ${e.message}`);
      failCount++;
    }
  }

  console.log('\n========================================================================');
  console.log(`ALL-COIN MEXC MAKER SAFETY AUDIT SUMMARY: ${passCount} PASSED, ${failCount} FAILED.`);
  console.log('========================================================================');

  if (failCount > 0) process.exit(1);
}

runAllCoinMakerSafetyAudit();
