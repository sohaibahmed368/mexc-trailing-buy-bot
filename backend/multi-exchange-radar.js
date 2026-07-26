const https = require('https');
const http = require('http');

/**
 * 📡 MultiExchangeSignalRadar
 * Completely isolated, decoupled monitoring engine for Top 10 Multi-Exchange Liquidity & Taker Flow.
 * ZERO interactions with OrderTracker or live order execution loops.
 */
class MultiExchangeSignalRadar {
  constructor() {
    this.cache = {};
    this.supportedExchanges = [
      { id: 'binance', name: 'Binance', icon: '🟡', rank: 1 },
      { id: 'bybit', name: 'Bybit', icon: '🖤', rank: 2 },
      { id: 'mexc', name: 'MEXC Global', icon: '⚡', rank: 3 },
      { id: 'gate', name: 'Gate.io', icon: '🔴', rank: 4 },
      { id: 'bitget', name: 'Bitget', icon: '🔷', rank: 5 },
      { id: 'okx', name: 'OKX', icon: '⚫', rank: 6 },
      { id: 'coinbase', name: 'Coinbase', icon: '🟦', rank: 7 },
      { id: 'htx', name: 'HTX (Huobi)', icon: '🔥', rank: 8 },
      { id: 'kucoin', name: 'KuCoin', icon: '🟢', rank: 9 },
      { id: 'bingx', name: 'BingX', icon: '🌐', rank: 10 }
    ];
  }

  // Helper HTTP GET JSON fetcher with timeout
  async fetchJson(url) {
    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 3000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  }

