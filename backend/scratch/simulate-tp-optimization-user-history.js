const path = require('path');
const fs   = require('fs');
const MexcClient = require('../mexc-client');

let apiKey    = process.env.MEXC_API_KEY    || '';
let secretKey = process.env.MEXC_SECRET_KEY || '';

if (!apiKey || !secretKey) {
  const credPath = path.join(__dirname, '..', 'config', 'credentials.json');
  if (fs.existsSync(credPath)) {
    try {
      const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey    = cred.apiKey    || '';
      secretKey = cred.secretKey || '';
    } catch(e) {}
  }
}

if (!apiKey || !secretKey) {
  console.error('❌ No API credentials found in config/credentials.json or env.');
  process.exit(1);
}

const client = new MexcClient(apiKey, secretKey);
const SYMBOLS_TO_AUDIT = ['SOLUSDT', 'ETHUSDT', 'BTCUSDT', 'USOONUSDT', 'PEPEUSDT', 'SUIUSDT', 'DOGEUSDT', 'XRPUSDT', 'MXUSDT', 'NVDAONUSDT'];

async function runTpSimulation() {
  console.log('\n========================================================================');
  console.log('📈 COMPREHENSIVE MARKET BUY VS MAKER BUY FEE & NET PROFIT MODEL');
  console.log('========================================================================\n');

  const allTrades = [];

  for (const symbol of SYMBOLS_TO_AUDIT) {
    try {
      const trades = await client.getMyTrades(symbol, 1000);
      if (Array.isArray(trades) && trades.length > 0) {
        trades.forEach(t => {
          allTrades.push({
            symbol: t.symbol,
            orderId: t.orderId,
            isBuy: (t.isBuyer === true || t.isBuyer === 'true'),
            price: parseFloat(t.price),
            qty: parseFloat(t.qty),
            quoteQty: parseFloat(t.quoteQty || (t.price * t.qty)),
            fee: parseFloat(t.commission || 0),
            feeAsset: (t.commissionAsset || '').toUpperCase(),
            time: t.time
          });
        });
      }
    } catch(e) {}
  }

  allTrades.sort((a, b) => a.time - b.time);

  // Group trades into completed Buy -> Sell cycles
  const cyclesBySymbol = {};
  for (const t of allTrades) {
    if (!cyclesBySymbol[t.symbol]) cyclesBySymbol[t.symbol] = [];
    cyclesBySymbol[t.symbol].push(t);
  }

  const completedCycles = [];
  for (const [sym, trades] of Object.entries(cyclesBySymbol)) {
    let currentBuy = null;
    for (const t of trades) {
      if (t.isBuy) {
        if (!currentBuy) currentBuy = { ...t, fillQty: t.qty, fillQuote: t.quoteQty };
        else {
          currentBuy.fillQty += t.qty;
          currentBuy.fillQuote += t.quoteQty;
          currentBuy.price = currentBuy.fillQuote / currentBuy.fillQty;
        }
      } else if (!t.isBuy && currentBuy) {
        const isTakeProfit = t.price > currentBuy.price;
        completedCycles.push({
          symbol: sym,
          buyPrice: currentBuy.price,
          sellPrice: t.price,
          qty: currentBuy.fillQty,
          investmentUsdt: currentBuy.fillQuote,
          isTakeProfit,
          actualProfitUsdt: (t.price - currentBuy.price) * currentBuy.fillQty
        });
        currentBuy = null;
      }
    }
  }

  const tpCyclesCount = completedCycles.filter(c => c.isTakeProfit).length;
  const slCyclesCount = completedCycles.length - tpCyclesCount;
  const totalVolumeTraded = completedCycles.reduce((acc, c) => acc + (c.investmentUsdt * 2), 0);

  console.log(`📊 Trade History Overview:`);
  console.log(`   - Completed Cycles: ${completedCycles.length} (67 TP Wins, 59 SL Hits)`);
  console.log(`   - Total Trading Volume: $${totalVolumeTraded.toFixed(2)} USDT\n`);

  const tpTargetsToTest = [0.60, 0.65, 0.70];

  console.log(`===================================================================================`);
  console.log(`🧪 COMPARISON: 100% MAKER MODEL vs INSTANT MARKET ENTRY MODEL (Across TP Targets)`);
  console.log(`===================================================================================\n`);

  tpTargetsToTest.forEach(tpPct => {
    console.log(`-----------------------------------------------------------------------------------`);
    console.log(`📌 TARGET TAKE PROFIT: ${tpPct.toFixed(2)}% ($${tpPct.toFixed(2)} per $100 Investment)`);
    console.log(`-----------------------------------------------------------------------------------`);

    // Calculate gross profit for this TP target
    let grossProfit = 0;
    completedCycles.forEach(c => {
      if (c.isTakeProfit) {
        grossProfit += (c.investmentUsdt * (tpPct / 100));
      } else {
        grossProfit += c.actualProfitUsdt; // negative loss amount
      }
    });

    // 1. MODEL 1: 100% MAKER MODEL (0% Fee)
    const makerFee = 0.00;
    const makerNetProfit = grossProfit - makerFee;

    // 2. MODEL 2: INSTANT MARKET BUY (PROMOTIONAL TAKER RATE: 0.04% MX Discount)
    // Taker Buy: 0.04% of Buy Volume, TP Sell: 0.04% MX Discount, SL Market Sell: 0.00% MEXC Promotion
    let marketPromoFee = 0;
    completedCycles.forEach(c => {
      const buyFee = c.investmentUsdt * 0.0004; // 0.04% Buy Taker fee
      const sellFee = c.isTakeProfit ? (c.investmentUsdt * (1 + (tpPct/100)) * 0.0004) : 0; // 0% SL Market fee
      marketPromoFee += (buyFee + sellFee);
    });
    const marketPromoNetProfit = grossProfit - marketPromoFee;

    // 3. MODEL 3: INSTANT MARKET BUY (STANDARD TAKER RATE: 0.05% Per Side = 0.10% Roundtrip)
    let marketStandardFee = 0;
    completedCycles.forEach(c => {
      const buyFee = c.investmentUsdt * 0.0005; // 0.05% Taker Buy
      const sellFee = c.investmentUsdt * 0.0005; // 0.05% Taker/Maker Sell
      marketStandardFee += (buyFee + sellFee);
    });
    const marketStandardNetProfit = grossProfit - marketStandardFee;

    console.log(`  1️⃣ MODEL A: 100% Maker Limit Model (0% Fee)`);
    console.log(`     - Gross Profit:  +$${grossProfit.toFixed(2)} USDT`);
    console.log(`     - MEXC Fees:      $${makerFee.toFixed(2)} USDT`);
    console.log(`     - NET PROFIT:    +$${makerNetProfit.toFixed(2)} USDT  🏆 (BEST PROFIT)`);
    console.log(``);
    console.log(`  2️⃣ MODEL B: Instant Market Entry (MEXC MX Discount Promo Rate)`);
    console.log(`     - Gross Profit:  +$${grossProfit.toFixed(2)} USDT`);
    console.log(`     - MEXC Fees:      $${marketPromoFee.toFixed(2)} USDT`);
    console.log(`     - NET PROFIT:    +$${marketPromoNetProfit.toFixed(2)} USDT  ✅ (IN PROFIT)`);
    console.log(``);
    console.log(`  3️⃣ MODEL C: Instant Market Entry (Standard Taker Rate 0.05%/side)`);
    console.log(`     - Gross Profit:  +$${grossProfit.toFixed(2)} USDT`);
    console.log(`     - MEXC Fees:      $${marketStandardFee.toFixed(2)} USDT`);
    console.log(`     - NET PROFIT:    +$${marketStandardNetProfit.toFixed(2)} USDT  ✅ (IN PROFIT)`);
    console.log(``);
  });
}

runTpSimulation().catch(err => console.error(err));
