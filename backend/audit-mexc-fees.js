/**
 * MEXC Trade History & Fee Audit Script v2
 * - Counts ALL commissions in ALL assets (SOL, ETH, BTC, USDT, MX, etc.)
 * - Converts all to USDT equivalent using live prices
 * - Shows raw first trade to verify field structure
 * - Uses isBuyerMaker field for side detection fallback
 * 
 * Usage: node backend/audit-mexc-fees.js
 */

const path = require('path');
const fs   = require('fs');
const MexcClient = require('./mexc-client');

// ─── Load API credentials ─────────────────────────────────────────────────────
let apiKey    = process.env.MEXC_API_KEY    || '';
let secretKey = process.env.MEXC_SECRET_KEY || '';

if (!apiKey || !secretKey) {
  const credPath = path.join(__dirname, 'config', 'credentials.json');
  if (fs.existsSync(credPath)) {
    try {
      const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      apiKey    = cred.apiKey    || '';
      secretKey = cred.secretKey || '';
    } catch(e) {}
  }
}

if (!apiKey || !secretKey) {
  console.error('❌ No API credentials found.');
  process.exit(1);
}

const client = new MexcClient(apiKey, secretKey);

// ─── Load symbols from orders.json ────────────────────────────────────────────
const ordersPath = path.join(__dirname, 'data', 'orders.json');
let symbolsFromOrders = new Set();
try {
  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  orders.forEach(o => {
    if (o.symbol) symbolsFromOrders.add(o.symbol.toUpperCase());
  });
} catch(e) {}

// Last 4 days filter
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const sinceTimestamp = Date.now() - FOUR_DAYS_MS;

// ─── Helper: get price of any asset in USDT ──────────────────────────────────
const priceCache = {};
async function getUsdtPrice(asset) {
  asset = asset.toUpperCase();
  if (asset === 'USDT') return 1;
  if (priceCache[asset]) return priceCache[asset];
  try {
    const p = await client.getTickerPrice(`${asset}USDT`);
    priceCache[asset] = parseFloat(p) || 0;
  } catch(e) {
    priceCache[asset] = 0;
  }
  return priceCache[asset];
}