  // 1. Binance Metrics
  async fetchBinanceMetrics(symbol) {
    const depthUrl = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=500`;
    const tradesUrl = `https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=100`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
      let bVal = 0, aVal = 0;
      depth.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (Array.isArray(trades) && trades.length > 0) {
      let buyV = 0, sellV = 0;
      trades.forEach(t => {
        const val = parseFloat(t.qty || 0) * parseFloat(t.price || 0);
        if (t.isBuyerMaker) sellV += val; else buyV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 2. Bybit Metrics
  async fetchBybitMetrics(symbol) {
    const depthUrl = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=200`;
    const tradesUrl = `https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=100`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.result && Array.isArray(depth.result.b)) {
      let bVal = 0, aVal = 0;
      depth.result.b.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.result.a.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && trades.result && Array.isArray(trades.result.list)) {
      let buyV = 0, sellV = 0;
      trades.result.list.forEach(t => {
        const val = parseFloat(t.execQty || 0) * parseFloat(t.execPrice || 0);
        if (t.side === 'Buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 3. MEXC Metrics
  async fetchMexcMetrics(symbol) {
    const depthUrl = `https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=500`;
    const tradesUrl = `https://api.mexc.com/api/v3/trades?symbol=${symbol}&limit=100`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
      let bVal = 0, aVal = 0;
      depth.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (Array.isArray(trades) && trades.length > 0) {
      let buyV = 0, sellV = 0;
      trades.forEach(t => {
        const val = parseFloat(t.qty || 0) * parseFloat(t.price || 0);
        if (t.isBuyerMaker) sellV += val; else buyV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 4. Gate.io Metrics
  async fetchGateMetrics(symbol) {
    const gateSym = symbol.replace('USDT', '_USDT');
    const depthUrl = `https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${gateSym}&limit=500`;
    const tradesUrl = `https://api.gateio.ws/api/v4/spot/trades?currency_pair=${gateSym}&limit=100`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
      let bVal = 0, aVal = 0;
      depth.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (Array.isArray(trades) && trades.length > 0) {
      let buyV = 0, sellV = 0;
      trades.forEach(t => {
        const val = parseFloat(t.amount || 0) * parseFloat(t.price || 0);
        if (t.side === 'buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 5. Bitget Metrics
  async fetchBitgetMetrics(symbol) {
    const depthUrl = `https://api.bitget.com/api/v2/spot/market/orderbook?symbol=${symbol}&limit=50`;
    const tradesUrl = `https://api.bitget.com/api/v2/spot/market/fills?symbol=${symbol}&limit=50`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.data && Array.isArray(depth.data.bids)) {
      let bVal = 0, aVal = 0;
      depth.data.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.data.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && Array.isArray(trades.data)) {
      let buyV = 0, sellV = 0;
      trades.data.forEach(t => {
        const val = parseFloat(t.size || 0) * parseFloat(t.price || 0);
        if (t.side === 'buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 6. OKX Metrics
  async fetchOkxMetrics(symbol) {
    const okxSym = symbol.replace('USDT', '-USDT');
    const depthUrl = `https://www.okx.com/api/v5/market/books?instId=${okxSym}&sz=50`;
    const tradesUrl = `https://www.okx.com/api/v5/market/trades?instId=${okxSym}&limit=50`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.data && depth.data[0]) {
      const b = depth.data[0].bids || [];
      const a = depth.data[0].asks || [];
      let bVal = 0, aVal = 0;
      b.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      a.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && Array.isArray(trades.data)) {
      let buyV = 0, sellV = 0;
      trades.data.forEach(t => {
        const val = parseFloat(t.sz || 0) * parseFloat(t.px || 0);
        if (t.side === 'buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 7. Coinbase Metrics
  async fetchCoinbaseMetrics(symbol) {
    const cbSym = symbol.replace('USDT', '-USDT');
    const depthUrl = `https://api.exchange.coinbase.com/products/${cbSym}/book?level=2`;
    const tradesUrl = `https://api.exchange.coinbase.com/products/${cbSym}/trades`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
      let bVal = 0, aVal = 0;
      depth.bids.slice(0, 50).forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.asks.slice(0, 50).forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (Array.isArray(trades) && trades.length > 0) {
      let buyV = 0, sellV = 0;
      trades.slice(0, 50).forEach(t => {
        const val = parseFloat(t.size || 0) * parseFloat(t.price || 0);
        if (t.side === 'buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 8. HTX (Huobi) Metrics
  async fetchHtxMetrics(symbol) {
    const htxSym = symbol.toLowerCase();
    const depthUrl = `https://api.huobi.pro/market/depth?symbol=${htxSym}&type=step0`;
    const tradesUrl = `https://api.huobi.pro/market/history/trade?symbol=${htxSym}&size=50`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.tick && Array.isArray(depth.tick.bids)) {
      let bVal = 0, aVal = 0;
      depth.tick.bids.slice(0, 50).forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.tick.asks.slice(0, 50).forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && Array.isArray(trades.data)) {
      let buyV = 0, sellV = 0;
      trades.data.forEach(item => {
        if (Array.isArray(item.data)) {
          item.data.forEach(t => {
            const val = parseFloat(t.amount || 0) * parseFloat(t.price || 0);
            if (t.direction === 'buy') buyV += val; else sellV += val;
          });
        }
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 9. KuCoin Metrics
  async fetchKucoinMetrics(symbol) {
    const kuSym = symbol.replace('USDT', '-USDT');
    const depthUrl = `https://api.kucoin.com/api/v1/market/orderbook/level2_100?symbol=${kuSym}`;
    const tradesUrl = `https://api.kucoin.com/api/v1/market/histories?symbol=${kuSym}`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.data && Array.isArray(depth.data.bids)) {
      let bVal = 0, aVal = 0;
      depth.data.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.data.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && Array.isArray(trades.data)) {
      let buyV = 0, sellV = 0;
      trades.data.forEach(t => {
        const val = parseFloat(t.size || 0) * parseFloat(t.price || 0);
        if (t.side === 'buy') buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // 10. BingX Metrics
  async fetchBingxMetrics(symbol) {
    const bxSym = symbol.replace('USDT', '-USDT');
    const depthUrl = `https://open-api.bingx.com/openApi/spot/v1/market/depth?symbol=${bxSym}`;
    const tradesUrl = `https://open-api.bingx.com/openApi/spot/v1/market/trades?symbol=${bxSym}`;
    const [depth, trades] = await Promise.all([this.fetchJson(depthUrl), this.fetchJson(tradesUrl)]);

    let obiPct = 50.0, takerBuyPct = 50.0;
    if (depth && depth.data && depth.data.bids) {
      let bVal = 0, aVal = 0;
      depth.data.bids.forEach(([p, q]) => bVal += parseFloat(p) * parseFloat(q));
      depth.data.asks.forEach(([p, q]) => aVal += parseFloat(p) * parseFloat(q));
      const tot = bVal + aVal; if (tot > 0) obiPct = (bVal / tot) * 100;
    }

    if (trades && trades.data && Array.isArray(trades.data)) {
      let buyV = 0, sellV = 0;
      trades.data.forEach(t => {
        const val = parseFloat(t.qty || 0) * parseFloat(t.price || 0);
        if (t.type === 1 || t.buyerMaker === false) buyV += val; else sellV += val;
      });
      const tot = buyV + sellV; if (tot > 0) takerBuyPct = (buyV / tot) * 100;
    }
    return { obiPct: parseFloat(obiPct.toFixed(1)), takerBuyPct: parseFloat(takerBuyPct.toFixed(1)), status: 'online' };
  }

  // Master Symbol Fetcher across all Top 10 Exchanges
  async getMultiExchangeMetrics(symbol = 'SOLUSDT') {
    symbol = symbol.toUpperCase().trim();
    const cacheKey = `radar_${symbol}`;
    if (this.cache[cacheKey] && (Date.now() - this.cache[cacheKey].updatedAt < 2500)) {
      return this.cache[cacheKey].data;
    }

    const [binance, bybit, mexc, gate, bitget, okx, coinbase, htx, kucoin, bingx] = await Promise.all([
      this.fetchBinanceMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchBybitMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchMexcMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchGateMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchBitgetMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchOkxMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchCoinbaseMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchHtxMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchKucoinMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' })),
      this.fetchBingxMetrics(symbol).catch(() => ({ obiPct: 50, takerBuyPct: 50, status: 'offline' }))
    ]);

    const metricsData = {
      symbol,
      updatedAt: new Date().toISOString(),
      exchanges: [
        { id: 'binance', name: 'Binance', icon: '🟡', rank: 1, ...binance },
        { id: 'bybit', name: 'Bybit', icon: '🖤', rank: 2, ...bybit },
        { id: 'mexc', name: 'MEXC Global', icon: '⚡', rank: 3, ...mexc },
        { id: 'gate', name: 'Gate.io', icon: '🔴', rank: 4, ...gate },
        { id: 'bitget', name: 'Bitget', icon: '🔷', rank: 5, ...bitget },
        { id: 'okx', name: 'OKX', icon: '⚫', rank: 6, ...okx },
        { id: 'coinbase', name: 'Coinbase', icon: '🟦', rank: 7, ...coinbase },
        { id: 'htx', name: 'HTX (Huobi)', icon: '🔥', rank: 8, ...htx },
        { id: 'kucoin', name: 'KuCoin', icon: '🟢', rank: 9, ...kucoin },
        { id: 'bingx', name: 'BingX', icon: '🌐', rank: 10, ...bingx }
      ]
    };

    // Calculate Consensus Summary across all Top 10
    const onlineEx = metricsData.exchanges.filter(e => e.status === 'online');
    const avgObi = onlineEx.reduce((sum, e) => sum + e.obiPct, 0) / (onlineEx.length || 1);
    const avgTaker = onlineEx.reduce((sum, e) => sum + e.takerBuyPct, 0) / (onlineEx.length || 1);

    metricsData.consensus = {
      avgObiPct: parseFloat(avgObi.toFixed(1)),
      avgTakerBuyPct: parseFloat(avgTaker.toFixed(1)),
      isBullishConsensus: avgObi >= 60.0 && avgTaker >= 55.0
    };

    this.cache[cacheKey] = { updatedAt: Date.now(), data: metricsData };
    return metricsData;
  }
}

module.exports = MultiExchangeSignalRadar;
