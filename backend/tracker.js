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
    this.cachedFeeSummary = null;
    this.lastFeeCheckTime = 0;
    
    this.initStorage();
  }

  async getTotalMexcFeesPaid(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedFeeSummary && (now - this.lastFeeCheckTime < 10000)) {
      return this.cachedFeeSummary;
    }

    if (!this.mexcClient || !this.mexcClient.hasCredentials()) {
      return { usdtFees: 0, mxFees: 0, totalFeesInUsdt: 0, feeCount: 0 };
    }

    try {
      const symbolsToCheck = new Set([
        'ONDOUSDT', 'BTCUSDT', 'XRPUSDT', 'SOLUSDT', 'ETHUSDT', 'BNBUSDT', 'SUIUSDT', 'UNIUSDT', 'MXUSDT'
      ]);

      (this.orders || []).forEach(o => {
        if (o.symbol) symbolsToCheck.add(o.symbol.toUpperCase());
      });

      let totalUsdtFees = 0;
      let totalMxFees = 0;
      let feeCount = 0;

      for (const symbol of symbolsToCheck) {
        try {
          const trades = await this.mexcClient.getMyTrades(symbol, 1000);
          if (Array.isArray(trades)) {
            trades.forEach(t => {
              const fee = parseFloat(t.commission || 0);
              const fa = t.commissionAsset || '';
              if (fee > 0) {
                feeCount++;
                if (fa === 'USDT') totalUsdtFees += fee;
                else if (fa === 'MX') totalMxFees += fee;
              }
            });
          }
        } catch (e) {
          // symbol not traded
        }
      }

      let mxPrice = 1.65;
      try {
        const p = await this.mexcClient.getTickerPrice('MXUSDT');
        if (p) mxPrice = parseFloat(p);
      } catch(e) {}

      const totalFeesInUsdt = totalUsdtFees + (totalMxFees * mxPrice);

      this.cachedFeeSummary = {
        usdtFees: parseFloat(totalUsdtFees.toFixed(4)),
        mxFees: parseFloat(totalMxFees.toFixed(4)),
        totalFeesInUsdt: parseFloat(totalFeesInUsdt.toFixed(4)),
        feeCount
      };
      this.lastFeeCheckTime = now;
      return this.cachedFeeSummary;
    } catch (err) {
      return this.cachedFeeSummary || { usdtFees: 0, mxFees: 0, totalFeesInUsdt: 0, feeCount: 0 };
    }
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

  /**
   * Calculate exact Maker-guaranteed Limit Price using orderbook depth.
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
          // Target top buyer: average of top 2 bids
          let pegPrice = (bestBid + secondBid) / 2;
          // STRICT RULE: BUY Price MUST be strictly LESS THAN Best Ask to guarantee MAKER 0% Fee
          if (pegPrice >= bestAsk) {
            pegPrice = Math.min(bestBid, bestAsk - tick);
          }
          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          if (pegPrice >= bestAsk) {
            pegPrice = parseFloat((bestAsk - tick).toFixed(decimals));
          }
          this.log(`[MAKER PEG BUY] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Pegged BUY Price: ${pegPrice} (< Ask ${bestAsk} ✅)`, 'info', symbol);
          return pegPrice;
        } else {
          // Target top seller: average of top 2 asks
          let pegPrice = (bestAsk + secondAsk) / 2;
          // STRICT RULE: SELL Price MUST be strictly GREATER THAN Best Bid to guarantee MAKER 0% Fee
          if (pegPrice <= bestBid) {
            pegPrice = Math.max(bestAsk, bestBid + tick);
          }
          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          if (pegPrice <= bestBid) {
            pegPrice = parseFloat((bestBid + tick).toFixed(decimals));
          }
          this.log(`[MAKER PEG SELL] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Pegged SELL Price: ${pegPrice} (> Bid ${bestBid} ✅)`, 'info', symbol);
          return pegPrice;
        }
      }
    } catch (err) {
      this.log(`[MAKER PEG] Failed to query depth for ${symbol}: ${err.message}. Using fallback price ${fallbackPrice}`, 'warning', symbol);
    }
    return fallbackPrice;
  }

  /**
   * 100% MAKER RE-PEG ENGINE (NO MARKET FALLBACK EVER)
   * Continuously polls and re-pegs LIMIT orders every 800ms to top of orderbook
   * strictly maintaining BUY < Best Ask and SELL > Best Bid for 0% Maker fees.
   */
  async waitForLimitOrderFill(symbol, orderId, side, quantity, fallbackPrice, maxWaitMs = 15000, pollMs = 800) {
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
            this.log(`🎉 [100% MAKER SUCCESS] Order ${currentOrderId} FILLED as MAKER (0% Fee) after ${attempts} re-peg checks! Avg Price: ${avgPrice.toFixed(6)}`, 'success', symbol);
            return { avgPrice, executedQty, filled: true, maker: true };
          }
        }

        if (orderInfo && (orderInfo.status === 'NEW' || orderInfo.status === 'PARTIALLY_FILLED')) {
          this.log(`[MAKER PEG LOG] Check #${attempts} (800ms elapsed): Order ${currentOrderId} is UNFILLED at price ${currentPrice}. Re-pegging to fresh depth...`, 'warning', symbol);
          
          // Step 1: Cancel current unfilled LIMIT order
          try {
            await this.mexcClient.cancelOrder(symbol, currentOrderId);
          } catch (cErr) {
            // Race condition check if filled
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

          // Step 2: Calculate fresh Depth Peg price (< Best Ask for BUY, > Best Bid for SELL)
          const newPegPrice = await this.calculateMakerPegPrice(symbol, side, currentPrice);
          currentPrice = newPegPrice;

          // Step 3: Place NEW LIMIT order at fresh peg price with precision retry
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
                this.log(`[MAKER RE-PEG] Placed NEW 100% MAKER ${side} LIMIT order ${currentOrderId} at updated price ${currentPrice} USDT (0% Fee)`, 'info', symbol);
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
          this.log(`[MAKER LIMIT] Order ${currentOrderId} status: ${orderInfo.status}. Re-pegging new order...`, 'warning', symbol);
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
        this.log(`[MAKER LIMIT] Error checking order ${currentOrderId}: ${err.message}`, 'warning', symbol);
      }
    }

    // 100% MAKER GUARANTEE: NEVER place MARKET orders! Return filled: false if maxWaitMs exceeded.
    this.log(`[100% MAKER GUARANTEE] Order ${currentOrderId} not filled after ${maxWaitMs / 1000}s of continuous Limit re-pegging. Aborting without Market fallback to guarantee 0% Fee.`, 'warning', symbol);

    try {
      await this.mexcClient.cancelOrder(symbol, currentOrderId);
    } catch (cancelErr) {}

    return { avgPrice: currentPrice, executedQty: null, filled: false, maker: true };
  }

  async getFeeAdjustedBalance(symbol, grossQty) {
    const asset = symbol.replace('USDT', '').toUpperCase();
    try {
      // Wait 1.5 seconds for order fill settlement and balance updating on MEXC
      await new Promise(r => setTimeout(r, 1500));
      
      let balances = await this.mexcClient.getBalances();
      let assetBal = balances.find(b => b.asset.toUpperCase() === asset);
      
      // If balance update is still settling (free balance is significantly less than expected bought qty), wait 1.5s more and re-query
      if (!assetBal || assetBal.free < (grossQty * 0.5)) {
        this.log(`Asset balance for ${asset} (${assetBal ? assetBal.free : 0}) is less than expected bought qty (${grossQty}). Waiting 1.5s for MEXC settlement...`, 'warning', symbol);
        await new Promise(r => setTimeout(r, 1500));
        balances = await this.mexcClient.getBalances();
        assetBal = balances.find(b => b.asset.toUpperCase() === asset);
      }

      if (assetBal && assetBal.free >= (grossQty * 0.5)) {
        this.log(`Fetched confirmed asset balance for ${asset}: free balance is ${assetBal.free} (gross quantity estimated: ${grossQty}).`, 'info', symbol);
        // Apply 0.2% safety buffer + truncate to 4 decimal places to prevent 30005 Oversold errors
        const safeFree = assetBal.free * 0.998;
        const truncated = Math.floor(safeFree * 10000) / 10000;
        if (truncated > 0) return truncated;
      } else {
        this.log(`Balance query returned insufficient balance for ${asset} (${assetBal ? assetBal.free : 0}). Using fee-adjusted gross estimate (${grossQty}).`, 'warning', symbol);
      }
    } catch (err) {
      this.log(`Balance lookup failed: ${err.message}. Falling back to estimated quantity with fee margin.`, 'warning', symbol);
    }
    
    // Fallback: estimate gross quantity and deduct a 0.3% fee safety margin
    const estimated = grossQty * 0.997;
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
    order.activationDirection = 'DOWN';
    order.isSlExtended = false;
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
  async addOrder({ symbol, trailValue, quantity, quoteOrderQty, orderType, dryRun, activationPrice, takeProfit, stopLoss, filterSmartSl, slBuffer, filterObi, filterVolume, filterRsi, autoRepeat, activationOffset, startImmediately }) {
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

    const parsedSlBuffer = slBuffer && slBuffer.toString().trim() !== ''
      ? parseFloat(slBuffer)
      : 2.0;

    if (isNaN(parsedSlBuffer) || parsedSlBuffer <= 0) {
      throw new Error('Smart SL Buffer must be a positive number.');
    }

    // Check if MEXC client is initialized for real orders
    if (!dryRun && !this.mexcClient.hasCredentials()) {
      throw new Error('MEXC API Key and Secret are required for real order tracking.');
    }

    this.log(`Fetching initial price for ${symbol}...`, 'info', symbol);
    
    let initialPrice = 0;
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
      filterSmartSl: !!filterSmartSl,
      slBuffer: parsedSlBuffer,
      isSlExtended: false,
      isSlProfitLocked: false,
      lockedSlPrice: null,
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
      totalNetProfit: 0,
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
          // Calculate Maker Peg BUY price from depth (< Best Ask strictly)
          const freshBuyPrice = await this.calculateMakerPegPrice(symbol, 'BUY', initialPrice);
          this.log(`Auto-Loop started: Placing first Spot LIMIT BUY order at ${freshBuyPrice} USDT on MEXC (0% Maker fee)...`, 'info', symbol);
          
          let result = null;
          let lastBuyErr = null;
          const decimalsToTry = [10000, 100, 1];
          let buyQty = null;

          if (newOrder.quantity) {
            for (const mult of decimalsToTry) {
              const qtyToTry = Math.floor(newOrder.quantity * mult) / mult;
              if (qtyToTry <= 0) continue;
              try {
                const orderParams = {
                  symbol,
                  side: 'BUY',
                  type: 'LIMIT',
                  quantity: qtyToTry,
                  price: freshBuyPrice
                };
                result = await this.mexcClient.placeOrder(orderParams);
                if (result && result.orderId) { buyQty = qtyToTry; break; }
              } catch (err) {
                lastBuyErr = err;
                const errMsg = err.message || '';
                if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                  this.log(`[REAL] BUY Quantity scale invalid for ${qtyToTry}. Retrying with broader precision...`, 'warning', symbol);
                  continue;
                }
                throw err;
              }
            }
          } else {
            // quoteOrderQty is not supported for LIMIT orders on MEXC, calculate qty from price
            const estimatedQty = newOrder.quoteOrderQty / freshBuyPrice;
            for (const mult of decimalsToTry) {
              const qtyToTry = Math.floor(estimatedQty * mult) / mult;
              if (qtyToTry <= 0) continue;
              try {
                const orderParams = {
                  symbol,
                  side: 'BUY',
                  type: 'LIMIT',
                  quantity: qtyToTry,
                  price: freshBuyPrice
                };
                result = await this.mexcClient.placeOrder(orderParams);
                if (result && result.orderId) { buyQty = qtyToTry; break; }
              } catch (err) {
                lastBuyErr = err;
                const errMsg = err.message || '';
                if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                  continue;
                }
                throw err;
              }
            }
          }

          if (!result || !result.orderId) {
            throw lastBuyErr || new Error('Failed to place initial LIMIT buy order.');
          }

          newOrder.mexcOrderId = result.orderId;
          
          // Wait for LIMIT order to fill (with MARKET fallback on timeout)
          const fills = await this.waitForLimitOrderFill(symbol, result.orderId, 'BUY', buyQty, freshBuyPrice);
          if (!fills || !fills.filled || !fills.executedQty) {
            newOrder.status = 'FAILED';
            newOrder.error = 'BUY order unfilled on MEXC after repeg shifts and fallback.';
            this.log(`[REAL] BUY order failed to fill on MEXC. Aborting TP/SL placement to prevent Oversold error.`, 'error', symbol);
            this.saveOrders();
            return newOrder;
          }

          if (fills.fallbackOrderId) newOrder.mexcOrderId = fills.fallbackOrderId;
          newOrder.executionPrice = fills.avgPrice;

          if (parsedTakeProfit) {
            const tpPrice = fills.avgPrice + parsedTakeProfit;
            const grossQty = fills.executedQty || newOrder.quantity || (newOrder.quoteOrderQty / fills.avgPrice);
            
            // Adjust quantity using helper to avoid 30005 Oversold error
            this.log(`Querying asset balance to calculate fee-adjusted sell quantity...`, 'info', symbol);
            const sellQty = await this.getFeeAdjustedBalance(symbol, grossQty);
            
            let tpResult = null;
            let lastTpErr = null;
            const safeQty = sellQty * 0.998;
            
            for (const mult of decimalsToTry) {
              const qtyToTry = Math.floor(safeQty * mult) / mult;
              if (qtyToTry <= 0) continue;
              try {
                const tpParams = {
                  symbol,
                  side: 'SELL',
                  type: 'LIMIT',
                  quantity: qtyToTry,
                  price: tpPrice
                };
                tpResult = await this.mexcClient.placeOrder(tpParams);
                if (tpResult && tpResult.orderId) {
                  newOrder.mexcSellOrderId = tpResult.orderId;
                  this.log(`Initial TP Limit Sell order placed successfully! Sell Qty: ${qtyToTry}, ID: ${tpResult.orderId}`, 'success', symbol);
                  break;
                }
              } catch (err) {
                lastTpErr = err;
                const errMsg = err.message || '';
                if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                  this.log(`Initial TP Limit Sell quantity scale invalid for ${qtyToTry}. Retrying with broader precision...`, 'warning', symbol);
                  continue;
                }
                if (errMsg.includes('30002') || errMsg.includes('1USDT')) {
                  this.log(`Initial TP Limit Sell value < 1 USDT (${qtyToTry} @ ${tpPrice}). TP order skipped, bot will monitor SL.`, 'warning', symbol);
                  break;
                }
                throw err;
              }
            }
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
    if (this.isTicking) return;
    this.isTicking = true;
    try {
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

        const isDownDirection = order.activationDirection === 'DOWN' || !order.activationDirection || (order.autoRepeat && order.activationOffset);

        if (isDownDirection && currentPrice <= order.activationPrice) {
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
        // Automatic Ghost Order Self-Healing: Verify real MEXC balance for real trades
        if (!order.dryRun) {
          const now = Date.now();
          if (!order.lastGhostCheckTime || (now - order.lastGhostCheckTime > 10000)) {
            order.lastGhostCheckTime = now;
            const asset = order.symbol.replace('USDT', '').toUpperCase();
            try {
              const balances = await this.mexcClient.getBalances();
              const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
              const totalBal = assetBal ? ((parseFloat(assetBal.free) || 0) + (parseFloat(assetBal.locked) || 0)) : 0;
              const expectedQty = order.quantity || (order.quoteOrderQty && order.executionPrice ? (order.quoteOrderQty / order.executionPrice) : 0);

              if (expectedQty > 0 && totalBal < (expectedQty * 0.01)) {
                this.log(`🚨 [GHOST ORDER DETECTED] ${order.symbol} status is TP_SL_ACTIVE but MEXC spot balance for ${asset} is ${totalBal.toFixed(4)}. Resetting order from TP_SL_ACTIVE to PENDING_ACTIVATION...`, 'warning', order.symbol);
                order.status = 'PENDING_ACTIVATION';
                order.executionPrice = null;
                order.mexcOrderId = null;
                order.mexcSellOrderId = null;
                order.bottomPrice = null;
                order.triggerPrice = null;
                order.isSlExtended = false;
                order.isSlProfitLocked = false;
                order.lockedSlPrice = null;
                this.saveOrders();
                continue;
              }
            } catch (ghostErr) {}
          }
        }
            // Profit Lock Guard: Check if price reached 50% progress to Take Profit
        if (order.takeProfit && order.trailValue && !order.isSlProfitLocked && order.executionPrice) {
          const tpTargetProgress = order.takeProfit * 0.5;
          if (currentPrice >= (order.executionPrice + tpTargetProgress - 0.00000001)) {
            order.isSlProfitLocked = true;
            order.justProfitLocked = true;
            // Requested Formula: executionPrice + (trailValue * 2)
            order.lockedSlPrice = order.executionPrice + (order.trailValue * 2);
            const tpTriggerPrice = (order.executionPrice + tpTargetProgress).toFixed(4);
            const newSlTarget = order.lockedSlPrice.toFixed(4);
            this.log(
              `🔒 [PROFIT LOCK GUARD] Price reached 50% TP progress (${currentPrice.toFixed(4)} >= ${tpTriggerPrice} USDT)! Stop Loss shifted UP to +$${(order.trailValue * 2).toFixed(2)} above Buy Price (${newSlTarget} USDT). Profit Locked!`,
              'success',
              order.symbol
            );
            changed = true;
          }
        }

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
        }

        // Common Stop Loss Target Price calculation (Dry Run & Real Mode)
        let targetSlPrice = order.isSlProfitLocked && order.lockedSlPrice
          ? order.lockedSlPrice
          : (order.executionPrice - order.stopLoss);
        
        if (order.filterSmartSl && order.isSlExtended && order.slBuffer) {
          targetSlPrice -= order.slBuffer;
        }

        // Check if Stop Loss target is hit
        if (order.justProfitLocked) {
          delete order.justProfitLocked;
        } else if (order.stopLoss && currentPrice <= targetSlPrice) {
          order.status = 'PENDING_EXECUTION'; // Transition immediately to block duplicate execution!

          // Smart SL Guard seller exhaustion evaluation (common to both Dry Run and Real Mode)
          if (order.filterSmartSl && !order.isSlExtended && order.slBuffer > 0) {
            let isSellerExhausted = false;
            let bidsRatioPct = '0';
            let asksRatioPct = '0';
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
              bidsRatioPct = (bidsRatio * 100).toFixed(1);
              asksRatioPct = ((1 - bidsRatio) * 100).toFixed(1);

              this.log(
                `🛡️ [SMART SL GUARD] Evaluating selling pressure at SL target ${currentPrice.toFixed(4)} USDT... Order Book Bids Support: ${bidsRatioPct}%, Asks Selling Pressure: ${asksRatioPct}%.`,
                'info',
                order.symbol
              );

              if (bidsRatio >= 0.45) {
                isSellerExhausted = true;
              }
            } catch (e) {
              this.log(`Smart SL Guard depth query failed: ${e.message}`, 'warning', order.symbol);
            }

            if (isSellerExhausted) {
              order.isSlExtended = true;
              order.status = 'TP_SL_ACTIVE'; // Revert back to active state for extended tracking!
              const oldSlTarget = targetSlPrice.toFixed(4);
              const newSlTarget = (targetSlPrice - order.slBuffer).toFixed(4);
              this.log(
                `🛡️ [SMART SL GUARD] Seller exhaustion confirmed! Bids Support ${bidsRatioPct}% >= 45% (Buyers absorbing dip). Extending Stop Loss by +$${order.slBuffer} buffer. (Old SL: ${oldSlTarget}, Extended SL: ${newSlTarget}). Market sell DEFERRED, waiting for bounce!`,
                'success',
                order.symbol
              );
              changed = true;
              continue;
            } else {
              this.log(
                `🚨 [SMART SL GUARD] Heavy selling pressure confirmed at SL level! Bids Support ${bidsRatioPct}% < 45% (Asks Dumping ${asksRatioPct}%). Proceeding with IMMEDIATE Stop Loss Market Sell!`,
                'warning',
                order.symbol
              );
            }
          }

          if (order.dryRun) {
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = targetSlPrice;
            order.sellTriggeredAt = new Date().toISOString();
            this.log(`[DRY RUN] Stop Loss hit! Simulated Market Sell executed at ${targetSlPrice} USDT.`, 'success', order.symbol);
            changed = true;
            this.handleOrderCycleComplete(order);
            continue;
          } else {
            this.log(`[REAL] Stop Loss hit! Price ${currentPrice} <= SL level ${targetSlPrice.toFixed(4)}. Fetching fresh market price for LIMIT SELL...`, 'warning', order.symbol);
            
            const mexcSellId = order.mexcSellOrderId;
            order.mexcSellOrderId = null; // Clear immediately to prevent duplicate cancellation calls

            if (mexcSellId) {
              try {
                await this.mexcClient.cancelOrder(order.symbol, mexcSellId);
                this.log(`[REAL] Cancelled TP Limit Sell order ${mexcSellId} on MEXC. Waiting 1.0s for balance unlock...`, 'info', order.symbol);
                await new Promise(r => setTimeout(r, 1000));
              } catch (e) {
                this.log(`[REAL] Failed to cancel TP order ${mexcSellId}: ${e.message}. Proceeding with SL sell.`, 'error', order.symbol);
              }
            }

            try {
              // Calculate Maker Peg SELL price from depth (> Best Bid strictly)
              const freshSlPrice = await this.calculateMakerPegPrice(order.symbol, 'SELL', currentPrice);

              const grossQty = order.quantity || (order.quoteOrderQty / order.executionPrice);
              let sellQty = Math.floor(grossQty * 0.998 * 100000000) / 100000000;
              
              // Query exact free balance and truncate to prevent quantity scale/oversold errors
              try {
                let balances = await this.mexcClient.getBalances();
                const asset = order.symbol.replace('USDT', '').toUpperCase();
                let assetBal = balances.find(b => b.asset.toUpperCase() === asset);

                if (!assetBal || assetBal.free < (grossQty * 0.5)) {
                  await new Promise(r => setTimeout(r, 1000));
                  balances = await this.mexcClient.getBalances();
                  assetBal = balances.find(b => b.asset.toUpperCase() === asset);
                }

                if (assetBal && assetBal.free > 0) {
                  const safeFree = assetBal.free * 0.998;
                  const truncated = Math.floor(safeFree * 100000000) / 100000000;
                  if (truncated > 0) {
                    sellQty = truncated;
                    this.log(`[REAL] Stop Loss balance match: using free balance ${sellQty} (unlocked free: ${assetBal.free})`, 'info', order.symbol);
                  }
                }
              } catch (balErr) {
                this.log(`[REAL] Stop Loss balance query failed: ${balErr.message}. Falling back to estimated quantity.`, 'warning', order.symbol);
              }

              // Place LIMIT SELL at FRESH live market price for 0% Maker fee
              let sellResult = null;
              const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000, 100000000];
              let lastErr = null;
              const slSellPrice = freshSlPrice; // LIMIT SELL at FRESH live market price

              for (const mult of decimalsToTry) {
                const qtyToTry = Math.floor(sellQty * mult) / mult;
                if (qtyToTry <= 0) continue;
                try {
                  const sellParams = {
                    symbol: order.symbol,
                    side: 'SELL',
                    type: 'LIMIT',
                    quantity: qtyToTry,
                    price: slSellPrice
                  };
                  sellResult = await this.mexcClient.placeOrder(sellParams);
                  if (sellResult && sellResult.orderId) {
                    this.log(`[REAL] Stop Loss LIMIT Sell placed! Qty: ${qtyToTry}, Price: ${slSellPrice}, Order ID: ${sellResult.orderId}`, 'success', order.symbol);
                    break;
                  }
                } catch (err) {
                  lastErr = err;
                  const errMsg = err.message || '';
                  if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                    continue;
                  }
                  if (errMsg.includes('Oversold') || errMsg.includes('30005')) {
                    this.log(`[REAL] Oversold (30005) detected for ${qtyToTry}. Reducing quantity by 0.5% buffer and retrying...`, 'warning', order.symbol);
                    sellQty = Math.floor(sellQty * 0.995 * 10000) / 10000;
                    continue;
                  }
                  throw err;
                }
              }

              if (!sellResult || !sellResult.orderId) {
                throw lastErr || new Error('Failed to place SL limit sell after precision retries.');
              }

              // Wait for LIMIT SELL to fill (with MARKET fallback on timeout)
              const slFills = await this.waitForLimitOrderFill(order.symbol, sellResult.orderId, 'SELL', sellQty, currentPrice);

              order.status = 'TRIGGERED';
              order.sellExecutionPrice = slFills.avgPrice || currentPrice;
              order.sellTriggeredAt = new Date().toISOString();
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
        const confirmedReasons = [];

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
            const pctStr = (bidsRatio * 100).toFixed(1);
            if (bidsRatio < 0.55) {
              passedFilters = false;
              failedReasons.push(`OBI Support ${pctStr}% < 55%`);
            } else {
              confirmedReasons.push(`OBI Support ${pctStr}% >= 55%`);
            }
          } catch (e) {
            this.log(`OBI Filter query failed: ${e.message}`, 'warning', order.symbol);
            passedFilters = false;
            failedReasons.push(`OBI Query Error`);
          }
        }

        if (order.filterVolume) {
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
              } else {
                confirmedReasons.push(`Volume Spike ${currentVol.toFixed(1)} >= 1.5x avg`);
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

        if (order.filterRsi) {
          try {
            const klines = await this.mexcClient.getKlines(order.symbol, '1m', 30);
            if (klines && klines.length >= 15) {
              const closes = klines.map(k => parseFloat(k[4]));
              const rsi = this.calculateRSI(closes);
              if (rsi > 35) {
                passedFilters = false;
                failedReasons.push(`RSI ${rsi.toFixed(1)} > 35`);
              } else {
                confirmedReasons.push(`RSI ${rsi.toFixed(1)} <= 35`);
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

        if (order.filterSmartSl) {
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
            const pctStr = (bidsRatio * 100).toFixed(1);
            if (bidsRatio < 0.55) {
              passedFilters = false;
              failedReasons.push(`Smart SL Entry Guard ${pctStr}% bids < 55%`);
            } else {
              confirmedReasons.push(`Smart SL Entry Guard ${pctStr}% bids >= 55%`);
            }
          } catch (e) {
            this.log(`Smart SL Entry Guard Filter query failed: ${e.message}`, 'warning', order.symbol);
            passedFilters = false;
            failedReasons.push(`Smart SL Entry Guard Error`);
          }
        }

        if (!passedFilters) {
          // Throttling logs to once every 5 seconds per order symbol
          const now = Date.now();
          if (!order.lastFilterFailLogTime || (now - order.lastFilterFailLogTime > 5000)) {
            order.lastFilterFailLogTime = now;
            this.log(`⏳ Trailing buy trigger reached at ${currentPrice} USDT, but BUY DEFERRED. Failed confirmations: ${failedReasons.join(', ')}. Waiting for indicator alignment.`, 'info', order.symbol);
          }
          continue;
        }

        order.triggeredAt = new Date().toISOString();
        const mode = order.dryRun ? '[DRY RUN]' : '[REAL]';
        const indicatorLog = confirmedReasons.length > 0 ? ` (Confirmed Metrics: ${confirmedReasons.join(', ')})` : '';
        this.log(`🟢 ENTRY CONFIRMED! Trailing stop buy triggered at ${currentPrice} USDT!${indicatorLog}. Executing ${mode} buy...`, 'success', order.symbol);

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
          // PLACE REAL ORDER — LIMIT BUY for 0% Maker fee
          try {
            order.status = 'PENDING_EXECUTION'; // intermediate state

            // Calculate Maker Peg BUY price from depth (< Best Ask strictly)
            const freshBuyPrice = await this.calculateMakerPegPrice(order.symbol, 'BUY', currentPrice);
            this.log(`Placing Spot LIMIT BUY order at ${freshBuyPrice} USDT on MEXC for ${order.symbol} (0% Maker fee)...`, 'info', order.symbol);
            
            let result = null;
            let lastBuyErr = null;
            const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000, 100000000];
            let buyQty = null;

            if (order.quantity) {
              for (const mult of decimalsToTry) {
                const qtyToTry = Math.floor(order.quantity * mult) / mult;
                if (qtyToTry <= 0) continue;
                try {
                  const orderParams = {
                    symbol: order.symbol,
                    side: 'BUY',
                    type: 'LIMIT',
                    quantity: qtyToTry,
                    price: freshBuyPrice
                  };
                  result = await this.mexcClient.placeOrder(orderParams);
                  if (result && result.orderId) { buyQty = qtyToTry; break; }
                } catch (err) {
                  lastBuyErr = err;
                  const errMsg = err.message || '';
                  if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                    // Silently retry with next precision
                    continue;
                  }
                  throw err;
                }
              }
            } else {
              // quoteOrderQty not supported for LIMIT on MEXC, calculate qty from price
              const estimatedQty = order.quoteOrderQty / freshBuyPrice;
              for (const mult of decimalsToTry) {
                const qtyToTry = Math.floor(estimatedQty * mult) / mult;
                if (qtyToTry <= 0) continue;
                try {
                  const orderParams = {
                    symbol: order.symbol,
                    side: 'BUY',
                    type: 'LIMIT',
                    quantity: qtyToTry,
                    price: freshBuyPrice
                  };
                  result = await this.mexcClient.placeOrder(orderParams);
                  if (result && result.orderId) { buyQty = qtyToTry; break; }
                } catch (err) {
                  lastBuyErr = err;
                  const errMsg = err.message || '';
                  if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                    continue;
                  }
                  throw err;
                }
              }
            }

            if (!result || !result.orderId) {
              throw lastBuyErr || new Error('Failed to place trailing LIMIT buy order.');
            }
            
            order.mexcOrderId = result.orderId;
            
            // Wait for LIMIT order to fill (with MARKET fallback on timeout)
            const fills = await this.waitForLimitOrderFill(order.symbol, result.orderId, 'BUY', buyQty, freshBuyPrice);
            if (!fills || !fills.filled || !fills.executedQty) {
              order.status = 'PENDING_ACTIVATION';
              order.error = 'BUY order unfilled on MEXC after repeg shifts and fallback.';
              this.log(`[REAL] BUY order failed to fill on MEXC. Aborting TP/SL placement to prevent Oversold error.`, 'error', order.symbol);
              this.saveOrders();
              return;
            }

            if (fills.fallbackOrderId) order.mexcOrderId = fills.fallbackOrderId;
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
                  
                  let tpResult = null;
                  let lastTpErr = null;
                  const safeQty = sellQty * 0.998;
                  const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000, 100000000];
                  
                  for (const mult of decimalsToTry) {
                    const qtyToTry = Math.floor(safeQty * mult) / mult;
                    if (qtyToTry <= 0) continue;
                    try {
                      const tpParams = {
                        symbol: order.symbol,
                        side: 'SELL',
                        type: 'LIMIT',
                        quantity: qtyToTry,
                        price: tpPrice
                      };
                      tpResult = await this.mexcClient.placeOrder(tpParams);
                      if (tpResult && tpResult.orderId) {
                        order.mexcSellOrderId = tpResult.orderId;
                        this.log(`[REAL] Take Profit Limit Sell order placed on MEXC for ${qtyToTry} tokens. Order ID: ${tpResult.orderId}`, 'success', order.symbol);
                        break;
                      }
                    } catch (err) {
                      lastTpErr = err;
                      const errMsg = err.message || '';
                      if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                        // Silently retry with next precision
                        continue;
                      }
                      if (errMsg.includes('30002') || errMsg.includes('1USDT')) {
                        this.log(`[REAL] TP Limit Sell value < 1 USDT (${qtyToTry} @ ${tpPrice}). TP order skipped, bot will monitor SL.`, 'warning', order.symbol);
                        break;
                      }
                      throw err;
                    }
                  }
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

      // Determine trade type (Take Profit vs Stop Loss vs Manual)
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

      const isBuyMaker = order.buyOrderType === 'LIMIT' || order.isBuyPegged;
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
      order.isSlExtended = false;
      order.isSlProfitLocked = false;
      order.lockedSlPrice = null;
      delete order.justProfitLocked;

      this.log(
        `Cycle #${cycleNum} completed (${type}). Resetting order to pending activation. New peak: ${order.peakPrice}, Activation price: ${order.activationPrice}`,
        'success',
        order.symbol
      );
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
