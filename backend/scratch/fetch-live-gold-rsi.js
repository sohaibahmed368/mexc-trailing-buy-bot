const MexcClient = require('../mexc-client');

async function fetchGoldRsi() {
  const client = new MexcClient();
  const goldSymbols = ['GOLD(XAUT)USDT', 'GOLD(PAXG)USDT', 'GOLD(XAUT)USDC'];

  console.log('================================================================================');
  console.log('🌟 LIVE MEXC GOLD (15-MINUTE RSI & CHART MICROSTRUCTURE AUDIT)');
  console.log('================================================================================\n');

  function calculateRSI(closes, period = 14) {
    if (!closes || closes.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? -diff : 0;
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  for (const sym of goldSymbols) {
    try {
      const klines = await client.getKlines(sym, '15m', 60);
      const price = await client.getTickerPrice(sym);

      if (Array.isArray(klines) && klines.length >= 15) {
        const closes = klines.map(k => parseFloat(k[4]));
        const rsi15m = calculateRSI(closes, 14);

        let interpretation = '';
        if (rsi15m >= 70) {
          interpretation = '🔥 Overbought Zone (High Momentum / Potential Reversal Risk)';
        } else if (rsi15m >= 45) {
          interpretation = '🛡️ Bullish / Sideways Zone (Safe NO_SL Trend Guard Active — Stop Loss Disabled)';
        } else if (rsi15m >= 30) {
          interpretation = '⚠️ Bearish Pullback Zone (Normal Dip — Active Stop Loss Protection On)';
        } else {
          interpretation = '🧊 Oversold Dip Zone (Strong Rebound / Dip Buying Opportunity)';
        }

        console.log(`📌 Asset Symbol: ${sym}`);
        console.log(`   Live Price: $${price ? price.toFixed(4) : 'N/A'} USDT`);
        console.log(`   15m RSI Reading: ${rsi15m.toFixed(2)}`);
        console.log(`   Interpretation: ${interpretation}\n`);
      } else {
        console.log(`⚠️ ${sym}: Insufficient K-line data available.\n`);
      }
    } catch (e) {
      console.log(`⚠️ ${sym}: ${e.message}\n`);
    }
  }

  console.log('================================================================================');
}

fetchGoldRsi().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
