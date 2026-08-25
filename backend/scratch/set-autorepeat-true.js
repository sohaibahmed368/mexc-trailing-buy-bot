const fs = require('fs');
const path = require('path');

const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');
const seedPath = path.join(__dirname, '..', 'seed-orders.json');

[ordersPath, seedPath].forEach(filePath => {
  if (fs.existsSync(filePath)) {
    const orders = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    orders.forEach(o => {
      o.autoRepeat = true; // Enforce autoRepeat: true across all cards!
    });
    fs.writeFileSync(filePath, JSON.stringify(orders, null, 2), 'utf8');
    console.log(`✅ Set autoRepeat: true for all ${orders.length} cards in ${path.basename(filePath)}!`);
  }
});
