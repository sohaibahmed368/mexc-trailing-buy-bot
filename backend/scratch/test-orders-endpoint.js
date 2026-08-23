const MexcTracker = require('../tracker');
const path = require('path');

const tracker = new MexcTracker();
const orders = tracker.getOrders();

console.log('Total Orders returned by tracker.getOrders():', orders.length);
orders.forEach((o, i) => {
  console.log(`Card ${i + 1}: ${o.symbol} | Status: ${o.status} | TP: ${o.takeProfit}% | Price: ${o.currentPrice}`);
});
