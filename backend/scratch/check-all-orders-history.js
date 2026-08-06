const fs = require('fs');
const path = require('path');

const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');

if (fs.existsSync(ordersPath)) {
  const content = fs.readFileSync(ordersPath, 'utf8');
  console.log(content);
}
