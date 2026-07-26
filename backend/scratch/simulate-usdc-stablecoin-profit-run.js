// MEXC USDC/USDT 24-Hour Micro-Volatility Simulation Script
const initialCapitalTiers = [1000, 5000, 10000, 50000];

// User provided 24h market stats for USDC/USDT on MEXC
const usdcLow = 1.00083;
const usdcHigh = 1.00095;
const usdcDeltaPct = ((usdcHigh - usdcLow) / usdcLow) * 100; // ~0.012%

// Alternative FDUSD/USDT 24h market stats on MEXC
const fdusdLow = 0.9975;
const fdusdHigh = 1.0025;
const fdusdDeltaPct = ((fdusdHigh - fdusdLow) / fdusdLow) * 100; // ~0.501%

console.log('========================================================================');
console.log('📊 MEXC STABLECOIN 24-HOUR MICRO-VOLATILITY PROFIT SIMULATION RUN');
console.log('========================================================================\n');

console.log(`📌 USDC/USDT 24h Band: Low $${usdcLow} -> High $${usdcHigh} (Range: ${usdcDeltaPct.toFixed(3)}%)`);
console.log(`📌 FDUSD/USDT 24h Band: Low $${fdusdLow} -> High $${fdusdHigh} (Range: ${fdusdDeltaPct.toFixed(3)}%)\n`);

console.log('------------------------------------------------------------------------');
console.log('🔹 1. USDC/USDT PERFORMANCE (0.012% Fluctuation Band)');
console.log('------------------------------------------------------------------------');

initialCapitalTiers.forEach(capital => {
  const buyQty = capital / usdcLow;
  const sellRevenue = buyQty * usdcHigh;
  const profitPerCycle = sellRevenue - capital;
  const cyclesIn24h = 12; // Assuming ~12 micro dips/rebounds in 24h
  const dailyProfit = profitPerCycle * cyclesIn24h;

  console.log(`  Capital: $${capital.toLocaleString()} USDT`);
  console.log(`    - Single Cycle Profit: +$${profitPerCycle.toFixed(3)} USDT (+${usdcDeltaPct.toFixed(3)}%)`);
  console.log(`    - Est. 24h Earnings (12 Cycles): +$${dailyProfit.toFixed(2)} USDT`);
});

console.log('\n------------------------------------------------------------------------');
console.log('🔥 2. FDUSD/USDT / PYUSD/USDT PERFORMANCE (0.50% Fluctuation Band)');
console.log('------------------------------------------------------------------------');

initialCapitalTiers.forEach(capital => {
  const buyQty = capital / fdusdLow;
  const sellRevenue = buyQty * fdusdHigh;
  const profitPerCycle = sellRevenue - capital;
  const cyclesIn24h = 8; // Assuming 8 de-peg cycles in 24h
  const dailyProfit = profitPerCycle * cyclesIn24h;

  console.log(`  Capital: $${capital.toLocaleString()} USDT`);
  console.log(`    - Single Cycle Profit: +$${profitPerCycle.toFixed(2)} USDT (+${fdusdDeltaPct.toFixed(3)}%)`);
  console.log(`    - Est. 24h Earnings (8 Cycles): +$${dailyProfit.toFixed(2)} USDT`);
});

console.log('\n========================================================================');
console.log('🏆 SIMULATION RUN COMPLETED SUCCESSFULLY!');
console.log('========================================================================\n');