// ─── Main Audit ───────────────────────────────────────────────────────────────
async function audit() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('     MEXC TRADE HISTORY & FEE AUDIT v2 (ALL ASSETS)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Auditing since: ${new Date(sinceTimestamp).toISOString()}`);
  console.log(`  Symbols: ${[...symbolsFromOrders].join(', ')}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (symbolsFromOrders.size === 0) {
    console.error('❌ No symbols found in orders.json'); process.exit(1);
  }

  let rawSampleShown = false;
  let grandTotal = 0, grandBuy = 0, grandSell = 0;
  let grandMaker = 0, grandTaker = 0;
  let grandFeesUsdtEquiv = 0;

  // Fees by asset
  const feesByAsset = {};

  const symbolSummaries = [];

  for (const symbol of symbolsFromOrders) {
    process.stdout.write(`  Fetching ${symbol} ... `);
    let trades = [];
    try {
      trades = await client.getMyTrades(symbol, 1000);
      if (!Array.isArray(trades)) trades = [];
    } catch(e) {
      console.log(`SKIPPED (${e.message})`);
      continue;
    }

    // Show raw first trade structure once for debugging
    if (!rawSampleShown && trades.length > 0) {
      rawSampleShown = true;
      console.log('\n  [DEBUG] Raw first trade fields from MEXC API:');
      const sample = trades[0];
      Object.keys(sample).forEach(k => console.log(`    ${k}: ${JSON.stringify(sample[k])}`));
      console.log();
    }

    const filtered = trades.filter(t => {
      const ts = parseInt(t.time || t.timestamp || t.tradeTime || 0);
      return ts >= sinceTimestamp;
    });

    console.log(`${filtered.length} trades (${trades.length} total on account)`);
    if (filtered.length === 0) continue;

    let symFeeUsdt = 0;
    let symBuy = 0, symSell = 0, symMaker = 0, symTaker = 0;
    const symFeesByAsset = {};

    for (const t of filtered) {
      const fee      = parseFloat(t.commission || t.fee || 0);
      const feeAsset = (t.commissionAsset || t.feeAsset || '').toUpperCase();
      
      // Side detection: try 'side' field, fallback to isBuyerMaker
      let side = (t.side || '').toUpperCase();
      if (!side || (side !== 'BUY' && side !== 'SELL')) {
        // MEXC may use isBuyerMaker: true means this trade was the buyer (BUY side)
        if (t.isBuyerMaker !== undefined) {
          side = t.isBuyerMaker ? 'SELL' : 'BUY';  // isBuyerMaker=true means buyer made the order (limit buy = maker)
          // Actually: isBuyerMaker = was buyer the maker? If true = limit buy order filled (maker buy)
          // Let's just log the raw value
        }
      }

      if (side === 'BUY') symBuy++;
      else if (side === 'SELL') symSell++;

      // Maker/Taker detection
      const isMaker = t.isMaker === true || t.isMaker === 'true' || 
                      (t.isBuyerMaker !== undefined && (
                        (side === 'BUY' && t.isBuyerMaker) || 
                        (side === 'SELL' && !t.isBuyerMaker)
                      ));
      if (isMaker) symMaker++;
      else symTaker++;

      // Count all fees in their native asset
      if (fee > 0 && feeAsset) {
        symFeesByAsset[feeAsset] = (symFeesByAsset[feeAsset] || 0) + fee;
        feesByAsset[feeAsset]    = (feesByAsset[feeAsset]    || 0) + fee;
      }
    }

    // Convert symbol fees to USDT
    for (const [asset, amount] of Object.entries(symFeesByAsset)) {
      const price = await getUsdtPrice(asset);
      symFeeUsdt += amount * price;
    }

    symbolSummaries.push({
      symbol, count: filtered.length,
      buyCount: symBuy, sellCount: symSell,
      maker: symMaker, taker: symTaker,
      feesByAsset: symFeesByAsset,
      feeUsdtEquiv: symFeeUsdt
    });

    grandTotal += filtered.length;
    grandBuy   += symBuy;
    grandSell  += symSell;
    grandMaker += symMaker;
    grandTaker += symTaker;
    grandFeesUsdtEquiv += symFeeUsdt;
  }

  // ─── Per-Symbol Table ─────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────────────────');
  console.log('  PER-SYMBOL BREAKDOWN');
  console.log('─────────────────────────────────────────────────────────────────────');

  for (const s of symbolSummaries) {
    console.log(`\n  ${s.symbol}`);
    console.log(`    Trades : ${s.count}  (BUY: ${s.buyCount}, SELL: ${s.sellCount})`);
    console.log(`    Maker  : ${s.maker}  |  Taker: ${s.taker}`);
    console.log(`    Fees by asset:`);
    for (const [asset, amount] of Object.entries(s.feesByAsset)) {
      const price = await getUsdtPrice(asset);
      const usdt  = (amount * price).toFixed(6);
      console.log(`      ${asset.padEnd(6)} : ${amount.toFixed(6)} (≈ ${usdt} USDT @ ${price})`);
    }
    console.log(`    Total  : ≈ ${s.feeUsdtEquiv.toFixed(6)} USDT`);
  }

  // ─── Grand Total ─────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  GRAND TOTAL (last 4 days — ALL assets converted to USDT)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Trades    : ${grandTotal}`);
  console.log(`  ├─ BUY  orders  : ${grandBuy}`);
  console.log(`  └─ SELL orders  : ${grandSell}`);
  console.log(`  Maker trades    : ${grandMaker}`);
  console.log(`  Taker trades    : ${grandTaker}`);
  console.log(`\n  ── FEES BY ASSET ────────────────────────────────────`);
  for (const [asset, amount] of Object.entries(feesByAsset)) {
    const price = await getUsdtPrice(asset);
    const usdt  = (amount * price).toFixed(6);
    console.log(`  ${asset.padEnd(8)} : ${amount.toFixed(6)}  ≈ ${usdt} USDT`);
  }
  console.log(`\n  ╔═══════════════════════════════════════════════════`);
  console.log(`  ║  TOTAL FEES ≈ ${grandFeesUsdtEquiv.toFixed(6)} USDT`);
  console.log(`  ╚═══════════════════════════════════════════════════`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

audit().catch(e => {
  console.error('❌ Audit failed:', e.message);
  process.exit(1);
});
