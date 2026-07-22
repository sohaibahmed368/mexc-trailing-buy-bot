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
        this.logs = this.logs.slice(-500);
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
        const secondBid = depth.bids.length > 1 ? parseFloat(depth.bids[1][0]) : bestBid;
        const bestAsk = parseFloat(depth.asks[0][0]);
        const secondAsk = depth.asks.length > 1 ? parseFloat(depth.asks[1][0]) : bestAsk;

        let tick = 0.0001;
        if (bestBid > 1000) tick = 0.01;
        else if (bestBid > 10) tick = 0.001;
        else if (bestBid < 0.1) tick = 0.000001;

        const decimals = tick.toString().includes('.') ? tick.toString().split('.')[1].length : 2;

        if (side.toUpperCase() === 'BUY') {
          // STRICT 100% MAKER BUY RULE: Join Buyer Queue 1 tick safely below bestAsk
          let pegPrice = Math.min(bestBid, bestAsk - (tick * 2));
          if (pegPrice <= 0) pegPrice = Math.max(0.00000001, bestBid);
          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          if (pegPrice >= bestAsk) {
            pegPrice = parseFloat(Math.max(0.00000001, bestAsk - (tick * 2)).toFixed(decimals));
          }
          this.log(`[STOCK MAKER PEG BUY] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Guaranteed MAKER BUY Price: ${pegPrice} (< Ask ${bestAsk} ✅)`, 'info', symbol);
          return pegPrice;
        } else {
          // STRICT 100% MAKER SELL RULE: Join Seller Queue 1 tick safely above bestBid
          let pegPrice = Math.max(bestAsk, bestBid + (tick * 2));
          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          if (pegPrice <= bestBid) {
            pegPrice = parseFloat((bestBid + (tick * 2)).toFixed(decimals));
          }
          this.log(`[STOCK MAKER PEG SELL] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Guaranteed MAKER SELL Price: ${pegPrice} (> Bid ${bestBid} ✅)`, 'info', symbol);
          return pegPrice;
        }
      }
    } catch (err) {
      this.log(`[STOCK MAKER PEG] Failed to query depth for ${symbol}: ${err.message}. Using fallback price ${fallbackPrice}`, 'warning', symbol);
    }
    return fallbackPrice;
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
        const offset = config.activationOffset !== undefined && config.activationOffset !== null && config.activationOffset !== '' 
          ? parseFloat(config.activationOffset) 
          : parseFloat(config.trailValue);
        initialActivationPrice = initialPeak - offset;
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

    const newOrder = {
      id: Date.now().toString(),
      symbol: config.symbol,
      trailValue: parseFloat(config.trailValue),
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
      triggerPrice: isStartImmediate ? (currentPrice + parseFloat(config.trailValue)) : null,
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

  // Robust Helper: Retry order placement with varying quantity precisions to overcome MEXC 400 "quantity scale is invalid" errors
  async placeOrderWithPrecisionRetry(orderParams, quoteOrderQty = null) {
    let lastErr = null;
    const decimalsToTry = [10000, 1000, 100, 10, 1, 0.1];

    if (orderParams.quantity) {
      const rawQty = orderParams.quantity;
      for (const mult of decimalsToTry) {
        let qtyToTry = Math.floor(rawQty * mult) / mult;
        if (qtyToTry <= 0) qtyToTry = Math.round(rawQty);
        if (qtyToTry <= 0) continue;

        try {
          const attemptParams = { ...orderParams, quantity: qtyToTry };
          const res = await this.mexcClient.placeOrder(attemptParams);
          if (res && res.orderId) return res;
        } catch (err) {
          lastErr = err;
          const msg = err.message || '';
          if (msg.includes('quantity scale') || msg.includes('400') || msg.includes('code":400')) {
            this.log(`[REAL] Quantity scale retry for ${orderParams.symbol} at multiplier ${mult} (Qty: ${qtyToTry})...`, 'warning', orderParams.symbol);
            continue;
          }
          throw err;
        }
      }
    }

    // Fallback for MARKET BUY: use quoteOrderQty if available
    if (orderParams.type === 'MARKET' && orderParams.side === 'BUY' && quoteOrderQty) {
      try {
        const attemptParams = {
          symbol: orderParams.symbol,
          side: 'BUY',
          type: 'MARKET',
          quoteOrderQty
        };
        const res = await this.mexcClient.placeOrder(attemptParams);
        if (res && res.orderId) return res;
      } catch (err) {
        lastErr = err;
      }
    }

    throw lastErr || new Error('Failed to execute order after quantity scale precision retries.');
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
              order.activationPrice = currentPrice - order.activationOffset;
              this.log(`Dynamic Peak shifted UP to ${currentPrice}. Updated activationPrice: ${order.activationPrice}`, 'info', order.symbol);
              changed = true;
            }
          }

          if (currentPrice <= order.activationPrice) {
            order.status = 'RUNNING';
            order.bottomPrice = currentPrice;
            order.triggerPrice = currentPrice + order.trailValue;
            order.activatedAt = new Date().toISOString();
            this.log(`Activation price hit (${currentPrice} <= ${order.activationPrice}). Status set to RUNNING. Initial bottom: ${currentPrice}`, 'info', order.symbol);
            changed = true;
          }
        }

        // 2. RUNNING (Trailing Dip Trailing)
        if (order.status === 'RUNNING') {
          if (currentPrice < order.bottomPrice) {
            order.bottomPrice = currentPrice;
            order.triggerPrice = currentPrice + order.trailValue;
            this.log(`New bottom price found: ${currentPrice}. Updated triggerPrice: ${order.triggerPrice}`, 'info', order.symbol);
            changed = true;
          }

          if (currentPrice >= order.triggerPrice) {
            // Check 4-Filter Consensus Alignment
            let filterPassed = true;
            let filterReasons = [];

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
                  if (obiRatio < 0.55) {
                    filterPassed = false;
                    filterReasons.push(`OBI (${(obiRatio * 100).toFixed(1)}% < 55%)`);
                  }
                }

                if (order.filterVolumeSpike && klines && klines.length >= 2) {
                  const lastVol = parseFloat(klines[klines.length - 1][5]);
                  const prevVols = klines.slice(-6, -1).map(k => parseFloat(k[5]));
                  const avgVol = prevVols.reduce((a, b) => a + b, 0) / (prevVols.length || 1);
                  if (avgVol > 0 && lastVol < (avgVol * 1.5)) {
                    filterPassed = false;
                    filterReasons.push(`Volume (${lastVol.toFixed(1)} < 1.5x avg ${avgVol.toFixed(1)})`);
                  }
                }

                if (order.filterRsi && klines && klines.length >= 15) {
                  const rsiVal = this.calculateRSI(klines, 14);
                  if (rsiVal > 35) {
                    filterPassed = false;
                    filterReasons.push(`RSI (${rsiVal.toFixed(1)} > 35)`);
                  }
                }
              } catch (e) {
                this.log(`Consensus Filter evaluation failed: ${e.message}. Proceeding.`, 'warning', order.symbol);
              }
            }

            if (!filterPassed) {
              this.log(`Buy Trigger reached (${currentPrice} >= ${order.triggerPrice}), but Consensus Filters FAILED: [${filterReasons.join(', ')}]. Deferring buy order.`, 'warning', order.symbol);
              order.bottomPrice = currentPrice;
              order.triggerPrice = currentPrice + order.trailValue;
              changed = true;
              continue;
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
              order.status = 'PENDING_EXECUTION';
              this.log(`Placing Stock LIMIT BUY order at Pegged Depth Price on MEXC for ${order.symbol}...`, 'info', order.symbol);

              try {
                const freshBuyPrice = await this.calculateMakerPegPrice(order.symbol, 'BUY', currentPrice);
                const orderParams = {
                  symbol: order.symbol,
                  side: 'BUY',
                  type: 'LIMIT',
                  quantity: buyQty,
                  price: freshBuyPrice
                };
                const result = await this.placeOrderWithPrecisionRetry(orderParams, order.quoteOrderQty);

                if (result && result.orderId) {
                  order.mexcOrderId = result.orderId;
                  const fills = await this.waitForLimitOrderFill(order.symbol, result.orderId, 'BUY', buyQty, freshBuyPrice, 300000, 10000);
                  if (!fills || !fills.filled || !fills.executedQty) {
                    order.status = 'PENDING_ACTIVATION';
                    order.error = 'Stock BUY order unfilled on MEXC after repeg shifts and fallback.';
                    this.log(`[REAL] Stock BUY order failed to fill on MEXC. Aborting TP/SL placement.`, 'error', order.symbol);
                    this.saveOrders();
                    changed = true;
                    continue;
                  }
                  order.executionPrice = fills.avgPrice || freshBuyPrice;
                  order.status = (order.takeProfit || order.stopLoss) ? 'TP_SL_ACTIVE' : 'TRIGGERED';
                  this.log(`[REAL] Stock Pegged Limit Buy order placed & processed! Order ID: ${result.orderId}. Avg Fill Price: ${order.executionPrice}`, 'success', order.symbol);
                  if (!order.takeProfit && !order.stopLoss) {
                    this.handleOrderCycleComplete(order);
                  }
                  changed = true;
                }
              } catch (err) {
                order.status = 'FAILED';
                order.error = err.message;
                this.log(`[REAL] Stock Buy order failed: ${err.message}`, 'error', order.symbol);
              }
            }
          }
        }

        // 3. TP_SL_ACTIVE (Take Profit & Stop Loss Monitoring)
        if (order.status === 'TP_SL_ACTIVE') {
          // 50% TP Progress Profit Lock Check
          if (order.takeProfit && !order.isSlProfitLocked && order.executionPrice) {
            const tpTarget = order.executionPrice + order.takeProfit;
            const progressPct = (currentPrice - order.executionPrice) / (tpTarget - order.executionPrice);

            if (progressPct >= 0.50) {
              order.isSlProfitLocked = true;
              order.lockedSlPrice = order.executionPrice + (order.trailValue * 2);
              order.justProfitLocked = true;
              this.log(
                `🔒 [PROFIT LOCK GUARD] Stock reached 50% TP progress (${currentPrice} >= ${order.executionPrice + (order.takeProfit * 0.5)} USDT)! Stop Loss shifted UP to +$${(order.trailValue * 2)} above Buy Price (${order.lockedSlPrice} USDT). Profit Locked!`,
                'success',
                order.symbol
              );
              changed = true;
            }
          }

          // Take Profit Check
          if (order.takeProfit) {
            const tpPrice = order.executionPrice + order.takeProfit;
            if (currentPrice >= tpPrice) {
              if (order.dryRun) {
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = tpPrice;
                order.sellTriggeredAt = new Date().toISOString();
                this.log(`[DRY RUN] Stock Take Profit Hit at ${tpPrice} USDT! Order cycle complete.`, 'success', order.symbol);
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              } else {
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = tpPrice;
                this.log(`[REAL] Stock Take Profit Order Hit at ${tpPrice} USDT!`, 'success', order.symbol);
                changed = true;
                this.handleOrderCycleComplete(order);
                continue;
              }
            }
          }

          // Stop Loss Check
          let targetSlPrice = order.isSlProfitLocked && order.lockedSlPrice
            ? order.lockedSlPrice
            : (order.executionPrice - order.stopLoss);

          if (order.filterSmartSl && order.isSlExtended && order.slBuffer) {
            targetSlPrice -= order.slBuffer;
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
                this.log(`🛡️ [SMART SL GUARD] Stock Bids Support ${bidsRatioPct}% >= 45%. Extending SL by +$${order.slBuffer}. Sell DEFERRED!`, 'success', order.symbol);
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
                  this.log(`[REAL] Cancelled TP Limit Sell order ${mexcSellId} on MEXC.`, 'info', order.symbol);
                  await new Promise(r => setTimeout(r, 1000));
                } catch (e) {
                  // ignore
                }
              }

              // STOCK BOT MAKER PEG SL SELL EXECUTION (0% MAKER FEE)
              const sellQty = order.quantity || 1.0;

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
                  const slFills = await this.waitForLimitOrderFill(order.symbol, sellResult.orderId, 'SELL', sellQty, freshSlPrice, 300000, 10000);
                  if (!slFills || !slFills.filled) {
                    this.log(`[REAL] Stock Stop Loss LIMIT Sell order ${sellResult.orderId} not yet filled. Retaining active state for continuous depth re-pegging...`, 'warning', order.symbol);
                    order.status = 'TP_SL_ACTIVE';
                    this.saveOrders();
                    changed = true;
                    continue;
                  }
                  order.status = 'TRIGGERED';
                  order.sellExecutionPrice = slFills.avgPrice || freshSlPrice;
                  this.log(`[REAL] Stock Stop Loss Limit Sell order executed! Order ID: ${sellResult.orderId}. Avg Fill Price: ${order.sellExecutionPrice}`, 'success', order.symbol);
                  changed = true;
                  this.handleOrderCycleComplete(order);
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
    if (order.status === 'TRIGGERED' && order.autoRepeat) {
      const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
      const buyPrice = order.executionPrice;
      const sellPrice = order.sellExecutionPrice || order.currentPrice;
      const qty = order.quantity || (order.quoteOrderQty && buyPrice > 0 ? (order.quoteOrderQty / buyPrice) : 1);

      let type = 'MANUAL_SELL';
      if (order.takeProfit && Math.abs(sellPrice - (buyPrice + order.takeProfit)) < 0.0001) {
        type = 'TAKE_PROFIT';
      } else if (order.stopLoss) {
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
      const offset = order.activationOffset ? order.activationOffset : order.trailValue;
      order.activationPrice = order.peakPrice - offset;

      order.bottomPrice = null;
      order.triggerPrice = null;
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
  }
}

module.exports = StockOrderTracker;
