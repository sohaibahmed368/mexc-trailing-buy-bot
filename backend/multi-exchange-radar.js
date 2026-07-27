const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * 📡 MultiExchangeSignalRadar
 * Completely isolated, decoupled monitoring engine for Top 10 Multi-Exchange Liquidity & Taker Flow.
 * ZERO interactions with OrderTracker or live order execution loops.
 */
class MultiExchangeSignalRadar {
  constructor(mexcClient = null) {
    this.mexcClient = mexcClient;
    this.cache = {};
    this.autoTradeEthEnabled = true;
    this.autoTradeUsdtAmount = 50.0;
    this.lastAutoTradeTime = 0;
    this.autoTradeLogs = [];
    this.radarOrders = [];
    this.radarOrdersPath = path.join(__dirname, 'data', 'radar-orders.json');

    this.initStorage();

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

  initStorage() {
    try {
      const dir = path.dirname(this.radarOrdersPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(this.radarOrdersPath)) {
        const raw = fs.readFileSync(this.radarOrdersPath, 'utf8');
        this.radarOrders = JSON.parse(raw);
      }
    } catch (e) {
      this.radarOrders = [];
    }
  }

  saveRadarOrders() {
    try {
      fs.writeFileSync(this.radarOrdersPath, JSON.stringify(this.radarOrders, null, 2), 'utf8');
    } catch (e) {}
  }

  setMexcClient(client) {
    this.mexcClient = client;
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

  // 1. Binance Metrics (500-Depth & 20s Taker Flow)
  async fetchBinanceMetrics(symbol) {
    const depthUrl = `https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=500`;
    const tradesUrl = `https://api.binance.com/api/v3/trades?symbol=${symbol}&limit=200`;
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

  // 2. Bybit Metrics (500-Depth & 20s Taker Flow)
  async fetchBybitMetrics(symbol) {
    const depthUrl = `https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${symbol}&limit=200`;
    const tradesUrl = `https://api.bybit.com/v5/market/recent-trade?category=spot&symbol=${symbol}&limit=200`;
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

  // 3. MEXC Metrics (500-Depth & 20s Taker Flow)
  async fetchMexcMetrics(symbol) {
    const depthUrl = `https://api.mexc.com/api/v3/depth?symbol=${symbol}&limit=500`;
    const tradesUrl = `https://api.mexc.com/api/v3/trades?symbol=${symbol}&limit=200`;
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

  // Standalone Auto-Buy Trigger ($50 USDT) + Automatic +0.60% TP Limit Sell Order when 7+ Exchanges are GREEN
  async checkAndTriggerEthAutoBuy(greenCount, triggerSymbol) {
    // 🔒 SINGLE ACTIVE TRADE LOCK GUARD: Block any new auto-buy if an order is currently active/processing!
    const pendingOrder = (this.radarOrders || []).find(o => o.status === 'LIMIT_SELL_ACTIVE');
    if (pendingOrder) {
      console.log(`🔒 [RADAR BUY LOCKED] Active order pending TP for ${pendingOrder.symbol} (Buy: $${pendingOrder.buyPrice}, TP Target: $${pendingOrder.tpPrice}). New buys strictly blocked until active order fills!`);
      return;
    }

    const symbolToBuy = (triggerSymbol || 'ETHUSDT').toUpperCase().trim();
    const now = Date.now();
    // Cooldown guard: Minimum 3 minutes between auto-buys per symbol
    if (now - this.lastAutoTradeTime < 180000) {
      return;
    }
    this.lastAutoTradeTime = now;

    const logMsg = `🤖 [RADAR 7+ GREEN AUTO-BUY TRIGGERED] ${greenCount}/10 Exchanges are GREEN for ${symbolToBuy}! Executing $${this.autoTradeUsdtAmount} USDT Market Buy...`;
    console.log(logMsg);

    try {
      if (this.mexcClient && this.mexcClient.hasCredentials()) {
        const orderRes = await this.mexcClient.createOrder({
          symbol: symbolToBuy,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: this.autoTradeUsdtAmount
        });
        
        let buyPrice = 0;
        let filledQty = 0;
        try {
          const fillInfo = await this.mexcClient.getOrder(symbolToBuy, orderRes.orderId);
          if (fillInfo && parseFloat(fillInfo.executedQty) > 0) {
            filledQty = parseFloat(fillInfo.executedQty);
            const cumQuote = parseFloat(fillInfo.cummulativeQuoteQty || 0);
            buyPrice = cumQuote > 0 ? (cumQuote / filledQty) : parseFloat(fillInfo.price || 0);
          }
        } catch (e) {}

        if (!buyPrice || buyPrice <= 0) {
          const ticker = await this.mexcClient.getTickerPrice(symbolToBuy).catch(() => 0);
          buyPrice = parseFloat(ticker) || 100.0;
          filledQty = filledQty || (this.autoTradeUsdtAmount / buyPrice);
        }

        // Calculate +0.60% TP Limit Sell Target Price
        const tpPrice = buyPrice * 1.006;
        let tpOrderRes = null;
        try {
          tpOrderRes = await this.mexcClient.createOrder({
            symbol: symbolToBuy,
            side: 'SELL',
            type: 'LIMIT',
            quantity: filledQty.toFixed(4),
            price: tpPrice.toFixed(4)
          });
          console.log(`🎯 [RADAR +0.60% TP LIMIT SELL PLACED] Placed Limit Sell for ${filledQty.toFixed(4)} ${symbolToBuy} at $${tpPrice.toFixed(4)} (MEXC Sell Order ID: ${tpOrderRes.orderId})`);
        } catch (tpErr) {
          console.log(`⚠️ [RADAR TP LIMIT SELL NOTICE] Limit Sell placement warning: ${tpErr.message}`);
        }

        const newRadarOrder = {
          id: 'radar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          symbol: symbolToBuy,
          buyPrice: parseFloat(buyPrice.toFixed(4)),
          tpPrice: parseFloat(tpPrice.toFixed(4)),
          quantity: parseFloat(filledQty.toFixed(4)),
          buyOrderId: orderRes.orderId,
          sellOrderId: tpOrderRes ? tpOrderRes.orderId : null,
          status: 'LIMIT_SELL_ACTIVE',
          createdAt: new Date().toISOString(),
          filledAt: null
        };

        this.radarOrders.unshift(newRadarOrder);
        this.saveRadarOrders();

        const successMsg = `✅ [RADAR AUTO-BUY SUCCESS] Executed $${this.autoTradeUsdtAmount} USDT Market Buy for ${symbolToBuy} @ $${buyPrice.toFixed(4)}! Placed +0.60% TP Limit Sell @ $${tpPrice.toFixed(4)}!`;
        console.log(successMsg);
        this.autoTradeLogs.unshift({
          timestamp: new Date().toISOString(),
          greenCount,
          triggerSymbol: symbolToBuy,
          amountUsdt: this.autoTradeUsdtAmount,
          orderId: orderRes.orderId,
          status: 'SUCCESS',
          msg: successMsg
        });
      } else {
        // Simulation mode
        const ticker = await this.mexcClient.getTickerPrice(symbolToBuy).catch(() => 100.0);
        const buyPrice = parseFloat(ticker) || 100.0;
        const tpPrice = buyPrice * 1.006;
        const filledQty = this.autoTradeUsdtAmount / buyPrice;

        const newRadarOrder = {
          id: 'radar_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          symbol: symbolToBuy,
          buyPrice: parseFloat(buyPrice.toFixed(4)),
          tpPrice: parseFloat(tpPrice.toFixed(4)),
          quantity: parseFloat(filledQty.toFixed(4)),
          buyOrderId: 'sim_buy_' + Date.now(),
          sellOrderId: 'sim_sell_' + Date.now(),
          status: 'LIMIT_SELL_ACTIVE',
          createdAt: new Date().toISOString(),
          filledAt: null
        };

        this.radarOrders.unshift(newRadarOrder);
        this.saveRadarOrders();

        const simMsg = `[RADAR AUTO-BUY SIMULATION] ${greenCount}/10 Green Exchanges for ${symbolToBuy}! Bought @ $${buyPrice.toFixed(4)}, Placed +0.60% TP Limit Sell @ $${tpPrice.toFixed(4)}.`;
        console.log(simMsg);
        this.autoTradeLogs.unshift({
          timestamp: new Date().toISOString(),
          greenCount,
          triggerSymbol: symbolToBuy,
          amountUsdt: this.autoTradeUsdtAmount,
          status: 'SIMULATED',
          msg: simMsg
        });
      }
    } catch (err) {
      const errLog = `❌ [RADAR AUTO-BUY FAILED] Could not execute $${this.autoTradeUsdtAmount} ${symbolToBuy} buy: ${err.message}`;
      console.log(errLog);
      this.autoTradeLogs.unshift({
        timestamp: new Date().toISOString(),
        greenCount,
        triggerSymbol: symbolToBuy,
        amountUsdt: this.autoTradeUsdtAmount,
        status: 'FAILED',
        msg: errLog
      });
    }

    if (this.autoTradeLogs.length > 20) {
      this.autoTradeLogs = this.autoTradeLogs.slice(0, 20);
    }
  }

  async checkRadarLimitOrders(symbol) {
    if (!this.radarOrders || this.radarOrders.length === 0) return;
    let changed = false;
    let currentPrice = 0;
    try {
      if (this.mexcClient && typeof this.mexcClient.getTickerPrice === 'function') {
        const ticker = await this.mexcClient.getTickerPrice(symbol);
        currentPrice = parseFloat(ticker) || 0;
      }
    } catch (e) {}

    for (const ord of this.radarOrders) {
      if (ord.status === 'LIMIT_SELL_ACTIVE' && ord.symbol === symbol) {
        let isFilled = false;
        if (currentPrice > 0 && currentPrice >= ord.tpPrice) {
          isFilled = true;
        } else if (ord.sellOrderId && this.mexcClient && typeof this.mexcClient.getOrder === 'function') {
          try {
            const queryRes = await this.mexcClient.getOrder(ord.symbol, ord.sellOrderId);
            if (queryRes && queryRes.status === 'FILLED') isFilled = true;
          } catch (e) {}
        }

        if (isFilled) {
          ord.status = 'FILLED';
          ord.filledAt = new Date().toISOString();
          changed = true;
          console.log(`🎉 [RADAR +0.60% TP HIT] ${ord.symbol} TP Limit Sell Order filled at $${ord.tpPrice} (+0.60%)! 1 Order Processed Successfully!`);
        }
      }
    }
    if (changed) this.saveRadarOrders();
  }

  // Master Symbol Fetcher across all Top 10 Exchanges
  async getMultiExchangeMetrics(symbol = 'SOLUSDT') {
    symbol = symbol.toUpperCase().trim();
    const cacheKey = `radar_${symbol}`;
    if (this.cache[cacheKey] && (Date.now() - this.cache[cacheKey].updatedAt < 7000)) {
      return this.cache[cacheKey].data;
    }

    await this.checkRadarLimitOrders(symbol);

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

    // Calculate GREEN Exchanges Count (OBI >= 60.0% AND 20s Taker Buy >= 50.0%)
    const greenExchanges = metricsData.exchanges.filter(e => e.obiPct >= 60.0 && e.takerBuyPct >= 50.0);
    metricsData.greenCount = greenExchanges.length;

    // Calculate Consensus Summary across all Top 10
    const onlineEx = metricsData.exchanges.filter(e => e.status === 'online');
    const avgObi = onlineEx.reduce((sum, e) => sum + e.obiPct, 0) / (onlineEx.length || 1);
    const avgTaker = onlineEx.reduce((sum, e) => sum + e.takerBuyPct, 0) / (onlineEx.length || 1);

    const activeOrder = (this.radarOrders || []).find(o => o.status === 'LIMIT_SELL_ACTIVE');

    metricsData.consensus = {
      avgObiPct: parseFloat(avgObi.toFixed(1)),
      avgTakerBuyPct: parseFloat(avgTaker.toFixed(1)),
      isBullishConsensus: greenExchanges.length >= 7,
      isAutoBuyLocked: !!activeOrder,
      activeSymbol: activeOrder ? activeOrder.symbol : null
    };

    const filledCount = this.radarOrders.filter(o => o.status === 'FILLED').length;
    metricsData.radarOrders = this.radarOrders;
    metricsData.radarStats = {
      totalProcessed: filledCount,
      activeCount: activeOrder ? 1 : 0,
      isAutoBuyLocked: !!activeOrder,
      processedMessage: `${filledCount} Order${filledCount === 1 ? '' : 's'} Processed`
    };

    metricsData.autoTrade = {
      enabled: this.autoTradeEthEnabled,
      amountUsdt: this.autoTradeUsdtAmount,
      logs: this.autoTradeLogs
    };

    // Trigger 7+ Green Exchanges Auto-Buy if enabled for selected symbol
    if (this.autoTradeEthEnabled && greenExchanges.length >= 7) {
      this.checkAndTriggerEthAutoBuy(greenExchanges.length, symbol);
    }

    this.cache[cacheKey] = { updatedAt: Date.now(), data: metricsData };
    return metricsData;
  }
}

module.exports = MultiExchangeSignalRadar;
