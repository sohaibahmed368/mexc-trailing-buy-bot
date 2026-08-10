const fs = require('fs');
const path = require('path');

async function calculateGoldProfitLossBreakdown() {
  console.log("================================================================================");
  console.log("💰 GOLD 1,095 TRADES PROFIT & LOSS EXACT DOLLAR BREAKDOWN");
  console.log("   Standard $100 USDT Position Size per Trade | +0.40% TP Target vs RSI <= 20 SL");
  console.log("================================================================================");

  const reportPath = path.join(__dirname, 'gold_1096trades_tp04_rsi20_audit_report.json');
  if (!fs.existsSync(reportPath)) {
    console.error("Report file not found!");
    return;
  }

  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

  const POSITION_SIZE_USDT = 100.0; // $100 USDT per trade
  const TP_PCT = 0.40; // +0.40% profit

  const totalTpHits = report.takeProfitHits; // 1032 trades
  const sampleTpHits = report.sampleTpHitTrades;
  const rsiSlTrades = report.sampleRsiSlHitTrades; // 30 trades

  // 1. Calculate Total Profit from 1,032 Winning Trades
  const profitPerWinUsdt = POSITION_SIZE_USDT * (TP_PCT / 100.0); // $0.40 USDT
  const totalGrossProfitUsdt = totalTpHits * profitPerWinUsdt; // $412.80 USDT

  // 2. Calculate Total Loss from 30 Emergency SL Trades
  let totalGrossLossUsdt = 0;
  const slBreakdownList = [];

  rsiSlTrades.forEach((t, idx) => {
    const buyPrice = t.entryPrice;
    const sellPrice = t.exitPrice;
    const lossPct = ((sellPrice - buyPrice) / buyPrice) * 100.0; // e.g. -1.5%
    const lossUsdt = POSITION_SIZE_USDT * (lossPct / 100.0); // e.g. -$1.50 USDT

    totalGrossLossUsdt += Math.abs(lossUsdt);

    slBreakdownList.push({
      num: idx + 1,
      tradeId: t.tradeIndex,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      buyPrice: parseFloat(buyPrice.toFixed(2)),
      sellPrice: parseFloat(sellPrice.toFixed(2)),
      lossPct: parseFloat(lossPct.toFixed(2)),
      lossUsdt: parseFloat(lossUsdt.toFixed(2))
    });
  });

  const netProfitUsdt = totalGrossProfitUsdt - totalGrossLossUsdt;
  const netReturnOnAccount = ((netProfitUsdt / POSITION_SIZE_USDT) * 100).toFixed(2);

  console.log("\n================================================================================");
  console.log("💵 PROFIT & LOSS SUMMARY (1-YEAR GOLD SIMULATION)");
  console.log("================================================================================");
  console.log(`🟢 TOTAL WINNING TRADES (+0.40% TP): ${totalTpHits} Trades`);
  console.log(`   - Profit per Win ($100 Capital): +$${profitPerWinUsdt.toFixed(2)} USDT`);
  console.log(`   - TOTAL GROSS PROFIT ACCUMULATED: +$${totalGrossProfitUsdt.toFixed(2)} USDT`);

  console.log(`\n🚨 TOTAL EMERGENCY SL TRADES (RSI <= 20.0): ${rsiSlTrades.length} Trades`);
  console.log(`   - Avg Loss per SL Trade: -$${(totalGrossLossUsdt / rsiSlTrades.length).toFixed(2)} USDT (${((totalGrossLossUsdt / rsiSlTrades.length) / POSITION_SIZE_USDT * 100).toFixed(2)}%)`);
  console.log(`   - TOTAL GROSS LOSS DEDUCTED: -$${totalGrossLossUsdt.toFixed(2)} USDT`);

  console.log(`\n🏆 NET BOTTOM-LINE PROFIT: +$${netProfitUsdt.toFixed(2)} USDT`);
  console.log(`   - Net Return on Capital: +${netReturnOnAccount}% Net Growth!`);

  console.log("\n================================================================================");
  console.log("📜 ITEM-BY-ITEM BREAKDOWN OF ALL 30 EMERGENCY SL TRADES (RSI <= 20.0)");
  console.log("================================================================================");
  slBreakdownList.forEach((t) => {
    console.log(`[#${t.num}] Trade #${t.tradeId} | Entry: ${t.entryTime} @ $${t.buyPrice} | Exit: ${t.exitTime} @ $${t.sellPrice} | Loss: ${t.lossPct}% (-$${Math.abs(t.lossUsdt)} USDT)`);
  });

  const fullBreakdownReport = {
    positionSizeUsdt: POSITION_SIZE_USDT,
    tpTargetPct: TP_PCT,
    totalTpHits,
    profitPerWinUsdt,
    totalGrossProfitUsdt: parseFloat(totalGrossProfitUsdt.toFixed(2)),
    totalRsiSlHits: rsiSlTrades.length,
    totalGrossLossUsdt: parseFloat(totalGrossLossUsdt.toFixed(2)),
    netProfitUsdt: parseFloat(netProfitUsdt.toFixed(2)),
    netReturnOnAccountPct: parseFloat(netReturnOnAccount),
    emergencySlTradesList: slBreakdownList
  };

  fs.writeFileSync(
    path.join(__dirname, 'gold_exact_profit_loss_breakdown_report.json'),
    JSON.stringify(fullBreakdownReport, null, 2)
  );

  console.log("\n✅ Saved complete profit/loss breakdown to backend/gold_exact_profit_loss_breakdown_report.json");
}

calculateGoldProfitLossBreakdown().catch(err => {
  console.error("❌ PnL Breakdown Error:", err);
});
