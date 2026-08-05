const fs = require('fs');
const path = require('path');
const MexcClient = require('../mexc-client');

async function auditLiveLossesAndIndicators() {
  console.log('================================================================================');
  console.log('🔬 DEEP FORENSIC AUDIT — LIVE LOSS ROOT CAUSE & INDICATOR EVALUATION');
  console.log('================================================================================\n');

  const ordersPath = path.join(__dirname, '../data/orders.json');
  const logsPath = path.join(__dirname, '../data/logs.json');

  let orders = [];
  let logs = [];

  if (fs.existsSync(ordersPath)) {
    try { orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8')); } catch (e) {}
  }
  if (fs.existsSync(logsPath)) {
    try { logs = JSON.parse(fs.readFileSync(logsPath, 'utf8')); } catch (e) {}
  }

  console.log(`Total Orders in orders.json: ${orders.length}`);
  console.log(`Total Logs in logs.json: ${logs.length}\n`);

  let allTrades = [];
  let winCount = 0;
  let lossCount = 0;
  let totalNetPnl = 0;

  orders.forEach(order => {
    if (Array.isArray(order.tradeHistory) && order.tradeHistory.length > 0) {
      order.tradeHistory.forEach(t => {
        const tradeObj = {
          symbol: order.symbol,
          cycle: t.cycle,
          buyPrice: t.buyPrice,
          sellPrice: t.sellPrice,
          profitUsdt: t.profitUsdt || 0,
          grossProfitUsdt: t.grossProfitUsdt || 0,
          mexcFeesUsdt: t.totalMexcFeesUsdt || 0,
          type: t.type,
          timestamp: t.timestamp,
          cardConfig: {
            takeProfit: order.takeProfit,
            stopLoss: order.stopLoss,
            filterSmartSl: order.filterSmartSl,
            filterObi: order.filterObi,
            filterVolume: order.filterVolume,
            filterRsi: order.filterRsi,
            filter40sVolume: order.filter40sVolume,
            adaptiveSlMode: order.adaptiveSlMode,
            dryRun: order.dryRun
          }
        };

        allTrades.push(tradeObj);
        if (tradeObj.profitUsdt > 0) winCount++;
        else if (tradeObj.profitUsdt < 0) lossCount++;
        totalNetPnl += tradeObj.profitUsdt;
      });
    }
  });

  allTrades.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

  console.log('--------------------------------------------------------------------------------');
  console.log('📊 RECORDED TRADE HISTORY BREAKDOWN:');
  console.log('--------------------------------------------------------------------------------');
  console.log(`Total Trades: ${allTrades.length} | Wins: 🟢 ${winCount} | Losses: 🔴 ${lossCount} | Net PnL: $${totalNetPnl.toFixed(4)} USDT\n`);

  allTrades.forEach((t, i) => {
    const statusIcon = t.profitUsdt > 0 ? '🟢 WIN ' : (t.profitUsdt < 0 ? '🔴 LOSS' : '⚪ EVEN');
    console.log(`[Trade #${i + 1}] ${t.symbol} | Status: ${statusIcon} | Type: ${t.type}`);
    console.log(`          Buy: $${(t.buyPrice || 0).toFixed(4)} -> Sell: $${(t.sellPrice || 0).toFixed(4)} | PnL: $${t.profitUsdt.toFixed(4)} USDT`);
    console.log(`          Time: ${t.timestamp}`);
    console.log(`          Card Config: TP=${t.cardConfig.takeProfit}%, SL=${t.cardConfig.stopLoss}%, SmartSL=${t.cardConfig.filterSmartSl}, RSIFilter=${t.cardConfig.filterRsi}, VolFilter=${t.cardConfig.filterVolume}\n`);
  });

  // Query MEXC Real Trade History directly for active credentials
  const configPath = path.join(__dirname, '../config/credentials.json');
  if (fs.existsSync(configPath)) {
    try {
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (savedConfig.apiKey && savedConfig.secretKey) {
        const mexcClient = new MexcClient(savedConfig.apiKey, savedConfig.secretKey);
        await mexcClient.syncTimeOffset();

        console.log('--------------------------------------------------------------------------------');
        console.log('🌐 DIRECT MEXC EXCHANGE TRADE HISTORY AUDIT (LIVE ACCOUNT):');
        console.log('--------------------------------------------------------------------------------');

        const activeSymbols = [...new Set(orders.map(o => o.symbol))];
        for (const sym of activeSymbols) {
          try {
            const trades = await mexcClient.getMyTrades(sym, 10);
            if (Array.isArray(trades) && trades.length > 0) {
              console.log(`📌 MEXC Account Fills for ${sym} (Last ${trades.length} trades):`);
              trades.slice(-5).forEach(tr => {
                const side = tr.isBuyer ? 'BUY ' : 'SELL';
                console.log(`   - [${new Date(tr.time).toISOString()}] ${side} Qty: ${tr.qty} @ Price: $${tr.price} USDT (Fee: ${tr.commission} ${tr.commissionAsset})`);
              });
              console.log('');
            }
          } catch (tErr) {
            console.log(`   - ${sym}: ${tErr.message}`);
          }
        }
      }
    } catch (e) {
      console.log(`Could not load credentials for live exchange query: ${e.message}`);
    }
  }

  console.log('================================================================================');
}

auditLiveLossesAndIndicators().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
