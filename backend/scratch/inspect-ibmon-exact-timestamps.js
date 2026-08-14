const fs = require('fs');
const path = require('path');

function inspectIbmOrderTimestamps() {
  console.log('🔍 INSPECTING LIVE ORDERS & TIMESTAMPS FOR IBM / IBMONUSDT...\n');

  const files = [
    './backend/data/orders.json',
    './backend/data/stock-orders.json',
    './backend/stock-orders.json',
    './backend/orders.json',
    './backend/test-tok-stock-orders.json'
  ];

  let foundOrders = [];

  files.forEach(fp => {
    if (!fs.existsSync(fp)) return;
    try {
      const content = fs.readFileSync(fp, 'utf8');
      if (!content) return;

      const data = JSON.parse(content);
      if (Array.isArray(data)) {
        data.forEach(ord => {
          const sym = (ord.symbol || '').toUpperCase();
          if (sym.includes('IBM')) {
            foundOrders.push({ file: path.basename(fp), ord });
          }
        });
      }
    } catch (e) {}
  });

  console.log('========================================================================');
  console.log(`📌 FOUND ${foundOrders.length} IBM/IBMON CARD OBJECTS IN LOCAL SYSTEM`);
  console.log('========================================================================\n');

  foundOrders.forEach((item, idx) => {
    const o = item.ord;
    console.log(`[Card #${idx + 1}] ID: ${o.id} | Symbol: ${o.symbol} | Source: ${item.file}`);
    console.log(`   - Status: ${o.status}`);
    console.log(`   - CreatedAt (Card Created): ${o.createdAt || 'N/A'}`);
    console.log(`   - ActivatedAt (Tracking Started): ${o.activatedAt || 'N/A'}`);
    console.log(`   - TriggeredAt (Order Executed): ${o.triggeredAt || 'N/A'}`);
    console.log(`   - DryRun: ${o.dryRun}`);
    console.log(`   - Execution Price: $${o.executionPrice || o.initialPrice}`);
    console.log(`   - Current Price: $${o.currentPrice}\n`);
  });
}

inspectIbmOrderTimestamps();
