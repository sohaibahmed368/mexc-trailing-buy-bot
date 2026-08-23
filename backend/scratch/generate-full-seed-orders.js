const fs = require('fs');
const path = require('path');

const existingSeedPath = path.join(__dirname, '..', 'seed-orders.json');
let existingCards = [];
if (fs.existsSync(existingSeedPath)) {
  try {
    existingCards = JSON.parse(fs.readFileSync(existingSeedPath, 'utf8'));
  } catch (e) {}
}

const existingSymbols = new Set(existingCards.map(c => (c.symbol || '').toUpperCase()));

const fullWatchlist = [
  // 7 Active Live Positions
  'GOOGLONUSDT',
  'AMZNXUSDT',
  'NVDAXUSDT',
  'SPCXONUSDT',
  'BABAONUSDT',
  'GOLD(XAUT)USDT',
  'ETHUSDT',

  // Major Crypto & Forex
  'BTCUSDT',
  'SOLUSDT',
  'SUIUSDT',
  'EURUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'BNBUSDT',
  'ADAUSDT',
  'AVAXUSDT',
  'LINKUSDT',
  'NEARUSDT',
  'APTUSDT',
  'RENDERUSDT',
  '1INCHUSDT',
  'FETUSDT',
  'PEPEUSDT',
  'SHIBUSDT',
  'WIFUSDT',
  'TAOUSDT',
  'INJUSDT',
  'ARBUSDT',
  'OPUSDT',

  // Tokenized Equities / US Stocks on MEXC
  'TSLAONUSDT',
  'AAPLUSDT',
  'MSFTONUSDT',
  'METAONUSDT',
  'NFLXONUSDT',
  'COINONUSDT',
  'PLTRONUSDT',
  'AMDONUSDT'
];

const allCards = [...existingCards];

fullWatchlist.forEach((symbol, idx) => {
  if (!existingSymbols.has(symbol)) {
    allCards.push({
      id: `ord_${Date.now() + idx}_${Math.random().toString(36).substr(2, 5)}`,
      symbol: symbol,
      trailValue: '0.15',
      quantity: null,
      quoteOrderQty: 100,
      orderType: 'MARKET',
      dryRun: false,
      status: 'PENDING_ACTIVATION',
      activationPrice: null,
      activationDirection: 'DOWN',
      activatedAt: null,
      takeProfit: symbol.includes('GOLD') ? 0.4 : (symbol.includes('ETH') || symbol.includes('BTC') ? 0.6 : 0.5),
      stopLoss: 0,
      filterSmartSl: false,
      slBuffer: 0.15,
      isSlExtended: false,
      isSlProfitLocked: false,
      lockedSlPrice: null,
      mexcSellOrderId: null,
      sellExecutionPrice: null,
      sellTriggeredAt: null,
      filterObi: true,
      targetObi: 55,
      targetRsi: 49,
      customObiThreshold: 55,
      customRsiThreshold: 49,
      filterVolume: false,
      filterRsi: false,
      filter40sVolume: true,
      consensusMode: 'SMART_CONFLUENCE',
      autoRepeat: true,
      startImmediately: true,
      activationOffset: 0.15,
      peakPrice: null,
      totalNetProfit: 0,
      tradeHistory: [],
      initialPrice: null,
      bottomPrice: null,
      triggerPrice: null,
      currentPrice: null,
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      mexcOrderId: null,
      executionPrice: null,
      error: null,
      _reqTargetObi: 55,
      _reqTargetRsi: 49
    });
  }
});

console.log(`Generated ${allCards.length} total tracking cards (Active + Watchlist)!`);
fs.writeFileSync(path.join(__dirname, '..', 'seed-orders.json'), JSON.stringify(allCards, null, 2), 'utf8');
fs.writeFileSync(path.join(__dirname, '..', 'data', 'orders.json'), JSON.stringify(allCards, null, 2), 'utf8');
console.log('✅ Updated backend/seed-orders.json and backend/data/orders.json successfully!');
