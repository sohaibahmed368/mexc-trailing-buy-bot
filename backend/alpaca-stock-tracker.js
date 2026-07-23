const fs = require('fs');
const path = require('path');

class AlpacaStockOrderTracker {
  constructor(alpacaClient, io) {
    this.alpacaClient = alpacaClient;
    this.io = io;

    this.dataDir = path.join(__dirname, 'data');
    this.ordersPath = path.join(this.dataDir, 'alpaca-stock-orders.json');
    this.logsPath = path.join(this.dataDir, 'alpaca-stock-logs.json');

    this.orders = [];
    this.logs = [];

    this.isTracking = false;
    this.intervalId = null;
    this.pollInterval = 1000; // 1 second loop
    this.isTicking = false;

    this.initStorage();
  }

  initStorage() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    if (fs.existsSync(this.ordersPath)) {
      try {
        this.orders = JSON.parse(fs.readFileSync(this.ordersPath, 'utf8'));
      } catch (e) {
        this.orders = [];
      }
    } else {
      fs.writeFileSync(this.ordersPath, JSON.stringify([]));
    }

    if (fs.existsSync(this.logsPath)) {
      try {
        this.logs = JSON.parse(fs.readFileSync(this.logsPath, 'utf8'));
      } catch (e) {
        this.logs = [];
      }
    } else {
      fs.writeFileSync(this.logsPath, JSON.stringify([]));
    }
  }

  saveOrders() {
    try {
      fs.writeFileSync(this.ordersPath, JSON.stringify(this.orders, null, 2));
      if (this.io) {
        this.io.emit('alpaca_stock_orders_update', this.orders);
      }
    } catch (e) {
      this.log(`Error saving Alpaca stock orders: ${e.message}`, 'error');
    }
  }

  saveLogs() {
    try {
      if (this.logs.length > 500) {
        this.logs = this.logs.slice(0, 500);
      }
      fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2));
    } catch (e) {}
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
      this.io.emit('alpaca_stock_log_entry', logEntry);
    }
    console.log(`[ALPACA STOCK BOT ${type.toUpperCase()}] ${symbol ? `[${symbol}] ` : ''}${message}`);
  }

  getOrders() {
    return this.orders;
  }

  getLogs() {
    return this.logs;
  }

  async createStockOrder(orderData) {
    const {
      symbol,
      trailValue,
      quantity,
      quoteOrderQty,
      orderType,
      dryRun,
      activationPrice,
      takeProfit,
      stopLoss,
      filterSmartSl,
      slBuffer,
      autoRepeat,
      startImmediately,
      activationOffset
    } = orderData;

    const cleanSymbol = symbol.toUpperCase().replace('USDT', '');
    const parsedTrail = parseFloat(trailValue);
    const parsedTakeProfit = takeProfit ? parseFloat(takeProfit) : null;
    const parsedStopLoss = stopLoss ? parseFloat(stopLoss) : null;
    const parsedSlBuffer = slBuffer ? parseFloat(slBuffer) : 0.2;
    let parsedActivationPrice = activationPrice ? parseFloat(activationPrice) : null;

    let initialPrice = 100.0;
    try {
      initialPrice = await this.alpacaClient.getTickerPrice(cleanSymbol);
    } catch (e) {
      throw new Error(`Failed to query initial price for ${cleanSymbol}: ${e.message}`);
    }

    let status = 'RUNNING';
    let activationDirection = null;
    let bottomPrice = null;
    let triggerPrice = null;

    const startInstantBuy = autoRepeat && startImmediately;

    if (startInstantBuy) {
      status = 'TP_SL_ACTIVE';
    } else if (autoRepeat && activationOffset) {
      const offsetPct = parseFloat(activationOffset);
      parsedActivationPrice = initialPrice * (1 - (offsetPct / 100));
      status = 'PENDING_ACTIVATION';
      activationDirection = 'DOWN';
    } else if (parsedActivationPrice !== null) {
      status = 'PENDING_ACTIVATION';
      activationDirection = initialPrice > parsedActivationPrice ? 'DOWN' : 'UP';
    } else {
      bottomPrice = initialPrice;
      const trailDollar = initialPrice * (parsedTrail / 100);
      triggerPrice = initialPrice + trailDollar;
    }

    const newOrder = {
      id: 'alpaca_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      symbol: cleanSymbol,
      trailValue: parsedTrail,
      quantity: quantity ? parseFloat(quantity) : null,
      quoteOrderQty: quoteOrderQty ? parseFloat(quoteOrderQty) : null,
      orderType: orderType || 'MARKET',
      dryRun: !!dryRun,
      status,
      activationPrice: startInstantBuy ? null : parsedActivationPrice,
      activationDirection: startInstantBuy ? null : activationDirection,
      activatedAt: startInstantBuy ? new Date().toISOString() : null,
      takeProfit: parsedTakeProfit,
      stopLoss: parsedStopLoss,
      filterSmartSl: !!filterSmartSl,
      slBuffer: parsedSlBuffer,
      isSlExtended: false,
      isSlProfitLocked: false,
      lockedSlPrice: null,
      alpacaSellOrderId: null,
      sellExecutionPrice: null,
      sellTriggeredAt: null,
      autoRepeat: !!autoRepeat,
      startImmediately: !!startImmediately,
      activationOffset: activationOffset ? parseFloat(activationOffset) : null,
      peakPrice: initialPrice,
      totalNetProfit: 0,
      tradeHistory: [],
      initialPrice,
      bottomPrice,
      triggerPrice,
      currentPrice: initialPrice,
      createdAt: new Date().toISOString(),
      triggeredAt: null,
      alpacaOrderId: null,
      executionPrice: null,
      error: null
    };

    if (startInstantBuy) {
      this.log(`🚀 [INSTANT START] Order created for ${cleanSymbol}. Executing initial Alpaca Market Buy immediately...`, 'info', cleanSymbol);
      if (dryRun) {
        newOrder.executionPrice = initialPrice;
        newOrder.triggeredAt = new Date().toISOString();
        this.log(`[DRY RUN] Alpaca Stock Buy Executed at ${initialPrice} USD.`, 'success', cleanSymbol);
      } else {
        try {
          const buyRes = await this.alpacaClient.placeOrder({
            symbol: cleanSymbol,
            qty: newOrder.quantity,
            notional: newOrder.quoteOrderQty,
            side: 'buy',
            type: 'market'
          });
          newOrder.alpacaOrderId = buyRes.id;
          newOrder.executionPrice = buyRes.filled_avg_price ? parseFloat(buyRes.filled_avg_price) : initialPrice;
          this.log(`✅ [ALPACA BUY EXECUTED] Order ID: ${buyRes.id} at $${newOrder.executionPrice} USD!`, 'success', cleanSymbol);
        } catch (err) {
          this.log(`❌ Initial Alpaca Market Buy failed: ${err.message}`, 'error', cleanSymbol);
          throw err;
        }
      }
    }

    this.orders.push(newOrder);
    this.saveOrders();
    this.startTracking();
    return newOrder;
  }

  async cancelOrder(id) {
    const order = this.orders.find(o => o.id === id);
    if (!order) return;

    if (order.status === 'TP_SL_ACTIVE' && !order.dryRun && order.alpacaSellOrderId) {
      try {
        await this.alpacaClient.cancelOrder(order.alpacaSellOrderId);
        this.log(`Cancelled active Alpaca TP Limit Sell order ${order.alpacaSellOrderId}.`, 'info', order.symbol);
      } catch (e) {}
    }

    order.status = 'CANCELLED';
    this.saveOrders();
    this.log(`Alpaca Stock Order for ${order.symbol} cancelled by user.`, 'warning', order.symbol);
    this.checkTrackingLoop();
  }

  startTracking() {
    if (this.intervalId) return;
    this.isTracking = true;
    this.intervalId = setInterval(async () => {
      await this.tick();
    }, this.pollInterval);
    this.log('Alpaca Stock Bot Tracking Loop Started.', 'info');
  }

  stopTracking() {
    if (!this.isTracking) return;
    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.log('Alpaca Stock Bot Tracking Loop Stopped.', 'info');
  }

  checkTrackingLoop() {
    const hasActive = this.orders.some(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
    if (!hasActive && this.isTracking) {
      this.stopTracking();
    } else if (hasActive && !this.isTracking) {
      this.startTracking();
    }
  }

  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const activeOrders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
      if (activeOrders.length === 0) {
        this.checkTrackingLoop();
        return;
      }

      const symbols = [...new Set(activeOrders.map(o => o.symbol))];
      const prices = {};

      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            prices[symbol] = await this.alpacaClient.getTickerPrice(symbol);
          } catch (e) {}
        })
      );

      let changed = false;

      for (const order of activeOrders) {
        const currentPrice = prices[order.symbol];
        if (!currentPrice) continue;

        order.currentPrice = currentPrice;

        // 1. PENDING ACTIVATION STATE
        if (order.status === 'PENDING_ACTIVATION') {
          if (currentPrice > (order.peakPrice || 0)) {
            order.peakPrice = currentPrice;
            if (order.activationOffset) {
              order.activationPrice = currentPrice * (1 - (order.activationOffset / 100));
            }
            changed = true;
          }

          if (order.activationDirection === 'DOWN' && currentPrice <= order.activationPrice) {
            order.status = 'RUNNING';
            order.activatedAt = new Date().toISOString();
            order.bottomPrice = currentPrice;
            const dollarOffset = currentPrice * (order.trailValue / 100);
            order.triggerPrice = currentPrice + dollarOffset;
            this.log(`📉 [ALPACA ACTIVATION DIP HIT] ${order.symbol} dipped to $${currentPrice}! Trailing buy initialized.`, 'info', order.symbol);
            changed = true;
          }
        }
        // 2. RUNNING TRAILING BUY STATE
        else if (order.status === 'RUNNING') {
          if (currentPrice < order.bottomPrice) {
            order.bottomPrice = currentPrice;
            const dollarOffset = currentPrice * (order.trailValue / 100);
            order.triggerPrice = currentPrice + dollarOffset;
            changed = true;
          }

          if (currentPrice >= order.triggerPrice) {
            order.status = 'TP_SL_ACTIVE';
            order.triggeredAt = new Date().toISOString();

            if (order.dryRun) {
              order.executionPrice = currentPrice;
              this.log(`[DRY RUN] Alpaca Stock Trailing Buy Triggered! Bought at $${currentPrice}.`, 'success', order.symbol);
            } else {
              try {
                const buyRes = await this.alpacaClient.placeOrder({
                  symbol: order.symbol,
                  qty: order.quantity,
                  notional: order.quoteOrderQty,
                  side: 'buy',
                  type: 'market'
                });
                order.alpacaOrderId = buyRes.id;
                order.executionPrice = buyRes.filled_avg_price ? parseFloat(buyRes.filled_avg_price) : currentPrice;
                this.log(`✅ [ALPACA MARKET BUY EXECUTED] ${order.symbol} filled at $${order.executionPrice} USD!`, 'success', order.symbol);
              } catch (err) {
                this.log(`❌ Alpaca Market Buy execution failed: ${err.message}`, 'error', order.symbol);
              }
            }
            changed = true;
          }
        }
        // 3. TP / SL ACTIVE MONITORING STATE
        else if (order.status === 'TP_SL_ACTIVE') {
          const buyPrice = order.executionPrice || order.initialPrice;
          const tpTarget = buyPrice * (1 + (order.takeProfit / 100));
          let slTarget = order.lockedSlPrice || (buyPrice * (1 - (order.stopLoss / 100)));

          // 50% TP Progress Profit Locking
          const tpDistance = tpTarget - buyPrice;
          const currentProfit = currentPrice - buyPrice;
          if (tpDistance > 0 && (currentProfit / tpDistance) >= 0.5 && !order.isSlProfitLocked) {
            order.isSlProfitLocked = true;
            order.lockedSlPrice = buyPrice * 1.001; // Lock 0.1% profit
            this.log(`🛡️ [PROFIT LOCK ACTIVATED] 50% TP progress reached on ${order.symbol}! Locked SL at $${order.lockedSlPrice.toFixed(2)}.`, 'success', order.symbol);
            changed = true;
          }

          // Check TP Limit Fill
          if (currentPrice >= tpTarget) {
            const sellPrice = currentPrice;
            const profitPct = ((sellPrice - buyPrice) / buyPrice) * 100;
            this.log(`🎉 [ALPACA TAKE PROFIT HIT] ${order.symbol} hit TP target at $${sellPrice} (+${profitPct.toFixed(2)}%)!`, 'success', order.symbol);

            order.tradeHistory.push({
              cycle: order.tradeHistory.length + 1,
              buyPrice,
              sellPrice,
              type: 'TAKE_PROFIT',
              profit: profitPct,
              timestamp: new Date().toISOString()
            });

            this.handleCycleReset(order, currentPrice);
            changed = true;
            continue;
          }

          // Check SL Hit
          if (currentPrice <= slTarget) {
            if (order.filterSmartSl && !order.isSlExtended) {
              // Smart SL Buffer Guard
              order.isSlExtended = true;
              slTarget = slTarget * (1 - (order.slBuffer / 100));
              this.log(`🛡️ [SMART SL BUFFER EXTENDED] Extended SL for ${order.symbol} by +${order.slBuffer}% buffer to $${slTarget.toFixed(2)}. Waiting for bounce!`, 'warning', order.symbol);
              changed = true;
              continue;
            }

            const sellPrice = currentPrice;
            const lossPct = ((sellPrice - buyPrice) / buyPrice) * 100;
            this.log(`🔻 [ALPACA STOP LOSS EXECUTED] ${order.symbol} executed SL at $${sellPrice} (${lossPct.toFixed(2)}%).`, 'error', order.symbol);

            order.tradeHistory.push({
              cycle: order.tradeHistory.length + 1,
              buyPrice,
              sellPrice,
              type: 'STOP_LOSS',
              profit: lossPct,
              timestamp: new Date().toISOString()
            });

            this.handleCycleReset(order, currentPrice);
            changed = true;
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

  handleCycleReset(order, currentPrice) {
    if (order.autoRepeat) {
      order.status = 'PENDING_ACTIVATION';
      order.peakPrice = currentPrice;
      order.activatedAt = null;
      order.triggeredAt = null;
      order.executionPrice = null;
      order.alpacaOrderId = null;
      order.isSlExtended = false;
      order.isSlProfitLocked = false;
      order.lockedSlPrice = null;
      if (order.activationOffset) {
        order.activationPrice = currentPrice * (1 - (order.activationOffset / 100));
      }
      this.log(`🔄 [ALPACA AUTO-REPEAT RESET] ${order.symbol} reset for next cycle. Peak set to $${currentPrice}.`, 'info', order.symbol);
    } else {
      order.status = 'TRIGGERED';
      this.log(`🏁 [ALPACA ORDER COMPLETED] ${order.symbol} completed trade cycle.`, 'success', order.symbol);
    }
  }
}

module.exports = AlpacaStockOrderTracker;
