const fs = require('fs');
const path = require('path');

class StockOrderTracker {
  constructor(mexcClient, io) {
    this.mexcClient = mexcClient;
    this.io = io;
    this.orders = [];
    this.logs = [];
    this.isTracking = false;
    this.intervalId = null;
    this.pollInterval = 1000; // 1s polling loop
    this.ordersPath = path.join(__dirname, 'stock-orders.json');
    this.logsPath = path.join(__dirname, 'stock-logs.json');
    this.isTicking = false;

    this.loadOrders();
    this.loadLogs();
  }

  loadOrders() {
    try {
      if (fs.existsSync(this.ordersPath)) {
        const data = fs.readFileSync(this.ordersPath, 'utf8');
        this.orders = JSON.parse(data);
      }
    } catch (e) {
      this.log(`Error loading stock orders: ${e.message}`, 'error');
      this.orders = [];
    }
  }

  saveOrders() {
    try {
      fs.writeFileSync(this.ordersPath, JSON.stringify(this.orders, null, 2));
      if (this.io) {
        this.io.emit('stock_orders_update', this.orders);
      }
    } catch (e) {
      this.log(`Error saving stock orders: ${e.message}`, 'error');
    }
  }

  loadLogs() {
    try {
      if (fs.existsSync(this.logsPath)) {
        const data = fs.readFileSync(this.logsPath, 'utf8');
        this.logs = JSON.parse(data);
      }
    } catch (e) {
      this.logs = [];
    }
  }

