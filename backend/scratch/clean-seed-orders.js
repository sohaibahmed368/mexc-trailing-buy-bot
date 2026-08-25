const fs = require('fs');
const path = require('path');

// 1. User's Real Master Cards
const userMasterSymbols = [
  'GOOGLONUSDT',
  'AMZNXUSDT',
  'NVDAXUSDT',
  'SPCXONUSDT',
  'BABAONUSDT',
  'GOLD(XAUT)USDT',
  'ETHUSDT',
  'EURUSDT'
];

// 2. Temporarily Held Positions on MEXC (Must TP Sell -> Recover $100 USDT -> Delete & Never Rebuy)
const temporaryHoldingSymbols = [
  'SOLUSDT',
  'SUIUSDT',
  'NEARUSDT',
  'RENDERUSDT',
  'AVAXUSDT',
  'TAOUSDT',
  'OPUSDT',
  'ARBUSDT',
  'SHIBUSDT',
  'APTUSDT',
  'TSLAONUSDT'
];

const seedPath = path.join(__dirname, '..', 'seed-orders.json');
const currentCards = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

const cleanedCards = [];

currentCards.forEach(c => {
  const sym = (c.symbol || '').toUpperCase().trim();
  
  if (userMasterSymbols.includes(sym)) {
    // Keep user's active trading card
    cleanedCards.push(c);
  } else if (temporaryHoldingSymbols.includes(sym)) {
    // Keep active TP/SL so it sells out to USDT on MEXC, but FORCE autoRepeat = false so it NEVER buys again!
    c.autoRepeat = false;
    c.status = 'TP_SL_ACTIVE';
    cleanedCards.push(c);
  }
  // All other 18+ inactive coins are DELETED completely!
});

console.log(`✅ Cleaned cards count: ${cleanedCards.length} cards (Original Master: ${userMasterSymbols.length}, Temporary One-Off Sells: ${temporaryHoldingSymbols.length})`);
console.log('List of preserved cards:');
cleanedCards.forEach((c, i) => console.log(`   ${i + 1}. ${c.symbol} | Status: ${c.status} | Auto-Repeat: ${c.autoRepeat}`));

fs.writeFileSync(seedPath, JSON.stringify(cleanedCards, null, 2), 'utf8');

const ordersDataPath = path.join(__dirname, '..', 'data', 'orders.json');
fs.writeFileSync(ordersDataPath, JSON.stringify(cleanedCards, null, 2), 'utf8');

console.log('✅ Successfully wrote clean seed-orders.json and data/orders.json!');
