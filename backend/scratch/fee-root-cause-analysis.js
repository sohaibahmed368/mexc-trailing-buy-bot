const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const creds = JSON.parse(fs.readFileSync('C:/Users/Hi/.gemini/antigravity/scratch/mexc-trailing-buy-bot/backend/config/credentials.json'));
const api_key = creds.apiKey;
const secret_key = creds.secretKey;

function getSignature(qs) {
  return crypto.createHmac('sha256', secret_key).update(qs).digest('hex');
}

function apiRequest(path, qs) {
  return new Promise((resolve, reject) => {
    const sig = getSignature(qs);
    const options = {
      hostname: 'api.mexc.com', port: 443,
      path: `${path}?${qs}&signature=${sig}`,
      method: 'GET',
      headers: { 'X-MEXC-APIKEY': api_key }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

const COINS = ['ONDOUSDT','BTCUSDT','XRPUSDT','SOLUSDT','ETHUSDT','BNBUSDT','SUIUSDT','UNIUSDT','MXUSDT'];

async function run() {
  const ts = Date.now();

  // Get MX price for MX fee conversion
  const mxTicker = await apiRequest('/api/v3/ticker/price', `symbol=MXUSDT&timestamp=${ts}`);
  const mxPrice = parseFloat(mxTicker.price) || 0;
  console.log(`MX/USDT Price: $${mxPrice}\n`);

  let grandTotalUsdtFees = 0;
  let grandTotalMxFees = 0;
  let grandTotalMxFeesInUsdt = 0;
  let grandTotalTrades = 0;
  let grandTotalBuyTrades = 0;
  let grandTotalSellTrades = 0;
  let grandTotalBuyVolume = 0;  // in USDT
  let grandTotalSellVolume = 0; // in USDT
  let grandTotalBuyFees = 0;
  let grandTotalSellFees = 0;
  let grandTotalLimitSells = 0;
  let grandTotalMarketSells = 0;
  let grandTotalMarketBuys = 0;
  let grandTotalLimitBuys = 0;

  const coinSummaries = [];

  for (const sym of COINS) {
    const trades = await apiRequest('/api/v3/myTrades', `symbol=${sym}&limit=1000&timestamp=${ts}`);
    if (!Array.isArray(trades) || trades.length === 0) continue;

    trades.sort((a, b) => a.time - b.time);

    let coinUsdtFees = 0;
    let coinMxFees = 0;
    let coinBuyTrades = 0;
    let coinSellTrades = 0;
    let coinBuyVolume = 0;
    let coinSellVolume = 0;
    let coinBuyFees = 0;
    let coinSellFees = 0;
    let coinLimitSells = 0;
    let coinMarketSells = 0;
    let coinMarketBuys = 0;
    let coinLimitBuys = 0;

    // Track buy/sell cycles
    const cycles = [];
    let currentCycle = null;

    for (const t of trades) {
      const fee = parseFloat(t.commission) || 0;
      const feeAsset = t.commissionAsset || '';
      const price = parseFloat(t.price);
      const qty = parseFloat(t.qty);
      const quoteQty = parseFloat(t.quoteQty) || (price * qty);
      const isBuyer = t.isBuyer;
      const isMaker = t.isMaker;

      let feeInUsdt = 0;
      if (feeAsset === 'USDT' || feeAsset === 'USD') {
        feeInUsdt = fee;
        coinUsdtFees += fee;
      } else if (feeAsset === 'MX') {
        feeInUsdt = fee * mxPrice;
        coinMxFees += fee;
      } else {
        // Fee paid in the coin itself (for buys)
        feeInUsdt = fee * price;
        coinUsdtFees += feeInUsdt;
      }

      if (isBuyer) {
        coinBuyTrades++;
        coinBuyVolume += quoteQty;
        coinBuyFees += feeInUsdt;
        if (isMaker) coinLimitBuys++; else coinMarketBuys++;

        // Start new cycle
        if (!currentCycle) {
          currentCycle = { buyFills: [], sellFills: [], totalBuyQty: 0, totalBuyValue: 0, totalSellQty: 0, totalSellValue: 0, totalFees: 0 };
        }
        currentCycle.buyFills.push(t);
        currentCycle.totalBuyQty += qty;
        currentCycle.totalBuyValue += quoteQty;
        currentCycle.totalFees += feeInUsdt;
      } else {
        coinSellTrades++;
        coinSellVolume += quoteQty;
        coinSellFees += feeInUsdt;
        if (isMaker) coinLimitSells++; else coinMarketSells++;

        if (currentCycle) {
          currentCycle.sellFills.push(t);
          currentCycle.totalSellQty += qty;
          currentCycle.totalSellValue += quoteQty;
          currentCycle.totalFees += feeInUsdt;

          // If sold roughly what was bought, close cycle
          if (currentCycle.totalSellQty >= currentCycle.totalBuyQty * 0.95) {
            const pnl = currentCycle.totalSellValue - currentCycle.totalBuyValue;
            const netPnl = pnl - currentCycle.totalFees;
            currentCycle.grossPnl = pnl;
            currentCycle.netPnl = netPnl;
            currentCycle.avgBuyPrice = currentCycle.totalBuyValue / currentCycle.totalBuyQty;
            currentCycle.avgSellPrice = currentCycle.totalSellValue / currentCycle.totalSellQty;
            cycles.push(currentCycle);
            currentCycle = null;
          }
        }
      }
    }

    // If there's an unclosed cycle (open position)
    if (currentCycle) {
      currentCycle.open = true;
      currentCycle.avgBuyPrice = currentCycle.totalBuyValue / currentCycle.totalBuyQty;
      cycles.push(currentCycle);
    }

    const coinTotalFees = coinUsdtFees + (coinMxFees * mxPrice);

    coinSummaries.push({
      symbol: sym,
      totalTrades: trades.length,
      buyTrades: coinBuyTrades,
      sellTrades: coinSellTrades,
      marketBuys: coinMarketBuys,
      limitBuys: coinLimitBuys,
      marketSells: coinMarketSells,
      limitSells: coinLimitSells,
      buyVolume: coinBuyVolume,
      sellVolume: coinSellVolume,
      buyFees: coinBuyFees,
      sellFees: coinSellFees,
      usdtFees: coinUsdtFees,
      mxFees: coinMxFees,
      totalFeesUsdt: coinTotalFees,
      cycles,
      firstTradeDate: new Date(trades[0].time).toISOString(),
      lastTradeDate: new Date(trades[trades.length-1].time).toISOString()
    });

    grandTotalTrades += trades.length;
    grandTotalBuyTrades += coinBuyTrades;
    grandTotalSellTrades += coinSellTrades;
    grandTotalBuyVolume += coinBuyVolume;
    grandTotalSellVolume += coinSellVolume;
    grandTotalBuyFees += coinBuyFees;
    grandTotalSellFees += coinSellFees;
    grandTotalUsdtFees += coinUsdtFees;
    grandTotalMxFees += coinMxFees;
    grandTotalMxFeesInUsdt += coinMxFees * mxPrice;
    grandTotalLimitSells += coinLimitSells;
    grandTotalMarketSells += coinMarketSells;
    grandTotalMarketBuys += coinMarketBuys;
    grandTotalLimitBuys += coinLimitBuys;
  }

  // ============ PRINT REPORT ============
  console.log('='.repeat(90));
  console.log('   MEXC BOT TRADE BEHAVIOR & FEE ROOT-CAUSE ANALYSIS');
  console.log('='.repeat(90));

  console.log('\n--- GRAND TOTALS ---');
  console.log(`Total Trades: ${grandTotalTrades}`);
  console.log(`  Buy Trades:  ${grandTotalBuyTrades} (Market: ${grandTotalMarketBuys}, Limit: ${grandTotalLimitBuys})`);
  console.log(`  Sell Trades: ${grandTotalSellTrades} (Market: ${grandTotalMarketSells}, Limit: ${grandTotalLimitSells})`);
  console.log(`Total Buy Volume:  $${grandTotalBuyVolume.toFixed(2)} USDT`);
  console.log(`Total Sell Volume: $${grandTotalSellVolume.toFixed(2)} USDT`);
  console.log(`Total Turnover:    $${(grandTotalBuyVolume + grandTotalSellVolume).toFixed(2)} USDT`);
  console.log(`\nFees on BUY side:  $${grandTotalBuyFees.toFixed(4)} USDT`);
  console.log(`Fees on SELL side: $${grandTotalSellFees.toFixed(4)} USDT`);
  console.log(`USDT Fees Total:   $${grandTotalUsdtFees.toFixed(4)} USDT`);
  console.log(`MX Fees Total:     ${grandTotalMxFees.toFixed(4)} MX (= $${grandTotalMxFeesInUsdt.toFixed(4)} USDT)`);
  console.log(`GRAND TOTAL FEES:  $${(grandTotalUsdtFees + grandTotalMxFeesInUsdt).toFixed(4)} USDT`);

  const avgFeePerTrade = (grandTotalUsdtFees + grandTotalMxFeesInUsdt) / grandTotalTrades;
  const avgFeePercentOfTurnover = ((grandTotalUsdtFees + grandTotalMxFeesInUsdt) / (grandTotalBuyVolume + grandTotalSellVolume)) * 100;
  console.log(`\nAvg Fee Per Trade:       $${avgFeePerTrade.toFixed(4)} USDT`);
  console.log(`Fee as % of Turnover:    ${avgFeePercentOfTurnover.toFixed(4)}%`);

  console.log('\n' + '='.repeat(90));
  console.log('   PER-COIN BREAKDOWN');
  console.log('='.repeat(90));

  for (const cs of coinSummaries) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  ${cs.symbol}`);
    console.log(`${'─'.repeat(70)}`);
    console.log(`  Trades: ${cs.totalTrades} (Buy: ${cs.buyTrades}, Sell: ${cs.sellTrades})`);
    console.log(`  Market Buys: ${cs.marketBuys}  |  Limit Buys: ${cs.limitBuys}`);
    console.log(`  Market Sells: ${cs.marketSells}  |  Limit Sells (TP): ${cs.limitSells}`);
    console.log(`  Buy Volume:  $${cs.buyVolume.toFixed(2)}  |  Sell Volume: $${cs.sellVolume.toFixed(2)}`);
    console.log(`  Buy Fees:    $${cs.buyFees.toFixed(4)}  |  Sell Fees: $${cs.sellFees.toFixed(4)}`);
    console.log(`  Total Fees:  $${cs.totalFeesUsdt.toFixed(4)} (USDT: $${cs.usdtFees.toFixed(4)}, MX: ${cs.mxFees.toFixed(4)})`);
    console.log(`  Period: ${cs.firstTradeDate} → ${cs.lastTradeDate}`);

    if (cs.cycles.length > 0) {
      console.log(`  Completed Cycles: ${cs.cycles.filter(c => !c.open).length} | Open: ${cs.cycles.filter(c => c.open).length}`);
      let cycleIdx = 0;
      for (const cy of cs.cycles) {
        cycleIdx++;
        if (cy.open) {
          console.log(`    Cycle #${cycleIdx} [OPEN]: Bought $${cy.totalBuyValue.toFixed(2)} at avg $${cy.avgBuyPrice.toFixed(6)}, Fees: $${cy.totalFees.toFixed(4)}`);
        } else {
          const winLoss = cy.netPnl >= 0 ? 'WIN' : 'LOSS';
          console.log(`    Cycle #${cycleIdx} [${winLoss}]: Buy $${cy.totalBuyValue.toFixed(2)} @ $${cy.avgBuyPrice.toFixed(6)} → Sell $${cy.totalSellValue.toFixed(2)} @ $${cy.avgSellPrice.toFixed(6)} | Gross P/L: $${cy.grossPnl.toFixed(4)} | Fees: $${cy.totalFees.toFixed(4)} | Net: $${cy.netPnl.toFixed(4)}`);
        }
      }
    }
  }

  // ============ ROOT CAUSE ANALYSIS ============
  console.log('\n' + '='.repeat(90));
  console.log('   ROOT CAUSE ANALYSIS: WHY FEES > PROFITS');
  console.log('='.repeat(90));

  // Calculate: how many cycles were net-loss after fees
  let totalCompletedCycles = 0;
  let netWinCycles = 0;
  let netLossCycles = 0;
  let totalGrossProfit = 0;
  let totalCycleFees = 0;

  for (const cs of coinSummaries) {
    for (const cy of cs.cycles) {
      if (cy.open) continue;
      totalCompletedCycles++;
      totalGrossProfit += cy.grossPnl;
      totalCycleFees += cy.totalFees;
      if (cy.netPnl >= 0) netWinCycles++; else netLossCycles++;
    }
  }

  console.log(`\nCompleted Buy→Sell Cycles: ${totalCompletedCycles}`);
  console.log(`  Net Winners (after fees): ${netWinCycles}`);
  console.log(`  Net Losers  (after fees): ${netLossCycles}`);
  console.log(`  Win Rate: ${totalCompletedCycles > 0 ? ((netWinCycles/totalCompletedCycles)*100).toFixed(1) : 0}%`);
  console.log(`  Total Gross P/L (before fees): $${totalGrossProfit.toFixed(4)}`);
  console.log(`  Total Cycle Fees:              $${totalCycleFees.toFixed(4)}`);
  console.log(`  Total Net P/L (after fees):    $${(totalGrossProfit - totalCycleFees).toFixed(4)}`);

  // Key insight: volume churning
  const totalTurnover = grandTotalBuyVolume + grandTotalSellVolume;
  console.log(`\n--- KEY INSIGHT: VOLUME CHURNING ---`);
  console.log(`Your portfolio is $2,000 USDT.`);
  console.log(`Total traded volume (turnover): $${totalTurnover.toFixed(2)} USDT`);
  console.log(`Turnover-to-Capital Ratio: ${(totalTurnover / 2000).toFixed(1)}x`);
  console.log(`This means your $2,000 has been recycled ${(totalTurnover / 2000).toFixed(1)} times through buy+sell trades.`);
  console.log(`At 0.05% taker fee per side, each full round-trip costs 0.10% of trade value.`);
  console.log(`Expected fees from turnover: $${(totalTurnover * 0.0005).toFixed(2)} USDT (at 0.05% flat rate)`);
  console.log(`Actual fees: $${(grandTotalUsdtFees + grandTotalMxFeesInUsdt).toFixed(2)} USDT`);

  // Stop-loss analysis
  let slCycles = 0;
  let slFees = 0;
  for (const cs of coinSummaries) {
    for (const cy of cs.cycles) {
      if (cy.open) continue;
      if (cy.grossPnl < -0.01) { // Loss cycles = stop loss hits
        slCycles++;
        slFees += cy.totalFees;
      }
    }
  }
  console.log(`\n--- STOP LOSS IMPACT ---`);
  console.log(`Stop Loss cycles (loss cycles): ${slCycles}`);
  console.log(`Fees burned in SL cycles: $${slFees.toFixed(4)} USDT`);
  console.log(`These are "wasted" fees — you paid to buy AND sell, but ended at a loss.`);

  // Market buy fee problem
  console.log(`\n--- ORDER TYPE FEE IMPACT ---`);
  console.log(`Market Orders (Taker 0.05%): ${grandTotalMarketBuys + grandTotalMarketSells} trades`);
  console.log(`Limit Orders (Maker 0%):     ${grandTotalLimitBuys + grandTotalLimitSells} trades`);
  const makerPct = ((grandTotalLimitBuys + grandTotalLimitSells) / grandTotalTrades * 100).toFixed(1);
  const takerPct = ((grandTotalMarketBuys + grandTotalMarketSells) / grandTotalTrades * 100).toFixed(1);
  console.log(`Taker %: ${takerPct}%  |  Maker %: ${makerPct}%`);

  // Recommendations
  console.log(`\n${'='.repeat(90)}`);
  console.log(`   RECOMMENDATIONS TO REDUCE FEES`);
  console.log(`${'='.repeat(90)}`);
  console.log(`1. PROBLEM: Every BUY is a MARKET order (Taker 0.05% fee).`);
  console.log(`   FIX: Use LIMIT BUY orders instead. Maker fee on MEXC = 0%.`);
  console.log(`   SAVINGS: $${grandTotalBuyFees.toFixed(2)} would become $0.00 if all buys were Limit/Maker.`);
  console.log(``);
  console.log(`2. PROBLEM: Stop Loss sells are MARKET orders (Taker 0.05% fee).`);
  console.log(`   This is unavoidable for SL (you need immediate execution).`);
  console.log(`   But the BUY that preceded the SL was ALSO a Market order.`);
  console.log(`   So each SL cycle = 2x Taker fees for a net LOSS trade.`);
  console.log(``);
  console.log(`3. PROBLEM: Take Profit sells are LIMIT orders (Maker 0% fee) ✅`);
  console.log(`   This is correct and efficient. No change needed for TP sells.`);
  console.log(``);
  console.log(`4. PROBLEM: High trade frequency = high cumulative fees.`);
  console.log(`   ${grandTotalTrades} trades in ~3.5 days = ~${Math.round(grandTotalTrades/3.5)} trades/day.`);
  console.log(`   Consider increasing trail value or TP margin to reduce cycle count.`);
  console.log(``);
  console.log(`5. SUMMARY OF POTENTIAL SAVINGS:`);
  console.log(`   If BUYs were LIMIT (Maker 0%): Save $${grandTotalBuyFees.toFixed(2)} USDT`);
  console.log(`   Remaining fees (SL Market Sells only): $${grandTotalSellFees.toFixed(2)} USDT`);
  console.log(`   Net savings: ${((grandTotalBuyFees / (grandTotalUsdtFees + grandTotalMxFeesInUsdt))*100).toFixed(0)}% of total fees eliminated!`);
}

run().catch(console.error);
