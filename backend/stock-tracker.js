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

  // Pre-Execution Order Book Depth Slippage Simulator
  async simulateDepthSlippage(symbol, side, qty) {
    try {
      const depth = await this.mexcClient.getDepth(symbol, 100);
      if (!depth) return { isLiquid: true, slippagePct: 0, bestPrice: 0, avgPrice: 0 };

      const levels = side === 'BUY' ? depth.asks : depth.bids;
      if (!levels || levels.length === 0) {
        return { isLiquid: false, slippagePct: 999, bestPrice: 0, avgPrice: 0 };
      }

      const bestPrice = parseFloat(levels[0][0]);
      let remainingQty = qty;
      let totalCost = 0;

      for (const [pStr, qStr] of levels) {
        const p = parseFloat(pStr);
        const q = parseFloat(qStr);
        const take = Math.min(remainingQty, q);
        totalCost += (take * p);
        remainingQty -= take;
        if (remainingQty <= 0) break;
      }

      if (remainingQty > 0) {
        // Order book doesn't even have enough total quantity!
        return { isLiquid: false, slippagePct: 999, bestPrice, avgPrice: bestPrice };
      }

      const avgPrice = totalCost / qty;
      const slippagePct = (Math.abs(avgPrice - bestPrice) / bestPrice) * 100;

      return {
        isLiquid: true,
        slippagePct,
        bestPrice,
        avgPrice
      };
    } catch (e) {
      return { isLiquid: true, slippagePct: 0, bestPrice: 0, avgPrice: 0 };
    }
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
      maxSlippagePct: config.maxSlippagePct !== undefined ? parseFloat(config.maxSlippagePct) : 0.5,
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
    this.log(`New Stock Bot order created for ${config.symbol} (Max Slippage: ${newOrder.maxSlippagePct}%)`, 'info', config.symbol);

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

            // EXTREME SLIPPAGE GUARD FOR BUY EXECUTION
            const buyQty = order.quantity || (order.quoteOrderQty ? (order.quoteOrderQty / currentPrice) : 1);
            const sim = await this.simulateDepthSlippage(order.symbol, 'BUY', buyQty);

            if (order.dryRun) {
              order.status = (order.takeProfit || order.stopLoss) ? 'TP_SL_ACTIVE' : 'TRIGGERED';
              order.executionPrice = currentPrice;
              order.triggeredAt = new Date().toISOString();
              this.log(`[DRY RUN] Trailing Buy Triggered! Bought at ${currentPrice} USDT (Simulated Slippage: ${sim.slippagePct.toFixed(2)}%).`, 'success', order.symbol);
              changed = true;

              if (!order.takeProfit && !order.stopLoss) {
                this.handleOrderCycleComplete(order);
              }
            } else {
              order.status = 'PENDING_EXECUTION';
              this.log(`Placing Stock BUY order on MEXC for ${order.symbol}...`, 'info', order.symbol);

              try {
                let result = null;
                const maxAllowed = order.maxSlippagePct || 0.5;

                if (sim.isLiquid && sim.slippagePct <= maxAllowed) {
                  // Liquidity is good within slippage tolerance -> Market Buy
                  const orderParams = {
                    symbol: order.symbol,
                    side: 'BUY',
                    type: 'MARKET',
                    quantity: buyQty
                  };
                  result = await this.mexcClient.placeOrder(orderParams);
                } else {
                  // Slippage too high -> BLOCK MARKET ORDER & Place Pegged Limit Order at (Top Bid + 0.02)
                  let topBid = currentPrice;
                  try {
                    const depth = await this.mexcClient.getDepth(order.symbol, 10);
                    if (depth && Array.isArray(depth.bids) && depth.bids.length > 0) {
                      topBid = parseFloat(depth.bids[0][0]);
                    }
                  } catch (dErr) {
                    this.log(`Failed to fetch top bid for pegged order: ${dErr.message}`, 'warning', order.symbol);
                  }

                  const peggedPrice = Math.round((topBid + 0.02) * 10000) / 10000;
                  this.log(
                    `⚠️ [MAX SLIPPAGE GUARD] Market Buy Slippage (${sim.slippagePct.toFixed(2)}% > ${maxAllowed}%) too high! BLOCKING MARKET DUMP. Top Bid: ${topBid.toFixed(4)} USDT. Placing Pegged Limit Buy Order at ${peggedPrice.toFixed(4)} USDT (+0.02 front-of-queue)...`,
                    'warning',
                    order.symbol
                  );
                  
                  const orderParams = {
                    symbol: order.symbol,
                    side: 'BUY',
                    type: 'LIMIT',
                    quantity: buyQty,
                    price: peggedPrice
                  };
                  result = await this.mexcClient.placeOrder(orderParams);
                }

                if (result && result.orderId) {
                  order.mexcOrderId = result.orderId;
                  order.executionPrice = currentPrice;
                  order.status = (order.takeProfit || order.stopLoss) ? 'TP_SL_ACTIVE' : 'TRIGGERED';
                  this.log(`[REAL] Stock Buy order placed! Order ID: ${result.orderId}. Status: ${order.status}`, 'success', order.symbol);
                  changed = true;

                  if (!order.takeProfit && !order.stopLoss) {
                    this.handleOrderCycleComplete(order);
                  }
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

              // EXTREME SLIPPAGE GUARD FOR SELL EXECUTION
              const sellQty = order.quantity || 1.0;
              const sim = await this.simulateDepthSlippage(order.symbol, 'SELL', sellQty);
              const maxAllowed = order.maxSlippagePct || 0.5;

              try {
                let sellResult = null;
                if (sim.isLiquid && sim.slippagePct <= maxAllowed) {
                  const sellParams = {
                    symbol: order.symbol,
                    side: 'SELL',
                    type: 'MARKET',
                    quantity: sellQty
                  };
                  sellResult = await this.mexcClient.placeOrder(sellParams);
                } else {
                  const peggedSellPrice = sim.bestPrice ? (sim.bestPrice * (1 - (maxAllowed / 100))) : targetSlPrice;
                  this.log(`⚠️ [MAX SLIPPAGE GUARD] Stock Market Sell Slippage (${sim.slippagePct.toFixed(2)}% > ${maxAllowed}%) too high! BLOCKING MARKET DUMP. Placing Pegged Limit Sell Order at ${peggedSellPrice.toFixed(4)} USDT...`, 'warning', order.symbol);

                  const sellParams = {
                    symbol: order.symbol,
                    side: 'SELL',
                    type: 'LIMIT',
                    quantity: sellQty,
                    price: peggedSellPrice
                  };
                  sellResult = await this.mexcClient.placeOrder(sellParams);
                }

                if (sellResult && sellResult.orderId) {
                  order.status = 'TRIGGERED';
                  order.sellExecutionPrice = targetSlPrice;
                  this.log(`[REAL] Stock Stop Loss Sell order executed! Order ID: ${sellResult.orderId}`, 'success', order.symbol);
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

  // Handle cycle completion, trade recording, and auto-repeat re-activation
  handleOrderCycleComplete(order) {
    if (order.status === 'TRIGGERED' && order.autoRepeat) {
      const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
      const buyPrice = order.executionPrice;
      const sellPrice = order.sellExecutionPrice || order.currentPrice;
      const unitProfit = sellPrice - buyPrice;

      const qty = order.quantity || (order.quoteOrderQty && buyPrice > 0 ? (order.quoteOrderQty / buyPrice) : 1);
      const cycleUsdtProfit = unitProfit * qty;

      order.totalNetProfit = (order.totalNetProfit || 0) + cycleUsdtProfit;

      let type = 'MANUAL_SELL';
      if (order.takeProfit && Math.abs(sellPrice - (buyPrice + order.takeProfit)) < 0.0001) {
        type = 'TAKE_PROFIT';
      } else if (order.stopLoss) {
        type = 'STOP_LOSS';
      }

      const tradeRecord = {
        cycle: cycleNum,
        buyPrice,
        sellPrice,
        profit: unitProfit,
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
