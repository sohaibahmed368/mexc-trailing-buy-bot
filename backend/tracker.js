const fs = require('fs');
const path = require('path');

class OrderTracker {
  constructor(mexcClient, io) {
    this.mexcClient = mexcClient;
    this.io = io;
    this.ordersPath = path.join(__dirname, 'data', 'orders.json');
    this.logsPath = path.join(__dirname, 'data', 'logs.json');
    
    this.orders = [];
    this.logs = [];
    this.intervalId = null;
    this.pollInterval = 1000; // default 1 second polling
    
    this.initStorage();
  }

  // Ensure storage directories and files exist
  initStorage() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
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
    fs.writeFileSync(this.ordersPath, JSON.stringify(this.orders, null, 2));
    this.io.emit('orders_update', this.orders);
  }

  log(message, type = 'info', symbol = null) {
    const logEntry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      message,
      type, // 'info', 'success', 'warning', 'error'
      symbol
    };
    
    this.logs.unshift(logEntry); // Add to beginning of logs
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(0, 500); // limit to 500 logs
    }
    
    fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2));
    this.io.emit('log_entry', logEntry);
  }

  getOrders() {
    return this.orders;
  }

  getLogs() {
    return this.logs;
  }

  async getActualOrderFills(symbol, orderId, fallbackPrice) {
    try {
      // Wait 1.0 second for order processing settlement on MEXC
      await new Promise(r => setTimeout(r, 1000));
      
      const orderInfo = await this.mexcClient.getOrder(symbol, orderId);
      if (orderInfo && (orderInfo.status === 'FILLED' || parseFloat(orderInfo.executedQty) > 0)) {
        const executedQty = parseFloat(orderInfo.executedQty);
        const cummulativeQuoteQty = parseFloat(orderInfo.cummulativeQuoteQty);
        if (executedQty > 0 && cummulativeQuoteQty > 0) {
          const avgPrice = cummulativeQuoteQty / executedQty;
          this.log(`Fetched actual MEXC fill price for order ${orderId}: ${avgPrice.toFixed(4)} USDT (estimated fallback was ${fallbackPrice}).`, 'info', symbol);
          return { avgPrice, executedQty };
        }
      }
    } catch (err) {
      this.log(`Failed to fetch actual order details for ${orderId}: ${err.message}. Using fallback estimates.`, 'warning', symbol);
    }
    return { avgPrice: fallbackPrice, executedQty: null };
  }

  async getFeeAdjustedBalance(symbol, grossQty) {
    const asset = symbol.replace('USDT', '').toUpperCase();
    try {
      // Wait 1.5 seconds for order fill settlement and balance updating on MEXC
      await new Promise(r => setTimeout(r, 1500));
      
      const balances = await this.mexcClient.getBalances();
      const assetBal = balances.find(b => b.asset.toUpperCase() === asset);
      if (assetBal && assetBal.free > 0) {
        this.log(`Fetched asset balance for ${asset}: free balance is ${assetBal.free} (gross quantity estimated: ${grossQty}).`, 'info', symbol);
        // Truncate to 4 decimal places to satisfy MEXC lot/step size precision limits
        const truncated = Math.floor(assetBal.free * 10000) / 10000;
        if (truncated > 0) return truncated;
      }
    } catch (err) {
      this.log(`Balance lookup failed: ${err.message}. Falling back to estimated quantity with fee margin.`, 'warning', symbol);
    }
    
    // Fallback: estimate gross quantity and deduct a 0.2% fee safety margin
    const estimated = grossQty * 0.998;
    const truncatedEst = Math.floor(estimated * 10000) / 10000;
    this.log(`Using fee-adjusted estimated quantity: ${truncatedEst} (gross: ${grossQty})`, 'info', symbol);
    return truncatedEst;
  }

  handleOrderCycleComplete(order) {
    if (!order.autoRepeat) {
      return;
    }

    const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
    const buyPrice = order.executionPrice;
    const sellPrice = order.sellExecutionPrice || order.currentPrice;
    const profit = sellPrice - buyPrice; // per unit profit

    // Determine if Take Profit or Stop Loss hit
    let type = 'MANUAL_SELL';
    if (order.takeProfit && sellPrice >= (buyPrice + order.takeProfit - 0.0001)) {
      type = 'TAKE_PROFIT';
    } else if (order.stopLoss && sellPrice <= (buyPrice - order.stopLoss + 0.0001)) {
      type = 'STOP_LOSS';
    }

    if (!order.tradeHistory) order.tradeHistory = [];
    order.tradeHistory.push({
      cycle: cycleNum,
      buyPrice,
      sellPrice,
      type,
      profit,
      timestamp: new Date().toISOString()
    });

    // Reset to pending activation for next cycle
    order.status = 'PENDING_ACTIVATION';
    order.peakPrice = sellPrice;
    order.activationPrice = order.peakPrice - (order.activationOffset || 0);
    order.bottomPrice = null;
    order.triggerPrice = null;
    order.mexcOrderId = null;
    order.executionPrice = null;
    order.mexcSellOrderId = null;
    order.sellExecutionPrice = null;
    order.sellTriggeredAt = null;
    order.triggeredAt = null;
    order.activatedAt = null;

    this.log(
      `Cycle #${cycleNum} completed (${type}). Resetting order to pending activation. New peak: ${order.peakPrice}, Activation price: ${order.activationPrice}`,
      'success',
      order.symbol
    );
  }

  // Add a new trailing buy order
  async addOrder({ symbol, trailValue, quantity, quoteOrderQty, orderType, dryRun, activationPrice, takeProfit, stopLoss, filterObi, filterVolume, filterRsi, autoRepeat, activationOffset, startImmediately }) {
    symbol = symbol.toUpperCase().trim();
    trailValue = parseFloat(trailValue);
    
    if (isNaN(trailValue) || trailValue <= 0) {
      throw new Error('Trail value must be a positive number.');
    }

    let parsedActivationPrice = activationPrice && activationPrice.toString().trim() !== ''
      ? parseFloat(activationPrice)
      : null;

    if (parsedActivationPrice !== null && (isNaN(parsedActivationPrice) || parsedActivationPrice <= 0)) {
      throw new Error('Activation price must be a positive number.');
    }

    const parsedTakeProfit = takeProfit && takeProfit.toString().trim() !== ''
      ? parseFloat(takeProfit)
      : null;

    if (parsedTakeProfit !== null && (isNaN(parsedTakeProfit) || parsedTakeProfit <= 0)) {
      throw new Error('Take Profit offset must be a positive number.');
    }

    const parsedStopLoss = stopLoss && stopLoss.toString().trim() !== ''
      ? parseFloat(stopLoss)
      : null;

    if (parsedStopLoss !== null && (isNaN(parsedStopLoss) || parsedStopLoss <= 0)) {
      throw new Error('Stop Loss offset must be a positive number.');
    }

    // Check if MEXC client is initialized for real orders
    if (!dryRun && !this.mexcClient.hasCredentials()) {
      throw new Error('API Credentials must be configured to place real orders. Enable Dry Run to test without keys.');
    }

    this.log(`Fetching initial price for ${symbol}...`, 'info', symbol);
    
    let initialPrice;
    try {
      initialPrice = await this.mexcClient.getTickerPrice(symbol);
    } catch (e) {
      throw new Error(`Failed to fetch initial price for ${symbol}: ${e.message}`);
    }

    let status = 'RUNNING';
    let activationDirection = null;
    let bottomPrice = null;
    let triggerPrice = null;

    const startInstantBuy = autoRepeat && startImmediately;

    if (startInstantBuy) {
      status = 'TP_SL_ACTIVE';
    } else if (autoRepeat && activationOffset) {
      parsedActivationPrice = initialPrice - parseFloat(activationOffset);
      status = 'PENDING_ACTIVATION';
      activationDirection = 'DOWN';
    } else if (parsedActivationPrice !== null) {
      status = 'PENDING_ACTIVATION';
      // Determine if starting price is above or below activation target
      activationDirection = initialPrice > parsedActivationPrice ? 'DOWN' : 'UP';
    } else {
      bottomPrice = initialPrice;
      triggerPrice = initialPrice + trailValue;
    }

    const newOrder = {
      id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      symbol,
      trailValue,
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
      mexcSellOrderId: null,
      sellExecutionPrice: null,
      sellTriggeredAt: null,
      filterObi: !!filterObi,
      filterVolume: !!filterVolume,
      filterRsi: !!filterRsi,
      autoRepeat: !!autoRepeat,
      startImmediately: !!startImmediately,
      activationOffset: activationOffset ? parseFloat(activationOffset) : null,
      peakPrice: initialPrice,
      tradeHistory: [],
      initialPrice,
      bottomPrice,
      triggerPrice,
      currentPrice: initialPrice,
      createdAt: new Date().toISOString(),
      triggeredAt: startInstantBuy ? new Date().toISOString() : null,
      mexcOrderId: null,
      executionPrice: startInstantBuy ? initialPrice : null,
      error: null
    };

    if (startInstantBuy) {
      if (dryRun) {
        newOrder.executionPrice = initialPrice;
        this.log(`[DRY RUN] Auto-Loop started: First trade bought immediately at market price ${initialPrice} USDT. Transitioning to TP/SL monitoring.`, 'success', symbol);
      } else {
        try {
          this.log(`Auto-Loop started: Placing first Spot BUY order immediately at market price on MEXC...`, 'info', symbol);
          const orderParams = {
            symbol,
            side: 'BUY',
            type: orderType || 'MARKET',
            quantity: newOrder.quantity,
            quoteOrderQty: newOrder.quoteOrderQty
          };
          const result = await this.mexcClient.placeOrder(orderParams);
          newOrder.mexcOrderId = result.orderId;
          
          // Fetch actual fill price and quantity from MEXC to protect against slippage
          const fills = await this.getActualOrderFills(symbol, result.orderId, initialPrice);
          newOrder.executionPrice = fills.avgPrice;

          if (parsedTakeProfit) {
            const tpPrice = fills.avgPrice + parsedTakeProfit;
            const grossQty = fills.executedQty || newOrder.quantity || (newOrder.quoteOrderQty / fills.avgPrice);
            
            // Adjust quantity using helper to avoid 30005 Oversold error
            this.log(`Querying asset balance to calculate fee-adjusted sell quantity...`, 'info', symbol);
            const sellQty = await this.getFeeAdjustedBalance(symbol, grossQty);
            
            this.log(`Placing first Take Profit LIMIT SELL order on MEXC for ${sellQty} tokens at ${tpPrice}...`, 'info', symbol);
            const tpParams = {
              symbol,
              side: 'SELL',
              type: 'LIMIT',
              quantity: sellQty,
              price: tpPrice
            };
            const tpResult = await this.mexcClient.placeOrder(tpParams);
            newOrder.mexcSellOrderId = tpResult.orderId;
          }
        } catch (err) {
          newOrder.status = 'FAILED';
          newOrder.error = err.message;
          this.log(`Failed to place initial auto-loop buy order on MEXC: ${err.message}`, 'error', symbol);
        }
      }
    }

    this.orders.unshift(newOrder);
    this.saveOrders();

    const mode = dryRun ? '[DRY RUN]' : '[REAL]';
    if (status === 'PENDING_ACTIVATION') {
      this.log(
        `Created ${mode} trailing stop buy for ${symbol}. Initial price: ${initialPrice}. Waiting for activation price: ${parsedActivationPrice} (Direction: ${activationDirection}). Trail: ${trailValue}`,
        'info',
        symbol
      );
    } else {
      this.log(
        `Created ${mode} trailing stop buy for ${symbol}. Initial price: ${initialPrice}. Bottom: ${initialPrice}. Trail: ${trailValue}. Trigger targets: >= ${triggerPrice}`,
        'info',
        symbol
      );
    }

    this.startTracking();
    return newOrder;
  }

  // Cancel tracking of an active order
  async cancelOrder(id) {
    const order = this.orders.find(o => o.id === id);
    if (!order) return;

    if (order.status === 'TP_SL_ACTIVE' && !order.dryRun && order.mexcSellOrderId) {
      try {
        await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
        this.log(`Cancelled active TP Limit Sell order ${order.mexcSellOrderId} on MEXC.`, 'info', order.symbol);
      } catch (e) {
        this.log(`Failed to cancel TP order on MEXC: ${e.message}`, 'error', order.symbol);
      }
    }

    order.status = 'CANCELLED';
    this.saveOrders();
    this.log(`Trailing buy order for ${order.symbol} has been cancelled by user.`, 'warning', order.symbol);
    
    // Stop tracking loop if no active orders remain
    this.checkTrackingLoop();
  }

  // Clear completed order history
  clearHistory() {
    this.orders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
    this.saveOrders();
    this.log('Historical orders cleared.', 'info');
  }

  // Start tracking interval if there are active orders
  startTracking() {
    if (this.intervalId) return;

    this.intervalId = setInterval(async () => {
      await this.tick();
    }, this.pollInterval);
  }

  // Check if we should stop the tracking loop
  checkTrackingLoop() {
    const hasActive = this.orders.some(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
    if (!hasActive && this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // Execute a single iteration of tracking
  async tick() {
    const activeOrders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
    if (activeOrders.length === 0) {
      this.checkTrackingLoop();
      return;
    }

    // Get unique active symbols to minimize API calls
    const symbols = [...new Set(activeOrders.map(o => o.symbol))];
    const prices = {};

    // Fetch latest prices for active symbols
    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const price = await this.mexcClient.getTickerPrice(symbol);
          prices[symbol] = price;
        } catch (e) {
          // Log price fetch error, but don't crash
          this.log(`Error fetching price for ${symbol}: ${e.message}`, 'error', symbol);
        }
      })
    );

    let changed = false;

    for (const order of activeOrders) {
      const currentPrice = prices[order.symbol];
      if (currentPrice === undefined) continue; // Skip if we failed to get the price this tick

      order.currentPrice = currentPrice;
      changed = true;

      // 1.4 Check activation price if waiting
      if (order.status === 'PENDING_ACTIVATION') {
        // Dynamic Peak Tracking: if autoRepeat is active and price goes up, trail the peak and activationPrice
        if (order.autoRepeat && order.activationOffset) {
          if (!order.peakPrice || currentPrice > order.peakPrice) {
            order.peakPrice = currentPrice;
            order.activationPrice = order.peakPrice - order.activationOffset;
            changed = true;
          }
        }

        // Check Standard Dip Activation -> Trails buy
        let shouldActivateDip = false;
        let activationReason = '';

        if (order.activationDirection === 'DOWN' && currentPrice <= order.activationPrice) {
          shouldActivateDip = true;
          activationReason = `price ${currentPrice} hit dip activation target ${order.activationPrice}`;
        } else if (order.activationDirection === 'UP' && currentPrice >= order.activationPrice) {
          shouldActivateDip = true;
          activationReason = `price ${currentPrice} hit target ${order.activationPrice}`;
        }

        if (shouldActivateDip) {
          order.status = 'RUNNING';
          order.activatedAt = new Date().toISOString();
          order.bottomPrice = currentPrice;
          order.triggerPrice = currentPrice + order.trailValue;
          this.log(
            `Trailing stop buy activated via Dip: ${activationReason}. (Trigger target: >= ${order.triggerPrice}).`,
            'success',
            order.symbol
          );
          changed = true;
          continue;
        }

        continue; // Wait for next tick to monitor trailing stop
      }

      // 1.5 Check TP/SL OCO checks if already bought and holding
      if (order.status === 'TP_SL_ACTIVE') {
        if (order.dryRun) {
          // Dry Run TP Check
          if (order.takeProfit && currentPrice >= (order.executionPrice + order.takeProfit)) {
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = order.executionPrice + order.takeProfit;
            order.sellTriggeredAt = new Date().toISOString();
            this.log(`[DRY RUN] Take Profit hit! Simulated Limit Sell executed at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
            changed = true;
            this.handleOrderCycleComplete(order);
            continue;
          }
          // Dry Run SL Check
          if (order.stopLoss && currentPrice <= (order.executionPrice - order.stopLoss)) {
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = order.executionPrice - order.stopLoss;
            order.sellTriggeredAt = new Date().toISOString();
            this.log(`[DRY RUN] Stop Loss hit! Simulated Market Sell executed at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
            changed = true;
            this.handleOrderCycleComplete(order);
            continue;
          }
        } else {
          // Real Order OCO Checks
          const now = Date.now();
          if (!order.lastStatusCheckTime || (now - order.lastStatusCheckTime > 5000)) {
            order.lastStatusCheckTime = now;
            if (order.mexcSellOrderId) {
              try {
                const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
                if (queryRes && queryRes.status === 'FILLED') {
                  order.status = 'TRIGGERED';
                  order.sellExecutionPrice = parseFloat(queryRes.price) || (order.executionPrice + order.takeProfit);
                  order.sellTriggeredAt = new Date().toISOString();
                  this.log(`[REAL] Take Profit hit! Limit Sell filled on MEXC at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
                  changed = true;
                  this.handleOrderCycleComplete(order);
                  continue;
                }
              } catch (e) {
                this.log(`Error querying TP order status from MEXC: ${e.message}`, 'error', order.symbol);
              }
            }
          }

          // Real Order Stop Loss Check
          if (order.stopLoss && currentPrice <= (order.executionPrice - order.stopLoss)) {
            order.status = 'PENDING_EXECUTION'; // block double trigger
            this.log(`[REAL] Stop Loss hit! Market price ${currentPrice} <= Stop Loss level ${order.executionPrice - order.stopLoss}. Executing market sell on MEXC...`, 'warning', order.symbol);
            
            if (order.mexcSellOrderId) {
              try {
                await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
                this.log(`[REAL] Cancelled TP Limit Sell order ${order.mexcSellOrderId} on MEXC.`, 'info', order.symbol);
              } catch (e) {
                this.log(`[REAL] Failed to cancel TP order: ${e.message}. Proceeding with market sell.`, 'error', order.symbol);
              }
            }

            try {
              const grossQty = order.quantity || (order.quoteOrderQty / order.executionPrice);
              let sellQty = Math.floor(grossQty * 10000) / 10000;
              
              // Query exact free balance instantly and truncate to prevent quantity scale errors
              try {
                const balances = await this.mexcClient.getBalances();
                const asset = order.symbol.replace('USDT', '').toUpperCase();
                const assetBal = balances.find(b => b.asset.toUpperCase() === asset);
                if (assetBal && assetBal.free > 0) {
                  const truncated = Math.floor(assetBal.free * 10000) / 10000;
                  if (truncated > 0) {
                    sellQty = truncated;
                    this.log(`[REAL] Stop Loss balance match: using free balance ${sellQty} instead of gross ${grossQty}`, 'info', order.symbol);
                  }
                }
              } catch (balErr) {
                this.log(`[REAL] Stop Loss balance query failed: ${balErr.message}. Falling back to estimated quantity.`, 'warning', order.symbol);
              }

              const sellParams = {
                symbol: order.symbol,
                side: 'SELL',
                type: 'MARKET',
                quantity: sellQty
              };
              const sellResult = await this.mexcClient.placeOrder(sellParams);
              order.status = 'TRIGGERED';
              order.sellExecutionPrice = currentPrice;
              order.sellTriggeredAt = new Date().toISOString();
              this.log(`[REAL] Stop Loss Market Sell order executed successfully! Sell Order ID: ${sellResult.orderId}`, 'success', order.symbol);
              this.handleOrderCycleComplete(order);
            } catch (e) {
              order.status = 'TP_SL_ACTIVE'; // Revert state
              this.log(`[REAL] Stop Loss Market Sell order failed: ${e.message}`, 'error', order.symbol);
            }
            changed = true;
            continue;
          }
        }
        continue; // Wait for next tick, do not run trailing buy checks
      }

      // 1. Check if price bottomed out further
      if (currentPrice < order.bottomPrice) {
        const oldBottom = order.bottomPrice;
        order.bottomPrice = currentPrice;
        order.triggerPrice = currentPrice + order.trailValue;
        this.log(
          `New bottom detected for ${order.symbol}: ${currentPrice} (was ${oldBottom}). Recalculated trigger to: ${order.triggerPrice}`,
          'info',
          order.symbol
        );
      }

      // 2. Check if price went up by the trail value (hits or exceeds trigger price)
      if (currentPrice >= order.triggerPrice) {
        // Run indicators filters confirmation checks if enabled
        let passedFilters = true;
        const failedReasons = [];

        if (order.filterObi) {
          try {
            const depth = await this.mexcClient.getDepth(order.symbol, 100);
            let bidsValue = 0;
            let asksValue = 0;
            const rangeLower = currentPrice * 0.985;
            const rangeUpper = currentPrice * 1.015;

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
            if (bidsRatio < 0.55) {
              passedFilters = false;
              failedReasons.push(`OBI Support ${(bidsRatio * 100).toFixed(1)}% < 55%`);
            }
          } catch (e) {
            this.log(`OBI Filter query failed: ${e.message}`, 'warning', order.symbol);
            passedFilters = false;
            failedReasons.push(`OBI Query Error`);
          }
        }

        if (order.filterVolume && passedFilters) {
          try {
            const klines = await this.mexcClient.getKlines(order.symbol, '1m', 6);
            if (klines && klines.length >= 6) {
              const currentVol = parseFloat(klines[5][5]); // Volume is index 5
              let totalPrevVol = 0;
              for (let j = 0; j < 5; j++) {
                totalPrevVol += parseFloat(klines[j][5]);
              }
              const avgPrevVol = totalPrevVol / 5;
              if (currentVol < avgPrevVol * 1.5) {
                passedFilters = false;
                failedReasons.push(`Volume Spike ${currentVol.toFixed(1)} < 1.5x avg (${(avgPrevVol * 1.5).toFixed(1)})`);
              }
            } else {
              passedFilters = false;
              failedReasons.push(`Insufficient Volume Data`);
            }
          } catch (e) {
            this.log(`Volume Filter query failed: ${e.message}`, 'warning', order.symbol);
            passedFilters = false;
            failedReasons.push(`Volume Query Error`);
          }
        }

        if (order.filterRsi && passedFilters) {
          try {
            const klines = await this.mexcClient.getKlines(order.symbol, '1m', 30);
            if (klines && klines.length >= 15) {
              const closes = klines.map(k => parseFloat(k[4]));
              const rsi = this.calculateRSI(closes);
              if (rsi > 35) {
                passedFilters = false;
                failedReasons.push(`RSI ${rsi.toFixed(1)} > 35`);
              }
            } else {
              passedFilters = false;
              failedReasons.push(`Insufficient RSI Data`);
            }
          } catch (e) {
            this.log(`RSI Filter calculation failed: ${e.message}`, 'warning', order.symbol);
            passedFilters = false;
            failedReasons.push(`RSI Calc Error`);
          }
        }

        if (!passedFilters) {
          // Throttling logs to once every 5 seconds per order symbol
          const now = Date.now();
          if (!order.lastFilterFailLogTime || (now - order.lastFilterFailLogTime > 5000)) {
            order.lastFilterFailLogTime = now;
            this.log(`Buy condition met but execution deferred. Failed confirmations: ${failedReasons.join(', ')}. Waiting for indicator alignment.`, 'info', order.symbol);
          }
          continue;
        }

        order.triggeredAt = new Date().toISOString();
        const mode = order.dryRun ? '[DRY RUN]' : '[REAL]';
        this.log(
          `${mode} Trailing stop buy triggered for ${order.symbol}! Current price: ${currentPrice} >= Trigger price: ${order.triggerPrice}`,
          'success',
          order.symbol
        );

        if (order.dryRun) {
          order.executionPrice = currentPrice;
          if (order.takeProfit || order.stopLoss) {
            order.status = 'TP_SL_ACTIVE';
            this.log(`[DRY RUN] Simulated Spot Buy order executed at ${currentPrice} USDT. Transitioning to TP/SL monitoring.`, 'success', order.symbol);
          } else {
            order.status = 'TRIGGERED';
            this.log(`[DRY RUN] Simulated Spot Buy order executed at ${currentPrice} USDT.`, 'success', order.symbol);
          }
        } else {
          // PLACE REAL ORDER
          try {
            order.status = 'PENDING_EXECUTION'; // intermediate state
            this.log(`Placing Spot BUY order on MEXC for ${order.symbol}...`, 'info', order.symbol);
            
            const orderParams = {
              symbol: order.symbol,
              side: 'BUY',
              type: order.orderType,
              quantity: order.quantity,
              quoteOrderQty: order.quoteOrderQty
            };

            const result = await this.mexcClient.placeOrder(orderParams);
            
            order.mexcOrderId = result.orderId;
            
            // Fetch actual fill price and quantity from MEXC to protect against slippage
            const fills = await this.getActualOrderFills(order.symbol, result.orderId, currentPrice);
            order.executionPrice = fills.avgPrice;

            if (order.takeProfit || order.stopLoss) {
              order.status = 'TP_SL_ACTIVE';
              this.log(
                `[REAL] BUY Order placed successfully! Order ID: ${result.orderId}. Avg Fill Price: ${fills.avgPrice}. Transitioning to TP/SL monitoring.`,
                'success',
                order.symbol
              );

              // If Take Profit is configured, place a real LIMIT SELL order on MEXC now!
              if (order.takeProfit) {
                try {
                  const tpPrice = fills.avgPrice + order.takeProfit;
                  const grossQty = fills.executedQty || order.quantity || (order.quoteOrderQty / fills.avgPrice);
                  
                  // Adjust quantity using helper to avoid 30005 Oversold error
                  this.log(`[REAL] Querying asset balance to calculate fee-adjusted sell quantity...`, 'info', order.symbol);
                  const sellQty = await this.getFeeAdjustedBalance(order.symbol, grossQty);
                  
                  this.log(`[REAL] Placing Take Profit LIMIT SELL order on MEXC for ${sellQty} tokens at ${tpPrice}...`, 'info', order.symbol);
                  
                  const tpParams = {
                    symbol: order.symbol,
                    side: 'SELL',
                    type: 'LIMIT',
                    quantity: sellQty,
                    price: tpPrice
                  };
                  
                  const tpResult = await this.mexcClient.placeOrder(tpParams);
                  order.mexcSellOrderId = tpResult.orderId;
                  this.log(`[REAL] Take Profit Limit Sell order placed on MEXC. Order ID: ${tpResult.orderId}`, 'success', order.symbol);
                } catch (tpErr) {
                  this.log(`[REAL] Failed to place TP Limit Sell order on MEXC: ${tpErr.message}. Bot will still monitor Stop Loss.`, 'error', order.symbol);
                }
              }
            } else {
              order.status = 'TRIGGERED';
              this.log(
                `[REAL] Order placed successfully! Order ID: ${result.orderId}. Status: ${result.status || 'Success'}`,
                'success',
                order.symbol
              );
            }
          } catch (e) {
            order.status = 'FAILED';
            order.error = e.message;
            this.log(`[REAL] Failed to place order on MEXC: ${e.message}`, 'error', order.symbol);
          }
        }
      }

      // Check if this order just reached TRIGGERED state and has autoRepeat enabled
      if (order.status === 'TRIGGERED' && order.autoRepeat) {
        const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
        const buyPrice = order.executionPrice;
        const sellPrice = order.sellExecutionPrice || order.currentPrice;
        const profit = sellPrice - buyPrice; // per unit profit

        // Determine if Take Profit or Stop Loss hit
        let type = 'MANUAL_SELL';
        if (order.takeProfit && sellPrice >= (buyPrice + order.takeProfit - 0.0001)) {
          type = 'TAKE_PROFIT';
        } else if (order.stopLoss && sellPrice <= (buyPrice - order.stopLoss + 0.0001)) {
          type = 'STOP_LOSS';
        }

        if (!order.tradeHistory) order.tradeHistory = [];
        order.tradeHistory.push({
          cycle: cycleNum,
          buyPrice,
          sellPrice,
          type,
          profit,
          timestamp: new Date().toISOString()
        });

        // Reset to pending activation for next cycle
        order.status = 'PENDING_ACTIVATION';
        order.peakPrice = sellPrice;
        order.activationPrice = order.peakPrice - (order.activationOffset || 0);
        order.localBottom = sellPrice;
        order.bottomPrice = null;
        order.triggerPrice = null;
        order.mexcOrderId = null;
        order.executionPrice = null;
        order.mexcSellOrderId = null;
        order.sellExecutionPrice = null;
        order.sellTriggeredAt = null;
        order.triggeredAt = null;
        order.activatedAt = null;

        this.log(
          `Cycle #${cycleNum} completed (${type}). Resetting order to pending activation. New peak: ${order.peakPrice}, Activation price: ${order.activationPrice}`,
          'success',
          order.symbol
        );
        changed = true;
      }
    }

    if (changed) {
      this.saveOrders();
    }
  }

  // Update polling interval dynamically if needed
  setPollInterval(ms) {
    if (ms < 200) ms = 200; // limit fast polling to prevent IP ban
    this.pollInterval = ms;
    this.log(`Price polling interval set to ${ms}ms.`, 'info');
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.startTracking();
    }
  }

  // Calculate Relative Strength Index (Wilder's smoothing)
  calculateRSI(closes, period = 14) {
    if (closes.length <= period) return 50;
    
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

module.exports = OrderTracker;
