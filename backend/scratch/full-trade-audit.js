const fs = require('fs');
const crypto = require('crypto');
const https = require('https');

const creds = JSON.parse(fs.readFileSync('C:/Users/Hi/.gemini/antigravity/scratch/mexc-trailing-buy-bot/backend/config/credentials.json'));
const api_key = creds.apiKey;
const secret_key = creds.secretKey;

function getSignature(queryString) {
  return crypto.createHmac('sha256', secret_key).update(queryString).digest('hex');
}

function request(path, qs) {
  return new Promise((resolve, reject) => {
    const sig = getSignature(qs);
    const options = {
      hostname: 'api.mexc.com',
      port: 443,
      path: `${path}?${qs}&signature=${sig}`,
      method: 'GET',
      headers: { 'X-MEXC-APIKEY': api_key }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => reject(e));
    req.end();
  });
}

// Fetch up to 1000 trades for a symbol (MEXC max limit is 1000)
async function getAllTrades(symbol) {
  const timestamp = Date.now();
  const qs = `symbol=${symbol}&limit=1000&timestamp=${timestamp}`;
  return await request('/api/v3/myTrades', qs);
}

async function run() {
  const symbols = ['ONDOUSDT', 'BTCUSDT'];

  for (const symbol of symbols) {
    const trades = await getAllTrades(symbol);
    if (!Array.isArray(trades)) {
      console.log(`${symbol} ERROR:`, trades);
      continue;
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`SYMBOL: ${symbol}  |  Total Trades: ${trades.length}`);
    console.log('='.repeat(70));

    let totalBuyQty = 0;
    let totalBuyQuote = 0;  // total USDT spent on buys
    let totalSellQty = 0;
    let totalSellQuote = 0; // total USDT received from sells
    let totalFees = 0;
    let totalFeeAsset = '';

    trades.forEach((t, i) => {
      const side = t.isBuyer ? 'BUY ' : 'SELL';
      const date = new Date(t.time).toISOString().replace('T', ' ').substring(0, 19);
      const price = parseFloat(t.price);
      const qty = parseFloat(t.qty);
      const quoteQty = parseFloat(t.quoteQty);
      const commission = parseFloat(t.commission || 0);
      const commissionAsset = t.commissionAsset || '';

      if (t.isBuyer) {
        totalBuyQty += qty;
        totalBuyQuote += quoteQty;
      } else {
        totalSellQty += qty;
        totalSellQuote += quoteQty;
      }

      if (commissionAsset === 'USDT' || commissionAsset === symbol.replace('USDT', '') || commissionAsset === 'MX') {
        totalFees += commission;
        totalFeeAsset = commissionAsset;
      }

      console.log(`#${String(i+1).padStart(3)} | ${date} | ${side} | Price: ${parseFloat(t.price).toFixed(6)} | Qty: ${parseFloat(t.qty).toFixed(6)} | USDT: ${parseFloat(t.quoteQty).toFixed(4)} | Fee: ${commission} ${commissionAsset}`);
    });

    console.log(`\n${'─'.repeat(70)}`);
    const avgBuyPrice = totalBuyQty > 0 ? totalBuyQuote / totalBuyQty : 0;
    const avgSellPrice = totalSellQty > 0 ? totalSellQuote / totalSellQty : 0;
    const remainingQty = totalBuyQty - totalSellQty;
    const realizedPnL = totalSellQuote - (totalSellQty * avgBuyPrice);

    console.log(`Total BUY  Qty: ${totalBuyQty.toFixed(6)} | Total USDT Spent:    $${totalBuyQuote.toFixed(4)}`);
    console.log(`Total SELL Qty: ${totalSellQty.toFixed(6)} | Total USDT Received: $${totalSellQuote.toFixed(4)}`);
    console.log(`Avg BUY  Price: $${avgBuyPrice.toFixed(6)}`);
    console.log(`Avg SELL Price: $${avgSellPrice.toFixed(6)}`);
    console.log(`Remaining Qty (still holding): ${remainingQty.toFixed(6)}`);
    console.log(`Realized P&L (closed trades): $${realizedPnL.toFixed(4)}`);
    console.log(`Total Fees Paid: ${totalFees.toFixed(6)} ${totalFeeAsset}`);
    console.log(`Net USDT Flow: Spent $${totalBuyQuote.toFixed(4)} | Received $${totalSellQuote.toFixed(4)} | Net: $${(totalSellQuote - totalBuyQuote).toFixed(4)}`);
  }
}

run().catch(console.error);