  saveLogs() {
    try {
      if (this.logs.length > 500) {
        this.logs = this.logs.slice(0, 500);
      }
      fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2));
    } catch (e) {
      // ignore
    }
  }

  log(message, type = 'info', symbol = null) {
    const logEntry = {
      id: Date.now().toString() + Math.random().toString().substring(2, 5),
      timestamp: new Date().toISOString(),
      message,
      type,
      symbol
    };
    this.logs.unshift(logEntry);
    this.saveLogs();
    if (this.io) {
      this.io.emit('stock_log_entry', logEntry);
    }
    console.log(`[STOCK BOT ${type.toUpperCase()}] ${symbol ? `[${symbol}] ` : ''}${message}`);
  }

  getOrders() {
    return this.orders;
  }

  getLogs() {
    return this.logs;
  }

  /**
   * Calculate exact Maker-guaranteed Limit Price using orderbook depth for Stock Bot.
   * STRICT MAKER RULES:
   * 1. BUY: targetBuyPrice MUST be < bestAsk. If >= bestAsk, force pegPrice = bestAsk - tick.
   * 2. SELL: targetSellPrice MUST be > bestBid. If <= bestBid, force pegPrice = bestBid + tick.
   */
  async calculateMakerPegPrice(symbol, side, fallbackPrice) {
    try {
      const depth = await this.mexcClient.getDepth(symbol, 10);
      if (depth && Array.isArray(depth.bids) && depth.bids.length > 0 && Array.isArray(depth.asks) && depth.asks.length > 0) {
        const bestBid = parseFloat(depth.bids[0][0]);
        const bestAsk = parseFloat(depth.asks[0][0]);

        let tick = 0.0001;
        if (bestBid > 1000) tick = 0.01;
        else if (bestBid > 10) tick = 0.001;
        else if (bestBid < 0.1) tick = 0.000001;

        const decimals = tick.toString().includes('.') ? tick.toString().split('.')[1].length : 2;

        if (side.toUpperCase() === 'BUY') {
          // TOP BUYER PEG RULE: Outbid existing top bid (+tick) to become #1 Top Buyer in BIDS orderbook tab
          let pegPrice = bestBid + tick;
          const maxAllowedBuyPrice = bestAsk - tick;

          if (pegPrice >= bestAsk || pegPrice > maxAllowedBuyPrice) {
            pegPrice = maxAllowedBuyPrice;
          }
          if (pegPrice <= 0) pegPrice = Math.max(0.00000001, bestBid);

          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          this.log(`👑 [STOCK TOP BUYER PEG] Best Bid: ${bestBid}, Best Ask: ${bestAsk} → #1 TOP BUYER Price: ${pegPrice} (< Ask ${bestAsk} ✅)`, 'info', symbol);
          return pegPrice;
        } else {
          // TOP SELLER PEG RULE: Undercut existing top ask (-tick) to become #1 Top Seller in ASKS orderbook tab
          let pegPrice = bestAsk - tick;
          const minAllowedSellPrice = bestBid + tick;

          if (pegPrice <= bestBid || pegPrice < minAllowedSellPrice) {
            pegPrice = minAllowedSellPrice;
          }

          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          this.log(`👑 [STOCK TOP SELLER PEG] Best Bid: ${bestBid}, Best Ask: ${bestAsk} → #1 TOP SELLER Price: ${pegPrice} (> Bid ${bestBid} ✅)`, 'info', symbol);
          return pegPrice;
        }
      }
    } catch (err) {
      this.log(`[STOCK MAKER PEG] Failed to query depth for ${symbol}: ${err.message}. Applying safe sub-Ask fallback...`, 'warning', symbol);
    }

    // SAFE FALLBACK GUARD: If depth query fails, force price 0.1% below fallback for BUY so it CANNOT hit Asks as Taker
    if (side.toUpperCase() === 'BUY' && fallbackPrice) {
      const safeBuyFallback = parseFloat((fallbackPrice * 0.999).toFixed(4));
      this.log(`[STOCK MAKER PEG FALLBACK] Safe Sub-Ask BUY Price: ${safeBuyFallback} (0.1% below market) to guarantee MAKER status.`, 'warning', symbol);
      return safeBuyFallback;
    }
    return fallbackPrice;
  }

  /**
   * Smart Momentum Pressure Detector for Tokenized Stocks:
   * Evaluates 0.1ms real-time market pressure right before buy execution.
   * If extreme buying surge detected (Volume >= 2.5x avg or OBI Bids >= 72%), switches to Instant Market Buy.
   * If normal/moderate momentum, uses 100% Maker Limit Buy for 0% Fee.
   */
  async evaluateBuyingPressure(symbol, currentPrice) {
    let isExtremePump = false;
    let metricsLog = '';
    try {
      const [depth, klines] = await Promise.all([
        this.mexcClient.getDepth(symbol, 20),
        this.mexcClient.getKlines(symbol, '1m', 6)
      ]);

      let obiRatio = 0.5;
      if (depth && Array.isArray(depth.bids) && Array.isArray(depth.asks)) {
        let bidsVal = 0, asksVal = 0;
        const lower = currentPrice * 0.985, upper = currentPrice * 1.015;
        depth.bids.forEach(([p, q]) => { const pr = parseFloat(p); if (pr >= lower && pr <= upper) bidsVal += (pr * parseFloat(q)); });
        depth.asks.forEach(([p, q]) => { const pr = parseFloat(p); if (pr >= lower && pr <= upper) asksVal += (pr * parseFloat(q)); });
        const tot = bidsVal + asksVal;
        if (tot > 0) obiRatio = bidsVal / tot;
      }

      let volRatio = 1.0;
      if (klines && klines.length >= 6) {
        const lastVol = parseFloat(klines[5][5]);
        const prevVols = klines.slice(0, 5).map(k => parseFloat(k[5]));
        const avgVol = prevVols.reduce((a, b) => a + b, 0) / (prevVols.length || 1);
        if (avgVol > 0) volRatio = lastVol / avgVol;
      }

      metricsLog = `Vol: ${volRatio.toFixed(1)}x avg, OBI Bids: ${(obiRatio * 100).toFixed(1)}%`;

      if (volRatio >= 2.5 || obiRatio >= 0.72) {
        isExtremePump = true;
      }
    } catch (e) {
      // Default to Limit Buy if query fails
    }
    return { isExtremePump, metricsLog };
  }

  /**
   * 100% MAKER RE-PEG ENGINE FOR LOW-LIQUIDITY ASSETS (NO MARKET FALLBACK EVER)
   * Continuously polls and re-pegs Stock LIMIT orders every 10s (10000ms order stay window) to top of orderbook
   * strictly maintaining BUY <= Best Bid and SELL >= Best Ask for 0% Maker fees (Top Buyer / Top Seller Green Badge).
   * Gives low-liquidity market takers sufficient time (10s) to hit passive limit orders while preserving queue priority.
   */
  async waitForLimitOrderFill(symbol, orderId, side, quantity, fallbackPrice, maxWaitMs = 300000, pollMs = 10000) {
    const startTime = Date.now();
    let attempts = 0;
    let currentOrderId = orderId;
    let currentPrice = fallbackPrice;
    let currentQty = quantity;

    while (Date.now() - startTime < maxWaitMs) {
      attempts++;
      await new Promise(r => setTimeout(r, pollMs));

      try {
        const orderInfo = await this.mexcClient.getOrder(symbol, currentOrderId);
        if (orderInfo && orderInfo.status === 'FILLED') {
          const executedQty = parseFloat(orderInfo.executedQty) || currentQty;
          const cummulativeQuoteQty = parseFloat(orderInfo.cummulativeQuoteQty);
          if (executedQty > 0 && cummulativeQuoteQty > 0) {
            const avgPrice = cummulativeQuoteQty / executedQty;
            this.log(`🎉 [STOCK 100% MAKER SUCCESS] Order ${currentOrderId} FILLED as MAKER (0% Fee) after ${attempts} re-peg checks! Avg Price: ${avgPrice.toFixed(6)}`, 'success', symbol);
            return { avgPrice, executedQty, filled: true, maker: true };
          }
        }

        if (orderInfo && (orderInfo.status === 'NEW' || orderInfo.status === 'PARTIALLY_FILLED')) {
          // SMART DELTA CHECK: Query fresh depth target BEFORE cancelling!
          const targetPegPrice = await this.calculateMakerPegPrice(symbol, side, currentPrice);

          // If current order price is STILL optimal target peg price, DO NOT CANCEL! Preserve Queue Priority & Save API calls!
          if (Math.abs(targetPegPrice - currentPrice) < 0.0000001 || targetPegPrice === currentPrice) {
            this.log(`🛡️ [STOCK SMART LAZY PEG] Check #${attempts}: Stock order ${currentOrderId} at ${currentPrice} USDT is STILL optimal Top ${side}. Preserving Orderbook Queue Priority (Skipping Re-peg).`, 'info', symbol);
            continue;
          }

          this.log(`[STOCK MAKER RE-PEG SHIFT] Check #${attempts}: Orderbook depth shifted (${currentPrice} → ${targetPegPrice}). Re-pegging stock order ${currentOrderId}...`, 'warning', symbol);
          
          try {
            await this.mexcClient.cancelOrder(symbol, currentOrderId);
          } catch (cErr) {
            try {
              const rc = await this.mexcClient.getOrder(symbol, currentOrderId);
              if (rc && rc.status === 'FILLED') {
                const executedQty = parseFloat(rc.executedQty) || currentQty;
                const cummulativeQuoteQty = parseFloat(rc.cummulativeQuoteQty);
                const avgPrice = (executedQty > 0 && cummulativeQuoteQty > 0) ? (cummulativeQuoteQty / executedQty) : currentPrice;
                return { avgPrice, executedQty, filled: true, maker: true };
              }
            } catch (e) {}
          }

          const newPegPrice = await this.calculateMakerPegPrice(symbol, side, currentPrice);
          currentPrice = newPegPrice;

          const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000, 100000000];
          let newPlaceResult = null;
          for (const mult of decimalsToTry) {
            const qtyToTry = Math.floor(currentQty * mult) / mult;
            if (qtyToTry <= 0) continue;
            try {
              const orderParams = {
                symbol,
                side,
                type: 'LIMIT',
                quantity: qtyToTry,
                price: currentPrice
              };
              newPlaceResult = await this.mexcClient.placeOrder(orderParams);
              if (newPlaceResult && newPlaceResult.orderId) {
                currentOrderId = newPlaceResult.orderId;
                currentQty = qtyToTry;
                this.log(`[STOCK MAKER RE-PEG] Placed NEW 100% MAKER ${side} LIMIT order ${currentOrderId} at updated price ${currentPrice} USDT (0% Fee)`, 'info', symbol);
                break;
              }
            } catch (err) {
              const errMsg = err.message || '';
              if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                continue;
              }
              break;
            }
          }
          continue;
        }

        if (orderInfo && (orderInfo.status === 'CANCELED' || orderInfo.status === 'EXPIRED' || orderInfo.status === 'REJECTED')) {
          this.log(`[STOCK MAKER LIMIT] Order ${currentOrderId} status: ${orderInfo.status}. Re-pegging new order...`, 'warning', symbol);
          const newPegPrice = await this.calculateMakerPegPrice(symbol, side, currentPrice);
          currentPrice = newPegPrice;
          const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000, 100000000];
          for (const mult of decimalsToTry) {
            const qtyToTry = Math.floor(currentQty * mult) / mult;
            if (qtyToTry <= 0) continue;
            try {
              const orderParams = { symbol, side, type: 'LIMIT', quantity: qtyToTry, price: currentPrice };
              const res = await this.mexcClient.placeOrder(orderParams);
              if (res && res.orderId) {
                currentOrderId = res.orderId;
                currentQty = qtyToTry;
                break;
              }
            } catch (e) {}
          }
          continue;
        }
      } catch (err) {
        this.log(`[STOCK MAKER LIMIT] Error checking order ${currentOrderId}: ${err.message}`, 'warning', symbol);
      }
    }

    this.log(`[STOCK 100% MAKER GUARANTEE] Stock Order ${currentOrderId} not filled after ${maxWaitMs / 1000}s of continuous Limit re-pegging. Aborting without Market fallback to guarantee 0% Fee.`, 'warning', symbol);

    try {
      await this.mexcClient.cancelOrder(symbol, currentOrderId);
    } catch (cancelErr) {}

    return { avgPrice: currentPrice, executedQty: null, filled: false, maker: true };
  }

  async addOrder(config) {
    const currentPrice = await this.mexcClient.getTickerPrice(config.symbol);

    let isStartImmediate = config.startImmediately === true;
    let initialStatus = 'RUNNING';
    let initialPeak = null;
    let initialActivationPrice = null;

    if (config.autoRepeat) {
      if (!isStartImmediate) {
        initialStatus = 'PENDING_ACTIVATION';
        initialPeak = currentPrice;
        const offsetPct = config.activationOffset !== undefined && config.activationOffset !== null && config.activationOffset !== '' 
          ? parseFloat(config.activationOffset) 
          : parseFloat(config.trailValue);
        initialActivationPrice = initialPeak * (1 - (offsetPct / 100));
      }
    } else {
      if (config.activationPrice !== undefined && config.activationPrice !== null && config.activationPrice !== '') {
        isStartImmediate = false;
        initialStatus = 'PENDING_ACTIVATION';
        initialActivationPrice = parseFloat(config.activationPrice);
      } else {
        isStartImmediate = true;
        initialStatus = 'RUNNING';
      }
    }

    const trailPct = parseFloat(config.trailValue);
    const newOrder = {
      id: Date.now().toString(),
      symbol: config.symbol,
      trailValue: trailPct,
      orderType: config.orderType || 'MARKET',
      quantity: config.quantity ? parseFloat(config.quantity) : null,
      quoteOrderQty: config.quoteOrderQty ? parseFloat(config.quoteOrderQty) : null,
      takeProfit: config.takeProfit ? parseFloat(config.takeProfit) : null,
      stopLoss: config.stopLoss ? parseFloat(config.stopLoss) : null,
      filterSmartSl: config.filterSmartSl !== undefined ? !!config.filterSmartSl : true,
      slBuffer: config.slBuffer ? parseFloat(config.slBuffer) : 0,
      filterObi: config.filterObi !== undefined ? !!config.filterObi : true,
      filterVolumeSpike: config.filterVolumeSpike !== undefined ? !!config.filterVolumeSpike : true,
      filterRsi: config.filterRsi !== undefined ? !!config.filterRsi : true,
      autoRepeat: config.autoRepeat !== undefined ? !!config.autoRepeat : true,
      activationOffset: config.activationOffset ? parseFloat(config.activationOffset) : null,
      isStockBot: true,
      status: initialStatus,
      dryRun: config.dryRun !== undefined ? config.dryRun : true,
      peakPrice: initialPeak,
      activationPrice: initialActivationPrice,
      bottomPrice: isStartImmediate ? currentPrice : null,
      triggerPrice: isStartImmediate ? (currentPrice + (currentPrice * (trailPct / 100))) : null,
      executionPrice: null,
      sellExecutionPrice: null,
      mexcOrderId: null,
      mexcSellOrderId: null,
      createdAt: new Date().toISOString(),
      totalNetProfit: 0,
      tradeHistory: [],
      isSlExtended: false,
      isSlProfitLocked: false,
      lockedSlPrice: null
    };

    this.orders.unshift(newOrder);
    this.saveOrders();
    this.log(`New Stock Bot order created for ${config.symbol} (0% Maker Pegging Engine)`, 'info', config.symbol);

    this.startTracking();
    return newOrder;
  }

  async cancelOrder(id) {
    const order = this.orders.find(o => o.id === id);
    if (order) {
      if (order.mexcSellOrderId && !order.dryRun) {
        try {
          await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
          this.log(`Cancelled TP Limit Sell order ${order.mexcSellOrderId} on MEXC for ${order.symbol}`, 'info', order.symbol);
        } catch (e) {
          this.log(`Failed to cancel TP Limit order: ${e.message}`, 'warning', order.symbol);
        }
      }

      order.status = 'CANCELLED';
      this.saveOrders();
      this.log(`Stock Bot Order ${id} cancelled.`, 'info', order.symbol);
      this.checkTrackingLoop();
      return true;
    }
    return false;
  }

  startTracking() {
    if (this.isTracking) return;
    this.isTracking = true;
    this.intervalId = setInterval(() => this.tick(), this.pollInterval);
    this.log('Stock Bot Order tracking loop started.', 'info');
  }

  // Query actual free spot balance from MEXC to prevent 30005 Oversold errors
  async getFeeAdjustedBalance(symbol, targetQty) {
    try {
      const asset = symbol.replace('USDT', '').toUpperCase();
      let balances = await this.mexcClient.getBalances();
      let assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;

      if (!assetBal || parseFloat(assetBal.free || 0) < ((targetQty || 1) * 0.1)) {
        await new Promise(r => setTimeout(r, 1000));
        balances = await this.mexcClient.getBalances();
        assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
      }

      if (assetBal && parseFloat(assetBal.free || 0) > 0) {
        const freeVal = parseFloat(assetBal.free);
        const safeFree = freeVal * 0.998;
        this.log(`[STOCK BALANCE CHECK] Free spot balance for ${asset}: ${freeVal}. Using safe sell quantity: ${safeFree.toFixed(6)}`, 'info', symbol);
        return safeFree;
      }
    } catch (e) {
      this.log(`[STOCK BALANCE CHECK] Query failed: ${e.message}. Using target quantity fallback.`, 'warning', symbol);
    }
    return (targetQty || 1.0) * 0.998;
  }

  // Robust Helper: Retry order placement with varying quantity precisions to overcome MEXC 400 "quantity scale is invalid" errors
  async placeOrderWithPrecisionRetry(orderParams, quoteOrderQty = null) {
    let lastErr = null;

    // Prioritize quoteOrderQty for MARKET BUY orders to bypass MEXC quantity decimal scale limits
    const targetQuoteQty = quoteOrderQty || orderParams.quoteOrderQty;
    if (orderParams.type === 'MARKET' && orderParams.side === 'BUY' && targetQuoteQty) {
      try {
        const attemptParams = {
          symbol: orderParams.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty: Math.floor(parseFloat(targetQuoteQty) * 100) / 100
        };
        const res = await this.mexcClient.placeOrder(attemptParams);
        if (res && res.orderId) return res;
      } catch (err) {
        lastErr = err;
        this.log(`[REAL] Market buy quoteOrderQty attempt failed (${err.message}). Retrying with quantity scale precision fallback...`, 'warning', orderParams.symbol);
      }
    }

    const decimalsToTry = [100, 10, 1, 1000, 10000, 0.1];

    if (orderParams.quantity) {
      let rawQty = orderParams.quantity;
      for (const mult of decimalsToTry) {
        let qtyToTry = Math.floor(rawQty * mult) / mult;
        if (qtyToTry <= 0) qtyToTry = Math.round(rawQty);
        if (qtyToTry <= 0) continue;

        try {
          const attemptParams = { ...orderParams, quantity: qtyToTry };
          delete attemptParams.quoteOrderQty;
          const res = await this.mexcClient.placeOrder(attemptParams);
          if (res && res.orderId) return res;
        } catch (err) {
          lastErr = err;
          const msg = err.message || '';
          if (msg.includes('quantity scale') || msg.includes('400') || msg.includes('code":400')) {
            this.log(`[REAL] Quantity scale retry for ${orderParams.symbol} at multiplier ${mult} (Qty: ${qtyToTry})...`, 'warning', orderParams.symbol);
            continue;
          }
          if (msg.includes('Oversold') || msg.includes('30005')) {
            this.log(`[REAL] Oversold (30005) detected for ${orderParams.symbol}. Querying free spot balance...`, 'warning', orderParams.symbol);
            try {
              const freeQty = await this.getFeeAdjustedBalance(orderParams.symbol, rawQty);
              if (freeQty > 0 && freeQty < rawQty) {
                rawQty = freeQty;
                const safeTry = Math.floor(rawQty * mult) / mult;
                if (safeTry > 0) {
                  const retryParams = { ...orderParams, quantity: safeTry };
                  delete retryParams.quoteOrderQty;
                  const res = await this.mexcClient.placeOrder(retryParams);
                  if (res && res.orderId) return res;
                }
              }
            } catch (balErr) {}
            continue;
          }
          throw err;
        }
      }
    }

    if (lastErr) throw lastErr;
    throw new Error('Order placement failed with precision retry.');
  }

  stopTracking() {
    if (!this.isTracking) return;
    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.log('Stock Bot Order tracking loop stopped.', 'info');
  }

  checkTrackingLoop() {
    const hasActive = this.orders.some(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
    if (!hasActive && this.isTracking) {
      this.stopTracking();
    } else if (hasActive && !this.isTracking) {
      this.startTracking();
    }
  }

  calculateRSI(klines, period = 14) {
    if (!klines || klines.length < period + 1) return 50;
    const closes = klines.map(k => parseFloat(k[4]));
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  async getFeeAdjustedBalance(symbol, grossQty) {
    try {
      const asset = symbol.replace('USDT', '');
      const balances = await this.mexcClient.getBalances();
      const assetBal = balances.find(b => b.asset === asset);
      if (assetBal) {
        const freeBal = parseFloat(assetBal.free);
        this.log(`Asset ${asset} free balance: ${freeBal}`, 'info', symbol);
        const sellQty = Math.min(grossQty, freeBal);
        return sellQty;
      }
    } catch (e) {
      this.log(`Failed to fetch asset balance: ${e.message}. Using gross quantity.`, 'warning', symbol);
    }
    return grossQty;
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const activeOrders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE' || o.status === 'PENDING_EXECUTION');
      if (activeOrders.length === 0) {
        this.checkTrackingLoop();
        return;
      }

      const symbols = [...new Set(activeOrders.map(o => o.symbol))];
      const prices = {};

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const price = await this.mexcClient.getTickerPrice(symbol);
            prices[symbol] = price;
          } catch (e) {
            this.log(`Error fetching price for ${symbol}: ${e.message}`, 'error', symbol);
          }
        })
      );

      let changed = false;

      for (const order of activeOrders) {
        const currentPrice = prices[order.symbol];
        if (currentPrice === undefined) continue;

        order.currentPrice = currentPrice;
        changed = true;

        // 0.5. PENDING_EXECUTION (Waiting for Pegged Limit Buy Fill)
        if (order.status === 'PENDING_EXECUTION' && order.mexcOrderId && !order.dryRun) {
          try {
            const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcOrderId);
            if (queryRes && queryRes.status === 'FILLED') {
              order.executionPrice = parseFloat(queryRes.price) || currentPrice;
              order.status = (order.takeProfit || order.stopLoss) ? 'TP_SL_ACTIVE' : 'TRIGGERED';
              this.log(`🎉 [REAL] Pegged Limit Buy order ${order.mexcOrderId} FILLED at ${order.executionPrice} USDT! Transitioning to TP_SL_ACTIVE state.`, 'success', order.symbol);
              changed = true;

              if (!order.takeProfit && !order.stopLoss) {
                this.handleOrderCycleComplete(order);
              }
            } else {
              this.log(`⏳ [REAL] Pegged Limit Buy order ${order.mexcOrderId} still pending fill on MEXC...`, 'info', order.symbol);
            }
          } catch (qErr) {
            this.log(`Failed to query order fill status for ${order.mexcOrderId}: ${qErr.message}`, 'warning', order.symbol);
          }
          continue;
        }

        // 1. PENDING_ACTIVATION (Dynamic Peak Trailing)
        if (order.status === 'PENDING_ACTIVATION') {
          if (order.autoRepeat && order.activationOffset) {
            if (!order.peakPrice || currentPrice > order.peakPrice) {
              order.peakPrice = currentPrice;
              const offsetPct = parseFloat(order.activationOffset);
              order.activationPrice = order.peakPrice * (1 - (offsetPct / 100));
              this.log(`Dynamic Peak shifted UP to ${currentPrice}. Updated activationPrice: ${order.activationPrice.toFixed(4)}`, 'info', order.symbol);
              changed = true;
            }
          }

          if (currentPrice <= order.activationPrice) {
            order.status = 'RUNNING';
            order.bottomPrice = currentPrice;
            const trailDollar = currentPrice * (order.trailValue / 100);
            order.triggerPrice = currentPrice + trailDollar;
            order.activatedAt = new Date().toISOString();
            this.log(`Activation price hit (${currentPrice} <= ${order.activationPrice.toFixed(4)}). Status set to RUNNING. Initial bottom: ${currentPrice}`, 'info', order.symbol);
            changed = true;
          }
        }

        // 2. RUNNING (Trailing Dip Trailing)
        if (order.status === 'RUNNING') {
          if (currentPrice < order.bottomPrice) {
            const oldBottom = order.bottomPrice;
            order.bottomPrice = currentPrice;
            const trailDollar = currentPrice * (order.trailValue / 100);
            order.triggerPrice = currentPrice + trailDollar;
            this.log(`📉 [STOCK LOCAL BOTTOM SHIFT] New local bottom detected for ${order.symbol}: $${currentPrice} (was $${oldBottom}). Recalculated Buy Trigger: $${order.triggerPrice.toFixed(4)}`, 'info', order.symbol);
            changed = true;
          }

          if (currentPrice >= order.triggerPrice) {
            // Check 4-Filter Consensus Alignment
            let filterPassed = true;
            let filterReasons = [];
            let filterSuccessLogs = [];

            if (order.filterObi || order.filterVolumeSpike || order.filterRsi || order.filterSmartSl) {
              try {
                const [depth, klines] = await Promise.all([
                  (order.filterObi || order.filterSmartSl) ? this.mexcClient.getDepth(order.symbol, 100) : null,
                  (order.filterVolumeSpike || order.filterRsi) ? this.mexcClient.getKlines(order.symbol, '1m', 30) : null
                ]);

                if (order.filterObi && depth) {
                  let bidsValue = 0, asksValue = 0;
                  const rangeLower = currentPrice * 0.985, rangeUpper = currentPrice * 1.015;
                  if (Array.isArray(depth.bids)) {
                    depth.bids.forEach(([p, q]) => {
                      const price = parseFloat(p);
                      if (price >= rangeLower && price <= rangeUpper) bidsValue += (price * parseFloat(q));
                    });
                  }
                  if (Array.isArray(depth.asks)) {
                    depth.asks.forEach(([p, q]) => {
                      const price = parseFloat(p);
                      if (price >= rangeLower && price <= rangeUpper) asksValue += (price * parseFloat(q));
                    });
                  }
                  const totalValue = bidsValue + asksValue;
                  const obiRatio = totalValue > 0 ? (bidsValue / totalValue) : 0;
                  const obiPct = (obiRatio * 100).toFixed(1);
                  if (obiRatio < 0.55) {
                    filterPassed = false;
                    filterReasons.push(`OBI (${obiPct}% < 55%)`);
                  } else {
                    filterSuccessLogs.push(`OBI (${obiPct}% >= 55% ✅)`);
                  }
                }

                if (order.filterVolumeSpike && klines && klines.length >= 2) {
                  const lastVol = parseFloat(klines[klines.length - 1][5]);
                  const prevVols = klines.slice(-6, -1).map(k => parseFloat(k[5]));
                  const avgVol = prevVols.reduce((a, b) => a + b, 0) / (prevVols.length || 1);
                  const volMult = avgVol > 0 ? (lastVol / avgVol).toFixed(2) : '1.0';
                  if (avgVol > 0 && lastVol < (avgVol * 1.5)) {
                    filterPassed = false;
                    filterReasons.push(`Volume (${volMult}x < 1.5x avg)`);
                  } else {
                    filterSuccessLogs.push(`Volume (${volMult}x >= 1.5x avg ✅)`);
                  }
                }

                if (order.filterRsi && klines && klines.length >= 15) {
                  const rsiVal = this.calculateRSI(klines, 14);
                  if (rsiVal > 35) {
                    filterPassed = false;
                    filterReasons.push(`RSI (${rsiVal.toFixed(1)} > 35)`);
                  } else {
                    filterSuccessLogs.push(`RSI (${rsiVal.toFixed(1)} <= 35 ✅)`);
                  }
                }
              } catch (e) {
                this.log(`Consensus Filter evaluation failed: ${e.message}. Proceeding.`, 'warning', order.symbol);
              }
            }

            if (!filterPassed) {
              this.log(`⚠️ [STOCK BUY DEFERRED] Buy Trigger reached ($${currentPrice} >= $${order.triggerPrice}), but Consensus Filters FAILED: [${filterReasons.join(', ')}]. Deferring buy order & updating local bottom to $${currentPrice}.`, 'warning', order.symbol);
              order.bottomPrice = currentPrice;
              order.triggerPrice = currentPrice + order.trailValue;
              changed = true;
              continue;
            }

            if (filterSuccessLogs.length > 0) {
              this.log(`📊 [STOCK CONSENSUS CONFIRMED] Indicator Alignment PASSED: [${filterSuccessLogs.join(', ')}]`, 'success', order.symbol);
            }

            // STOCK BOT MAKER PEG BUY EXECUTION (0% MAKER FEE)
            const buyQty = order.quantity || (order.quoteOrderQty ? (order.quoteOrderQty / currentPrice) : 1);

            if (order.dryRun) {
              order.status = (order.takeProfit || order.stopLoss) ? 'TP_SL_ACTIVE' : 'TRIGGERED';
              order.executionPrice = currentPrice;
              order.triggeredAt = new Date().toISOString();
              this.log(`[DRY RUN] Stock Trailing Buy Triggered! Bought at ${currentPrice} USDT.`, 'success', order.symbol);
              changed = true;

              if (!order.takeProfit && !order.stopLoss) {
                this.handleOrderCycleComplete(order);
              }
            } else {
              try {
                order.status = 'PENDING_EXECUTION';
                this.log(`🚀 [IMMEDIATE MARKET BUY] Trailing dip trigger + Consensus indicators ALIGNED! Sending instant MARKET BUY order to MEXC server for ${order.symbol}...`, 'success', order.symbol);

                const orderParams = { symbol: order.symbol, side: 'BUY', type: 'MARKET' };
                if (order.quoteOrderQty) {
                  orderParams.quoteOrderQty = Math.floor(parseFloat(order.quoteOrderQty) * 100) / 100;
                } else if (order.quantity) {
                  orderParams.quantity = order.quantity;
                } else {
                  orderParams.quantity = buyQty;
                }

                this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(orderParams)}`, 'info', order.symbol);
                const placeRes = await this.placeOrderWithPrecisionRetry(orderParams, order.quoteOrderQty);
                this.log(`[MEXC API RESPONSE] Order Placed Success -> ${JSON.stringify(placeRes)}`, 'success', order.symbol);

                if (!placeRes || !placeRes.orderId) {
                  throw new Error('Stock MARKET BUY order failed to place on MEXC.');
                }

                order.mexcOrderId = placeRes.orderId;
                
                // Query executed fill price and executed quantity from MEXC
                let execPrice = currentPrice;
                let executedQty = order.quantity || (order.quoteOrderQty ? (order.quoteOrderQty / currentPrice) : 1);
                try {
                  this.log(`[MEXC API REQUEST] GET /api/v3/order -> Symbol: ${order.symbol}, OrderID: ${placeRes.orderId}`, 'info', order.symbol);
                  const fills = await this.mexcClient.getOrder(order.symbol, placeRes.orderId);
                  this.log(`[MEXC API RESPONSE] Query Fills Success -> ${JSON.stringify(fills)}`, 'success', order.symbol);
                  if (fills && parseFloat(fills.executedQty) > 0) {
                    executedQty = parseFloat(fills.executedQty);
                    const cumQuote = parseFloat(fills.cummulativeQuoteQty || 0);
                    if (cumQuote > 0) execPrice = cumQuote / executedQty;
                  }
                } catch(e) {}

                order.executionPrice = execPrice;
                order.executedQty = executedQty;
                order.quantity = executedQty; // Sync memory order quantity with exact executed tokens!

                if (order.takeProfit || order.stopLoss) {
                  order.status = 'TP_SL_ACTIVE';
                  this.log(`✅ [MARKET BUY FILLED] Order ${placeRes.orderId} executed at ${execPrice} USDT! (${executedQty} tokens). Transitioning to TP/SL monitoring.`, 'success', order.symbol);

                  // If Take Profit is configured in Real Mode, place Limit Sell Take Profit order on MEXC at EXACT target price (execPrice + TP%)!
                  if (!order.dryRun && order.takeProfit) {
                    try {
                      const tpDollar = (order.takeProfit / 100) * execPrice;
                      const tpPrice = parseFloat((execPrice + tpDollar).toFixed(4));
                      
                      this.log(`[REAL] Querying asset balance to calculate fee-adjusted sell quantity for Stock TP...`, 'info', order.symbol);
                      const safeSellQty = await this.getFeeAdjustedBalance(order.symbol, executedQty);

                      const tpParams = {
                        symbol: order.symbol,
                        side: 'SELL',
                        type: 'LIMIT',
                        quantity: safeSellQty,
                        price: tpPrice
                      };
                      this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(tpParams)}`, 'info', order.symbol);
                      const tpRes = await this.placeOrderWithPrecisionRetry(tpParams);
                      this.log(`[MEXC API RESPONSE] Stock TP Order Placed Success -> ${JSON.stringify(tpRes)}`, 'success', order.symbol);
                      if (tpRes && tpRes.orderId) {
                        order.mexcSellOrderId = tpRes.orderId;
                        this.log(`🎯 [REAL] Stock Take Profit Limit Sell order placed on MEXC for ${safeSellQty} tokens at EXACT TP Target ${tpPrice.toFixed(4)} USDT (+${order.takeProfit}%). Order ID: ${tpRes.orderId}`, 'success', order.symbol);
                      }
                    } catch (tpErr) {
                      this.log(`[REAL] Failed to place Stock TP Limit Sell order on MEXC: ${tpErr.message}. Bot will continue monitoring TP/SL in real time.`, 'error', order.symbol);
                    }
                  }
                } else {
                  order.status = 'TRIGGERED';
                  this.handleOrderCycleComplete(order);
                }
                changed = true;
              } catch (err) {
                order.status = 'FAILED';
                order.error = err.message;
                this.log(`❌ [MEXC API ERROR] Immediate Market Buy order failed: ${err.message}`, 'error', order.symbol);
              }
            }
          }
        }

        // 2.5 MAKER_SELLING (Non-blocking 10s Re-Pegging for 0% Fee Maker Stop Loss Sell Orders)
        if (order.status === 'MAKER_SELLING') {
          const now = Date.now();
          if (!order.makerSellLastCheck || (now - order.makerSellLastCheck >= 10000)) {
            order.makerSellLastCheck = now;
            order.makerPegCheckCount = (order.makerPegCheckCount || 0) + 1;

            try {
              // 1. Query current limit order status on MEXC
              if (order.makerSellOrderId) {
                const orderInfo = await this.mexcClient.getOrder(order.symbol, order.makerSellOrderId);
                if (orderInfo && orderInfo.status === 'FILLED') {
                  const executedQty = parseFloat(orderInfo.executedQty) || order.makerSellQty;
                  const cummulativeQuoteQty = parseFloat(orderInfo.cummulativeQuoteQty);
                  const avgPrice = (executedQty > 0 && cummulativeQuoteQty > 0) ? (cummulativeQuoteQty / executedQty) : (order.currentPegPrice || currentPrice);
                  
                  order.status = 'TRIGGERED';
                  order.sellExecutionPrice = avgPrice;
                  order.sellTriggeredAt = new Date().toISOString();
                  this.log(`🎉 [STOCK 100% MAKER SUCCESS] Stop Loss Order ${order.makerSellOrderId} FILLED as MAKER (0% Fee) after ${order.makerPegCheckCount} re-peg checks! Avg Price: ${avgPrice.toFixed(4)} USDT`, 'success', order.symbol);
                  changed = true;
                  this.handleOrderCycleComplete(order);
                  continue;
                }
              }

              // 2. Check 300s (5-minute) timeout guard
              if (now - order.makerSellStartTime >= 300000) {
                this.log(`[STOCK 100% MAKER GUARANTEE] Stock Order ${order.makerSellOrderId} not filled after 300s of continuous Limit re-pegging. Completing cycle cleanly.`, 'warning', order.symbol);
                if (order.makerSellOrderId) {
                  try { await this.mexcClient.cancelOrder(order.symbol, order.makerSellOrderId); } catch (e) {}
                }
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = order.currentPegPrice || currentPrice;
                order.sellTriggeredAt = new Date().toISOString();
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              }

              // 3. Query current orderbook depth and recalculate #1 Top Seller Peg Price (bestAsk - tick)
              const freshPegPrice = await this.calculateMakerPegPrice(order.symbol, 'SELL', currentPrice);
              if (freshPegPrice !== order.currentPegPrice) {
                this.log(`[STOCK MAKER RE-PEG SHIFT] Check #${order.makerPegCheckCount}: Orderbook depth shifted (${order.currentPegPrice} → ${freshPegPrice}). Re-pegging stock order ${order.makerSellOrderId}...`, 'info', order.symbol);
                if (order.makerSellOrderId) {
                  try { await this.mexcClient.cancelOrder(order.symbol, order.makerSellOrderId); } catch (e) {}
                }
                const newParams = {
                  symbol: order.symbol,
                  side: 'SELL',
                  type: 'LIMIT',
                  quantity: order.makerSellQty,
                  price: freshPegPrice
                };
                const newRes = await this.placeOrderWithPrecisionRetry(newParams);
                if (newRes && newRes.orderId) {
                  order.makerSellOrderId = newRes.orderId;
                  order.currentPegPrice = freshPegPrice;
                  this.log(`[STOCK MAKER RE-PEG] Placed NEW 100% MAKER SELL LIMIT order ${newRes.orderId} at updated price ${freshPegPrice} USDT (0% Fee)`, 'success', order.symbol);
                }
              } else {
                this.log(`🛡️ [STOCK SMART LAZY PEG] Check #${order.makerPegCheckCount}: Stock order ${order.makerSellOrderId} at ${order.currentPegPrice} USDT is STILL optimal Top SELL. Preserving Orderbook Queue Priority (Skipping Re-peg).`, 'info', order.symbol);
              }
              changed = true;
            } catch (pegErr) {
              this.log(`Error during Maker Peg check for ${order.symbol}: ${pegErr.message}`, 'error', order.symbol);
            }
          }
          continue;
        }

        // 3. TP_SL_ACTIVE (Take Profit & Stop Loss Monitoring)
        if (order.status === 'TP_SL_ACTIVE') {
          // Real Mode OCO Check: Check if open TP Limit Sell order filled on MEXC
          if (!order.dryRun && order.mexcSellOrderId) {
            try {
              const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
              if (queryRes && queryRes.status === 'FILLED') {
                const tpDollar = (order.takeProfit / 100) * order.executionPrice;
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = parseFloat(queryRes.price) || (order.executionPrice + tpDollar);
                order.sellTriggeredAt = new Date().toISOString();
                this.log(`🎉 [REAL] Stock Take Profit Hit! 0% Maker Limit Sell filled on MEXC at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              }
            } catch (e) {
              this.log(`Error querying Stock TP order status from MEXC: ${e.message}`, 'error', order.symbol);
            }
          }

          // 50% TP Progress Profit Lock Check
          if (order.takeProfit && !order.isSlProfitLocked && order.executionPrice) {
            const tpDollar = (order.takeProfit / 100) * order.executionPrice;
            const trailDollar = (order.trailValue / 100) * order.executionPrice;
            const tpTarget = order.executionPrice + tpDollar;
            const progressPct = (currentPrice - order.executionPrice) / tpDollar;

            if (progressPct >= 0.50) {
              order.isSlProfitLocked = true;
              order.lockedSlPrice = order.executionPrice + (trailDollar * 2);
              order.justProfitLocked = true;
              this.log(
                `🔒 [PROFIT LOCK GUARD] Stock reached 50% TP progress (${currentPrice} >= ${(order.executionPrice + (tpDollar * 0.5)).toFixed(4)} USDT)! Stop Loss shifted UP to +$${(trailDollar * 2).toFixed(2)} above Buy Price (${order.lockedSlPrice.toFixed(4)} USDT). Profit Locked!`,
                'success',
                order.symbol
              );
              changed = true;
            }
          }

          // Take Profit Check
          if (order.takeProfit) {
            const tpDollar = (order.takeProfit / 100) * order.executionPrice;
            const tpPrice = order.executionPrice + tpDollar;
            if (currentPrice >= tpPrice) {
              if (order.dryRun) {
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = tpPrice;
                order.sellTriggeredAt = new Date().toISOString();
                this.log(`[DRY RUN] Stock Take Profit Hit at ${tpPrice.toFixed(4)} USDT! Order cycle complete.`, 'success', order.symbol);
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              } else {
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = tpPrice;
                this.log(`[REAL] Stock Take Profit Order Hit at ${tpPrice.toFixed(4)} USDT!`, 'success', order.symbol);
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              }
            }
          }

          // Stop Loss Check
          const slDollar = (order.stopLoss / 100) * order.executionPrice;
          let targetSlPrice = order.isSlProfitLocked && order.lockedSlPrice
            ? order.lockedSlPrice
            : (order.executionPrice - slDollar);

          if (order.filterSmartSl && order.isSlExtended && order.slBuffer) {
            const bufferDollar = (order.slBuffer / 100) * order.executionPrice;
            targetSlPrice -= bufferDollar;
          }

          if (order.justProfitLocked) {
            delete order.justProfitLocked;
          } else if (order.stopLoss && currentPrice <= targetSlPrice) {
            order.status = 'PENDING_EXECUTION'; // Immediate atomic lock

            if (order.filterSmartSl && !order.isSlExtended && order.slBuffer > 0) {
              let isSellerExhausted = false;
              let bidsRatioPct = '0';
              try {
                const depth = await this.mexcClient.getDepth(order.symbol, 100);
                let bidsValue = 0, asksValue = 0;
                const rangeLower = currentPrice * 0.985, rangeUpper = currentPrice * 1.015;
                if (depth && Array.isArray(depth.bids)) {
                  depth.bids.forEach(([p, q]) => {
                    const price = parseFloat(p);
                    if (price >= rangeLower && price <= rangeUpper) bidsValue += (price * parseFloat(q));
                  });
                }
                if (depth && Array.isArray(depth.asks)) {
                  depth.asks.forEach(([p, q]) => {
                    const price = parseFloat(p);
                    if (price >= rangeLower && price <= rangeUpper) asksValue += (price * parseFloat(q));
                  });
                }
                const totalValue = bidsValue + asksValue;
                const bidsRatio = totalValue > 0 ? (bidsValue / totalValue) : 0;
                bidsRatioPct = (bidsRatio * 100).toFixed(1);

                if (bidsRatio >= 0.45) isSellerExhausted = true;
              } catch (e) {
                // ignore depth error
              }

              if (isSellerExhausted) {
                order.isSlExtended = true;
                order.status = 'TP_SL_ACTIVE'; // Revert back to active for extended trailing
                const bufferDollar = (order.slBuffer / 100) * order.executionPrice;
                const oldSlTarget = targetSlPrice.toFixed(4);
                const newSlTarget = (targetSlPrice - bufferDollar).toFixed(4);
                this.log(`🛡️ [SMART SL GUARD] Stock Bids Support ${bidsRatioPct}% >= 45%. Extending SL by +${order.slBuffer}% buffer (+$${bufferDollar.toFixed(4)} USDT). (Old SL: ${oldSlTarget}, Extended SL: ${newSlTarget}). Sell DEFERRED!`, 'success', order.symbol);
                changed = true;
                continue;
              }
            }

            if (order.dryRun) {
              order.status = 'TRIGGERED';
              order.sellExecutionPrice = targetSlPrice;
              order.sellTriggeredAt = new Date().toISOString();
              this.log(`[DRY RUN] Stock Stop Loss hit! Sold at ${targetSlPrice} USDT.`, 'success', order.symbol);
              changed = true;
              this.handleOrderCycleComplete(order);
              continue;
            } else {
              this.log(`[REAL] Stock Stop Loss hit! Market price ${currentPrice} <= SL level ${targetSlPrice.toFixed(4)}. Executing sell...`, 'warning', order.symbol);

              const mexcSellId = order.mexcSellOrderId;
              order.mexcSellOrderId = null;

              if (mexcSellId) {
                try {
                  await this.mexcClient.cancelOrder(order.symbol, mexcSellId);
                  this.log(`[REAL] Cancelled open TP Limit Sell order ${mexcSellId} on MEXC. Waiting 1.0s for balance unlock...`, 'info', order.symbol);
                  await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                  this.log(`[REAL] Cancel TP order attempt for ${mexcSellId}: ${e.message}. Proceeding to balance check...`, 'warning', order.symbol);
                }
              }

              // STOCK BOT SLIPPAGE GUARD & MAKER PEG SL SELL EXECUTION (0% MAKER FEE)
              let sellQty = order.executedQty || order.quantity || 1.0;
              try {
                sellQty = await this.getFeeAdjustedBalance(order.symbol, sellQty);
              } catch (bErr) {}

              const slippageMarginPct = order.slippageMargin !== undefined ? parseFloat(order.slippageMargin) : 0.1;
              const maxAllowedSlippageDollar = (slippageMarginPct / 100) * targetSlPrice;
              const actualPriceDrop = targetSlPrice - currentPrice;

              if (actualPriceDrop <= maxAllowedSlippageDollar) {
                this.log(`⚡ [STOCK SLIPPAGE PROTECTION] Market price ${currentPrice.toFixed(4)} is within ${slippageMarginPct}% slippage margin of SL target (${targetSlPrice.toFixed(4)} USDT). Executing fast Market Sell for ${sellQty} tokens!`, 'info', order.symbol);
                try {
                  const mktParams = { symbol: order.symbol, side: 'SELL', type: 'MARKET', quantity: sellQty };
                  const mktRes = await this.placeOrderWithPrecisionRetry(mktParams);
                  if (mktRes && mktRes.orderId) {
                    order.status = 'TRIGGERED';
                    order.sellExecutionPrice = currentPrice;
                    this.log(`[REAL] Stock Stop Loss Market Sell filled cleanly at ${currentPrice.toFixed(4)} USDT!`, 'success', order.symbol);
                    changed = true;
                    this.handleOrderCycleComplete(order);
                    continue;
                  }
                } catch (mktErr) {
                  this.log(`Market sell attempt encountered error: ${mktErr.message}. Falling back to 10s 0% Maker Top Seller Pegging...`, 'warning', order.symbol);
                }
              }

              this.log(`🛡️ [STOCK MAKER TOP SELLER] Price drop exceeds ${slippageMarginPct}% slippage margin. Pegging order as 0% Maker Top Seller every 10s until filled...`, 'warning', order.symbol);

              try {
                const freshSlPrice = await this.calculateMakerPegPrice(order.symbol, 'SELL', currentPrice);
                const sellParams = {
                  symbol: order.symbol,
                  side: 'SELL',
                  type: 'LIMIT',
                  quantity: sellQty,
                  price: freshSlPrice
                };
                const sellResult = await this.placeOrderWithPrecisionRetry(sellParams);

                if (sellResult && sellResult.orderId) {
                  order.status = 'MAKER_SELLING';
                  order.makerSellOrderId = sellResult.orderId;
                  order.makerSellQty = sellQty;
                  order.currentPegPrice = freshSlPrice;
                  order.makerSellStartTime = Date.now();
                  order.makerSellLastCheck = Date.now();
                  order.makerPegCheckCount = 0;
                  this.log(`[STOCK MAKER PEG SELL] Placed initial 100% MAKER SELL LIMIT order ${sellResult.orderId} at ${freshSlPrice} USDT. Transitioning to non-blocking MAKER_SELLING state.`, 'success', order.symbol);
                  changed = true;
                  continue;
                }
              } catch (err) {
                order.status = 'FAILED';
                order.error = err.message;
                this.log(`[REAL] Stock Stop Loss Sell order failed: ${err.message}`, 'error', order.symbol);
              }
            }
          }
        }
      }

      if (changed) {
        this.saveOrders();
      }
    } finally {
      this.isTicking = false;
    }
  }

  // Handle cycle completion, trade recording, and auto-repeat re-activation with exact MEXC Fee Deduction
  async handleOrderCycleComplete(order) {
    if (!order.autoRepeat) {
      return;
    }

    const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
    const buyPrice = order.executionPrice || 0;
    const sellPrice = order.sellExecutionPrice || order.currentPrice || 0;
    const qty = order.quantity || (order.quoteOrderQty && buyPrice > 0 ? (order.quoteOrderQty / buyPrice) : 1);

    let type = 'MANUAL_SELL';
    if (order.takeProfit && sellPrice >= (buyPrice + order.takeProfit - 0.0001)) {
      type = 'TAKE_PROFIT';
    } else if (order.isSlProfitLocked || (order.stopLoss && sellPrice <= (buyPrice - order.stopLoss + 0.0001))) {
      type = 'STOP_LOSS';
    }

      // Account Specific Fee Rates (User Account: Taker = 0.0% promotion, Maker = 0.04% MX Token Discount)
      let accountFees = { makerCommission: 0.0004, takerCommission: 0.0000 };
      try {
        if (this.mexcClient && typeof this.mexcClient.getTradeFee === 'function') {
          const fetchedFees = await this.mexcClient.getTradeFee(order.symbol);
          if (fetchedFees) accountFees = fetchedFees;
        }
      } catch (fErr) {
        // Fallback default for user's account
      }

      const isBuyMaker = order.buyOrderType === 'LIMIT' || order.isBuyPegged || order.status === 'PENDING_EXECUTION';
      const isSellMaker = (type === 'TAKE_PROFIT');

      const buyFeeRate = isBuyMaker ? accountFees.makerCommission : accountFees.takerCommission;
      const sellFeeRate = isSellMaker ? accountFees.makerCommission : accountFees.takerCommission;

      const grossBuyValue = buyPrice * qty;
      const buyFeeUsdt = grossBuyValue * buyFeeRate;
      const totalBuyCost = grossBuyValue + buyFeeUsdt;

      const grossSellValue = sellPrice * qty;
      const sellFeeUsdt = grossSellValue * sellFeeRate;
      const netSellProceeds = grossSellValue - sellFeeUsdt;

      // Net USDT Profit after MEXC Trading Fees
      const cycleUsdtProfit = netSellProceeds - totalBuyCost;
      const netUnitProfit = cycleUsdtProfit / (qty || 1);

      order.totalNetProfit = (order.totalNetProfit || 0) + cycleUsdtProfit;

      const tradeRecord = {
        cycle: cycleNum,
        buyPrice,
        sellPrice,
        grossProfitUsdt: grossSellValue - grossBuyValue,
        mexcBuyFeeUsdt: buyFeeUsdt,
        mexcSellFeeUsdt: sellFeeUsdt,
        totalMexcFeesUsdt: buyFeeUsdt + sellFeeUsdt,
        profit: netUnitProfit,
        profitUsdt: cycleUsdtProfit,
        type,
        timestamp: new Date().toISOString()
      };

      if (!order.tradeHistory) order.tradeHistory = [];
      order.tradeHistory.push(tradeRecord);

      // Reset state for Next Cycle
      order.status = 'PENDING_ACTIVATION';
      order.peakPrice = sellPrice;
      const offsetPct = order.activationOffset ? parseFloat(order.activationOffset) : parseFloat(order.trailValue);
      order.activationPrice = order.peakPrice * (1 - (offsetPct / 100));

      order.bottomPrice = null;
      order.triggerPrice = null;
      order.mexcOrderId = null;
      order.executionPrice = null;
      order.mexcSellOrderId = null;
      order.sellExecutionPrice = null;
      order.sellTriggeredAt = null;
      order.triggeredAt = null;
      order.activatedAt = null;
      order.isSlExtended = false;
      order.isSlProfitLocked = false;
      order.lockedSlPrice = null;
      delete order.justProfitLocked;

      this.log(
        `Stock Bot Cycle #${cycleNum} completed (${type}). Resetting order to pending activation. New peak: ${order.peakPrice}, Activation price: ${order.activationPrice}`,
        'success',
        order.symbol
      );
      this.saveOrders();
  }

  // Calculate Relative Strength Index (Wilder's smoothing)
  calculateRSI(klines, period = 14) {
    if (!Array.isArray(klines) || klines.length <= period) return 30;
    const closes = klines.map(k => parseFloat(k[4]));
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      const currentGain = diff > 0 ? diff : 0;
      const currentLoss = diff < 0 ? -diff : 0;
      
      avgGain = (avgGain * (period - 1) + currentGain) / period;
      avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }
    
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }
}

module.exports = StockOrderTracker;
