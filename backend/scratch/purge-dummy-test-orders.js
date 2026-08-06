const fs = require('fs');
const path = require('path');

const ordersPath = path.join(__dirname, '..', 'data', 'orders.json');

async function purgeDummyTestOrders() {
  console.log("================================================================================");
  console.log("🧹 PURGING DUMMY TEST OBJECTS FROM ORDERS.JSON STORAGE");
  console.log("================================================================================");

  if (!fs.existsSync(ordersPath)) {
    console.log("Orders file not found.");
    return;
  }

  let orders = [];
  try {
    orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  } catch (e) {
    console.error("Error parsing orders.json:", e.message);
    return;
  }

  console.log(`Initial order count in orders.json: ${orders.length}`);

  // Keep ONLY real user created cards (e.g. ord_... or cards created from UI)
  // Remove dummy test IDs: test_no_sl, test_sl_active, test-eth-card-001, test-nvdaon-card-001
  const cleanOrders = orders.filter(o => {
    if (!o.id) return false;
    if (o.id.startsWith('test_') || o.id.startsWith('test-')) return false;
    return true;
  });

  console.log(`Cleaned order count: ${cleanOrders.length}`);
  fs.writeFileSync(ordersPath, JSON.stringify(cleanOrders, null, 2));
  console.log("✅ Successfully purged dummy test objects from data/orders.json!");
}

purgeDummyTestOrders().catch(console.error);
