/**
 * MEXC Trade History & Fee Audit Script
 * Fetches ALL trades from MEXC API since last 7 days
 * Shows exact trade count and fee breakdown per symbol and side (BUY/SELL)
 * 
 * Usage: node backend/audit-mexc-fees.js
 */

const path = require('path');
const fs   = require('fs');
const MexcClient = require('./mexc-client');

// ─── Load API credentials same way server does ────────────────────────────────
let apiKey    = process.env.MEXC_API_KEY    || '';
let secretKey = process.env.MEXC_SECRET_KEY || '';

if (!apiKey || !secretKey) {
  // Fallback: read from saved credentials file
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
  console.error('❌ No API credentials found. Set MEXC_API_KEY / MEXC_SECRET_KEY env vars or save credentials via the bot UI first.');
  process.exit(1);
}

const client = new MexcClient(apiKey, secretKey);

// ─── Load all symbols from orders.json ────────────────────────────────────────
const ordersPath = path.join(__dirname, 'data', 'orders.json');
let symbolsFromOrders = new Set();
try {
  const orders = JSON.parse(fs.readFileSync(ordersPath, 'utf8'));
  orders.forEach(o => {
    if (o.symbol) symbolsFromOrders.add(o.symbol.toUpperCase());
  });
} catch(e) {}

// ─── Date filter: 4 days ago (user said "4 din pehle se API connect hui") ─────
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const sinceTimestamp = Date.now() - FOUR_DAYS_MS;
const sinceDate = new Date(sinceTimestamp).toISOString();

// ─── Main Audit ───────────────────────────────────────────────────────────────
async function audit() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('          MEXC TRADE HISTORY & FEE AUDIT');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Auditing trades since: ${sinceDate}`);
  console.log(`  Symbols to check: ${[...symbolsFromOrders].join(', ') || 'none found in orders.json'}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (symbolsFromOrders.size === 0) {
    console.error('❌ No symbols found in orders.json. Cannot audit.');
    process.exit(1);
  }

  let grandTotalTrades = 0;
  let grandTotalFeesUsdt = 0;
  let grandTotalFeesMx   = 0;
  let grandBuyTrades  = 0;
  let grandSellTrades = 0;
  let grandBuyFeesUsdt  = 0;
  let grandSellFeesUsdt = 0;
  let grandMakerTrades  = 0;
  let grandTakerTrades  = 0;

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

    // Filter to last 4 days
    const filtered = trades.filter(t => parseInt(t.time || t.timestamp || 0) >= sinceTimestamp);
    console.log(`${filtered.length} trades (${trades.length} total on account)`);

    if (filtered.length === 0) continue;

    let symFeesUsdt = 0;
    let symFeesMx   = 0;
    let symBuyCount  = 0;
    let symSellCount = 0;
    let symBuyFees   = 0;
    let symSellFees  = 0;
    let symMaker = 0;
    let symTaker = 0;

    filtered.forEach(t => {
      const fee       = parseFloat(t.commission       || 0);
      const feeAsset  = (t.commissionAsset            || '').toUpperCase();
      const side      = (t.side                       || '').toUpperCase();
      const isMaker   = t.isMaker === true || t.isMaker === 'true';

      if (feeAsset === 'USDT') symFeesUsdt += fee;
      else if (feeAsset === 'MX') symFeesMx += fee;

      if (side === 'BUY') {
        symBuyCount++;
        if (feeAsset === 'USDT') symBuyFees += fee;
      } else {
        symSellCount++;
        if (feeAsset === 'USDT') symSellFees += fee;
      }

      if (isMaker) symMaker++;
      else symTaker++;
    });

    symbolSummaries.push({
      symbol, count: filtered.length,
      buyCount: symBuyCount, sellCount: symSellCount,
      feesUsdt: symFeesUsdt, feesMx: symFeesMx,
      buyFees: symBuyFees, sellFees: symSellFees,
      maker: symMaker, taker: symTaker
    });

    grandTotalTrades  += filtered.length;
    grandTotalFeesUsdt += symFeesUsdt;
    grandTotalFeesMx  += symFeesMx;
    grandBuyTrades    += symBuyCount;
    grandSellTrades   += symSellCount;
    grandBuyFeesUsdt  += symBuyFees;
    grandSellFeesUsdt += symSellFees;
    grandMakerTrades  += symMaker;
    grandTakerTrades  += symTaker;
  }

  // ─── Per-Symbol Table ──────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────────────────────────────');
  console.log('  PER-SYMBOL BREAKDOWN');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('  Symbol          | Trades | BUY  | SELL | Maker| Taker| USDT Fees   | MX Fees');
  console.log('  ─────────────────────────────────────────────────────────────────────────────');

  symbolSummaries.forEach(s => {
    const sym   = s.symbol.padEnd(14);
    const cnt   = String(s.count).padStart(6);
    const buy   = String(s.buyCount).padStart(4);
    const sell  = String(s.sellCount).padStart(4);
    const maker = String(s.maker).padStart(5);
    const taker = String(s.taker).padStart(5);
    const uFee  = s.feesUsdt.toFixed(6).padStart(11);
    const mFee  = s.feesMx.toFixed(6).padStart(8);
    console.log(`  ${sym} | ${cnt} | ${buy} | ${sell} | ${maker}| ${taker}| ${uFee} | ${mFee}`);
  });

  // ─── Grand Total ──────────────────────────────────────────────────────────
  let mxPrice = 1.65;
  try {
    const p = await client.getTickerPrice('MXUSDT');
    if (p) mxPrice = parseFloat(p);
  } catch(e) {}
  const totalFeesInUsdt = grandTotalFeesUsdt + (grandTotalFeesMx * mxPrice);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  GRAND TOTAL SINCE API CONNECTED (last 4 days)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Total Trades    : ${grandTotalTrades}`);
  console.log(`  ├─ BUY  orders  : ${grandBuyTrades}`);
  console.log(`  └─ SELL orders  : ${grandSellTrades}`);
  console.log(`  Maker trades    : ${grandMakerTrades}  (fee = 0.04% OR 0% if MX discount)`);
  console.log(`  Taker trades    : ${grandTakerTrades}  (fee = 0% on your MEXC promotion)`);
  console.log(`\n  ── FEES ────────────────────────────────────────────`);
  console.log(`  USDT Fees Paid  : ${grandTotalFeesUsdt.toFixed(6)} USDT`);
  console.log(`  ├─ BUY  side    : ${grandBuyFeesUsdt.toFixed(6)} USDT`);
  console.log(`  └─ SELL side    : ${grandSellFeesUsdt.toFixed(6)} USDT`);
  console.log(`  MX Fees Paid    : ${grandTotalFeesMx.toFixed(6)} MX`);
  console.log(`  MX Price (live) : ${mxPrice} USDT`);
  console.log(`  MX in USDT      : ${(grandTotalFeesMx * mxPrice).toFixed(6)} USDT`);
  console.log(`\n  ╔═══════════════════════════════════════════════════`);
  console.log(`  ║  TOTAL FEES PAID = ${totalFeesInUsdt.toFixed(6)} USDT`);
  console.log(`  ╚═══════════════════════════════════════════════════`);
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

audit().catch(e => {
  console.error('❌ Audit failed:', e.message);
  process.exit(1);
});
