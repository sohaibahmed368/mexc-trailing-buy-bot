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
    this.pollInterval = 1800; // 1.8 seconds interval (within 1.5s - 2.0s user range)
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
      return this.cachedFeeSummary || { usdtFees: 0, mxFees: 0, totalFeesInUsdt: 0, feeCount: 0 };
    }

    try {
      // Collect all unique symbols ever tracked by this bot (non-dryRun orders only)
      const symbolsToCheck = new Set();
      (this.orders || []).forEach(o => {
        if (o.symbol && !o.dryRun) symbolsToCheck.add(o.symbol.toUpperCase());
      });

      if (symbolsToCheck.size === 0) {
        return this.cachedFeeSummary || { usdtFees: 0, mxFees: 0, totalFeesInUsdt: 0, feeCount: 0 };
      }

      let totalUsdtFees = 0;
      let totalMxFees   = 0;
      let feeCount      = 0;

      // Fetch actual trade history from MEXC for every symbol this bot has ever traded
      for (const symbol of symbolsToCheck) {
        try {
          const trades = await this.mexcClient.getMyTrades(symbol, 1000);
          if (Array.isArray(trades)) {
            trades.forEach(t => {
              const fee      = parseFloat(t.commission || 0);
              const feeAsset = (t.commissionAsset || '').toUpperCase();
              const quoteQty = parseFloat(t.quoteQty || (parseFloat(t.price || 0) * parseFloat(t.qty || 0)));

              if (fee > 0) {
                feeCount++;
                if (feeAsset === 'USDT') {
                  totalUsdtFees += fee;
                } else if (feeAsset === 'MX') {
                  totalMxFees += fee;
                  // Convert MX fee to USDT at trade execution time value (0.04% of trade quote value)
                  // This LOCKS historical fee in USDT permanently so MX price changes NEVER alter past totals!
                  const tradeMxUsdtFee = quoteQty > 0 ? (quoteQty * 0.0004) : (fee * 1.65);
                  totalUsdtFees += tradeMxUsdtFee;
                }
              }
            });
          }
        } catch (e) {
          // Symbol not traded yet or API error — skip silently
        }
      }

      // Total Fees in USDT is 100% STABLE & IMMUTABLE (Zero dependency on live MX price fluctuations!)
      const totalFeesInUsdt = totalUsdtFees;

      this.cachedFeeSummary = {
        usdtFees: parseFloat(totalUsdtFees.toFixed(4)),
        mxFees:   parseFloat(totalMxFees.toFixed(4)),
        mxInUsdt: parseFloat((totalFeesInUsdt - totalUsdtFees).toFixed(4)),
        totalFeesInUsdt: parseFloat(totalFeesInUsdt.toFixed(4)),
        feeCount
      };
      this.lastFeeCheckTime = now;
      return this.cachedFeeSummary;
    } catch (err) {
      return this.cachedFeeSummary || { usdtFees: 0, mxFees: 0, mxInUsdt: 0, totalFeesInUsdt: 0, feeCount: 0 };
    }
  }

  // Emit live fee update to all connected frontend clients after a cycle completes
  async emitFeesUpdate() {
    try {
      const fees = await this.getTotalMexcFeesPaid(true);
      this.io.emit('fees_update', fees);
    } catch (e) {
      // Non-critical — frontend will get fees on next balance refresh
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
        // Sanitize & Purge old synthetic stress-test histories on server load
        if (Array.isArray(this.orders)) {
          this.orders.forEach(o => {
            // Auto-migrate: Ensure filter40sVolume is set properly
            if (o.filter40sVolume === undefined || o.filter40sVolume === null) {
              o.filter40sVolume = true;
            }
            if (Array.isArray(o.tradeHistory) && o.tradeHistory.length > 20) {
              o.tradeHistory = [];
              o.totalNetProfit = 0;
            }
          });

          // Strict Single-Card-Per-Symbol Deduplication: Ensure strictly AT MOST 1 card per symbol!
          const seenSymbols = new Set();
          const uniqueOrders = [];
          // Sort active positions first so active orders take priority over inactive ones
          const sorted = [...this.orders].sort((a, b) => {
            const aActive = a.status === 'TP_SL_ACTIVE' || a.status === 'PENDING_EXECUTION';
            const bActive = b.status === 'TP_SL_ACTIVE' || b.status === 'PENDING_EXECUTION';
            if (aActive && !bActive) return -1;
            if (!aActive && bActive) return 1;
            return 0;
          });
          sorted.forEach(o => {
            const sym = (o.symbol || '').toUpperCase().trim();
            if (sym && !seenSymbols.has(sym)) {
              seenSymbols.add(sym);
              uniqueOrders.push(o);
            }
          });
          this.orders = uniqueOrders;
        }
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
    if (this.io && typeof this.io.emit === 'function') {
      this.io.emit('orders_update', this.orders);
    }
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
    if (this.io && typeof this.io.emit === 'function') {
      this.io.emit('log_entry', logEntry);
    }

    // Output all logs directly to stdout so PM2 logs and VPS terminal reflect live bot activity in real-time
    const timeStr = new Date().toLocaleTimeString();
    console.log(`[${timeStr}] [BOT ${type.toUpperCase()}]${symbol ? ` [${symbol}]` : ''} ${message}`);
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
   * Calculate 20s-30s Taker Volume Delta (Market Buy % vs Market Sell %)
   */
  async calculateTakerVolumeDelta(symbol, timeWindowMs = 25000) {
    try {
      const trades = await this.mexcClient.getRecentTrades(symbol, 100);
      if (!Array.isArray(trades) || trades.length === 0) return { takerBuyPct: 50.0, takerSellPct: 50.0, totalVolume: 0 };

      const now = Date.now();
      let buyVol = 0;
      let sellVol = 0;

      trades.forEach(t => {
        const tradeTime = parseInt(t.time || t.timestamp || now);
        if ((now - tradeTime) <= timeWindowMs || trades.length <= 15) {
          const qty = parseFloat(t.qty || t.quantity || 0);
          const price = parseFloat(t.price || 0);
          const val = qty * price;
          if (t.isBuyerMaker) {
            sellVol += val;
          } else {
            buyVol += val;
          }
        }
      });

      const total = buyVol + sellVol;
      const takerBuyPct = total > 0 ? (buyVol / total) * 100 : 50.0;
      const takerSellPct = total > 0 ? (sellVol / total) * 100 : 50.0;

      return {
        takerBuyPct: parseFloat(takerBuyPct.toFixed(1)),
        takerSellPct: parseFloat(takerSellPct.toFixed(1)),
        totalVolume: parseFloat(total.toFixed(2))
      };
    } catch (e) {
      return { takerBuyPct: 50.0, takerSellPct: 50.0, totalVolume: 0 };
    }
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
        const bestAsk = parseFloat(depth.asks[0][0]);

        let tick = 0.0001;
        if (bestBid > 1000) tick = 0.01;
        else if (bestBid > 10) tick = 0.001;
        else if (bestBid < 0.1) tick = 0.000001;

        const decimals = tick.toString().includes('.') ? tick.toString().split('.')[1].length : 2;

        if (side.toUpperCase() === 'BUY') {
          // STRICT 100% MAKER BUY RULE: Join Buyer Queue at least 2 ticks safely below bestAsk
          let pegPrice = Math.min(bestBid, bestAsk - (tick * 2));
          if (pegPrice <= 0) pegPrice = Math.max(0.00000001, bestBid);
          
          // HARD GUARD: pegPrice MUST be strictly less than bestAsk by at least 2 ticks
          const maxAllowedBuyPrice = parseFloat((bestAsk - (tick * 2)).toFixed(decimals));
          if (pegPrice >= bestAsk || pegPrice > maxAllowedBuyPrice) {
            pegPrice = maxAllowedBuyPrice;
          }

          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          this.log(`[MAKER PEG BUY] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Guaranteed MAKER BUY Price: ${pegPrice} (< Ask ${bestAsk} ✅)`, 'info', symbol);
          return pegPrice;
        } else {
          // STRICT 100% MAKER SELL RULE: Join Seller Queue at least 2 ticks safely above bestBid
          let pegPrice = Math.max(bestAsk, bestBid + (tick * 2));
          const minAllowedSellPrice = parseFloat((bestBid + (tick * 2)).toFixed(decimals));
          if (pegPrice <= bestBid || pegPrice < minAllowedSellPrice) {
            pegPrice = minAllowedSellPrice;
          }

          pegPrice = parseFloat(pegPrice.toFixed(decimals));
          this.log(`[MAKER PEG SELL] Depth Best Bid: ${bestBid}, Best Ask: ${bestAsk} → Guaranteed MAKER SELL Price: ${pegPrice} (> Bid ${bestBid} ✅)`, 'info', symbol);
          return pegPrice;
        }
      }
    } catch (err) {
      this.log(`[MAKER PEG] Failed to query depth for ${symbol}: ${err.message}. Applying safe sub-Ask fallback...`, 'warning', symbol);
    }

    // SAFE FALLBACK GUARD: If depth query fails, force price 0.1% below fallback for BUY so it CANNOT hit Asks as Taker
    if (side.toUpperCase() === 'BUY' && fallbackPrice) {
      const safeBuyFallback = parseFloat((fallbackPrice * 0.999).toFixed(4));
      this.log(`[MAKER PEG FALLBACK] Safe Sub-Ask BUY Price: ${safeBuyFallback} (0.1% below market) to guarantee MAKER status.`, 'warning', symbol);
      return safeBuyFallback;
    }
    return fallbackPrice;
  }

  /**
   * Smart Momentum Pressure Detector:
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
   * 100% MAKER RE-PEG ENGINE (NO MARKET FALLBACK EVER)
   * Continuously polls and re-pegs LIMIT orders every 1.5s (1500ms order stay window) to top of orderbook
   * strictly maintaining BUY <= Best Bid and SELL >= Best Ask for 0% Maker fees.
   * Gives market takers sufficient time to hit passive limit orders while maintaining low API load.
   */
  async waitForLimitOrderFill(symbol, orderId, side, quantity, fallbackPrice, maxWaitMs = 300000, pollMs = 1500) {
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
          // SMART DELTA CHECK: Query fresh depth target BEFORE cancelling!
          const targetPegPrice = await this.calculateMakerPegPrice(symbol, side, currentPrice);

          // If current order price is STILL optimal target peg price, DO NOT CANCEL! Preserve Queue Priority & Save API calls!
          if (Math.abs(targetPegPrice - currentPrice) < 0.0000001 || targetPegPrice === currentPrice) {
            this.log(`🛡️ [SMART LAZY PEG] Check #${attempts}: Order ${currentOrderId} at ${currentPrice} USDT is STILL optimal Top ${side}. Preserving Orderbook Queue Priority (Skipping Re-peg).`, 'info', symbol);
            continue;
          }

          this.log(`[MAKER RE-PEG SHIFT] Check #${attempts}: Orderbook depth shifted (${currentPrice} → ${targetPegPrice}). Re-pegging order ${currentOrderId}...`, 'warning', symbol);
          
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

          currentPrice = targetPegPrice;

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

  async calculate15mRSI(symbol) {
    try {
      const klines = await this.mexcClient.getKlines(symbol, '15m', 25);
      if (!klines || klines.length < 15) return 50.0;
      
      const closes = klines.map(k => parseFloat(k[4])).filter(c => !isNaN(c));
      if (closes.length < 15) return 50.0;

      let gains = 0;
      let losses = 0;
      for (let i = 1; i < 15; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
      }

      let avgGain = gains / 14;
      let avgLoss = losses / 14;

      for (let i = 15; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff >= 0) {
          avgGain = (avgGain * 13 + diff) / 14;
          avgLoss = (avgLoss * 13) / 14;
        } else {
          avgGain = (avgGain * 13) / 14;
          avgLoss = (avgLoss * 13 - diff) / 14;
        }
      }

      if (avgLoss === 0) return 100.0;
      const rs = avgGain / avgLoss;
      return parseFloat((100 - (100 / (1 + rs))).toFixed(1));
    } catch (err) {
      return 50.0;
    }
  }

  async apply15mTrendGuard(order) {
    order.buyTime = Date.now();
    try {
      const rsi15m = await this.calculate15mRSI(order.symbol);
      order.rsi15mAtBuy = rsi15m;
      const tpTargetPrice = order.executionPrice * (1 + ((order.takeProfit || 0.6) / 100));

      if (rsi15m >= 45) {
        order.adaptiveSlMode = 'NO_SL';
        order.activeSlPrice = null;
        this.log(
          `🛡️ [15M TREND GUARD — NO-SL ACTIVATED] ${order.symbol} 15m RSI = ${rsi15m.toFixed(1)} (>= 45 Bullish/Sideways Zone). Stop Loss DISABLED! Placing +${order.takeProfit || 0.6}% TP Limit Sell Order @ $${tpTargetPrice.toFixed(4)} USDT. Noise wicks will be held safely until TP fills!`,
          'success',
          order.symbol
        );
      } else {
        order.adaptiveSlMode = 'SL_ACTIVE';
        const slDollar = ((order.stopLoss || 0.3) / 100) * order.executionPrice;
        order.activeSlPrice = order.executionPrice - slDollar;
        this.log(
          `⚠️ [15M TREND GUARD — ACTIVE SL ENABLED] ${order.symbol} 15m RSI = ${rsi15m.toFixed(1)} (< 40 Crashing Zone). Market in downtrend! Active Stop Loss ENABLED at $${order.activeSlPrice.toFixed(4)} USDT (-${order.stopLoss || 0.3}%) to protect USDT capital.`,
          'warning',
          order.symbol
        );
      }
    } catch (err) {
      order.adaptiveSlMode = 'SL_ACTIVE';
      this.log(`15m Trend Guard calculation failed: ${err.message}. Defaulting to SL Active.`, 'warning', order.symbol);
    }
  }

  async getFeeAdjustedBalance(symbol, grossQty) {
    const asset = symbol.replace('USDT', '').toUpperCase();
    let decimals = 4;
    if (asset === 'BTC') decimals = 6;
    else if (asset === 'ETH') decimals = 5;
    else if (asset === 'SOL') decimals = 4;
    else decimals = 4;

    const multFactor = Math.pow(10, decimals);

    try {
      // Poll up to 5 times (waiting 800ms between attempts, total 4s) for MEXC fill balance settlement
      for (let attempt = 1; attempt <= 5; attempt++) {
        await new Promise(r => setTimeout(r, 800));
        try {
          const balances = await this.mexcClient.getBalances();
          const assetBal = balances.find(b => b.asset.toUpperCase() === asset);
          if (assetBal && assetBal.free > 0) {
            const safeFree = assetBal.free * 0.995; // 0.5% fee & settlement safety buffer
            const truncated = Math.floor(safeFree * multFactor) / multFactor;
            if (truncated > 0) {
              this.log(`Fetched confirmed asset balance for ${asset}: free balance is ${assetBal.free} (used safe qty: ${truncated}).`, 'info', symbol);
              return truncated;
            }
          }
        } catch (bErr) {}
      }
    } catch (err) {
      this.log(`Balance lookup failed: ${err.message}. Falling back to estimated quantity with fee margin.`, 'warning', symbol);
    }
    
    // Fallback: estimate gross quantity and deduct a 0.5% fee safety margin
    const estimated = grossQty * 0.995;
    const truncatedEst = Math.floor(estimated * multFactor) / multFactor;
    this.log(`Using fee-adjusted estimated quantity: ${truncatedEst} (gross: ${grossQty})`, 'info', symbol);
    return truncatedEst;
  }


  getSymbolQuantityPrecision(symbol) {
    symbol = (symbol || '').toUpperCase().trim();
    if (symbol.startsWith('BTC') || symbol.startsWith('ETH')) return 10000; // 4 decimal places
    if (symbol.startsWith('SHIB') || symbol.startsWith('PEPE') || symbol.startsWith('BONK') || symbol.startsWith('FLOKI')) return 1; // integers
    return 100; // 2 decimal places default for SOL, XRP, ONDO, SUI, UNI, DOGE, AVAX, LINK, etc.
  }

  clearTradeHistory() {
    this.orders.forEach(o => {
      o.tradeHistory = [];
      o.totalNetProfit = 0;
    });
    this.saveOrders();
    this.log('🧹 Master Trade History cleared & Win Ratio reset by user.', 'warning');
    return this.orders;
  }

  async addOrder({ symbol, trailValue, quantity, quoteOrderQty, orderType, dryRun, activationPrice, takeProfit, stopLoss, filterSmartSl, slBuffer, filterObi, filterVolume, filterRsi, filter40sVolume, autoRepeat, activationOffset, startImmediately, consensusMode }) {
    symbol = symbol.toUpperCase().trim();

    // Check if an active position is currently open for this symbol
    const existingActivePos = this.orders.find(o => o.symbol === symbol && (o.status === 'TP_SL_ACTIVE' || o.status === 'PENDING_EXECUTION'));

    // Symbol Deduplication Guard: Strictly enforce AT MOST 1 CARD PER SYMBOL in this.orders!
    this.orders = this.orders.filter(o => o.symbol !== symbol);

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

    // Check if ANY order card already exists for this symbol (active trade or running/pending state)
    const existingCard = this.orders.find(o => o.symbol === symbol);
    
    let startInstantBuy = autoRepeat && startImmediately;
    
    // Safety Lock: If an order card ALREADY exists for this symbol, DO NOT trigger instant buy on setting update/save!
    if (startInstantBuy && existingCard) {
      this.log(`🔒 [SETTINGS UPDATE] Existing card for ${symbol} updated in-place. Instant market buy skipped to prevent unexpected buy on save!`, 'info', symbol);
      startInstantBuy = false;
    }

    if (startInstantBuy && existingActivePos) {
      this.log(`🔒 [POSITION GUARD LOCKED] Active position already open for ${symbol} (${existingActivePos.id}). Instant buy skipped to prevent duplicate position!`, 'warning', symbol);
      startInstantBuy = false;
    }

    if (existingActivePos) {
      // Preserve active trade status & tracking properties if position is currently active
      status = existingActivePos.status;
    } else if (startInstantBuy) {
      status = 'TP_SL_ACTIVE';
    } else if (autoRepeat && activationOffset) {
      const offsetPct = parseFloat(activationOffset);
      parsedActivationPrice = initialPrice * (1 - (offsetPct / 100));
      status = 'PENDING_ACTIVATION';
      activationDirection = 'DOWN';
    } else if (parsedActivationPrice !== null) {
      status = 'PENDING_ACTIVATION';
      // Determine if starting price is above or below activation target
      activationDirection = initialPrice > parsedActivationPrice ? 'DOWN' : 'UP';
    } else {
      bottomPrice = initialPrice;
      const trailDollar = initialPrice * (trailValue / 100);
      triggerPrice = initialPrice + trailDollar;
    }

    const newOrder = {
      id: existingActivePos ? existingActivePos.id : ('ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
      symbol,
      trailValue,
      quantity: quantity ? parseFloat(quantity) : null,
      quoteOrderQty: quoteOrderQty ? parseFloat(quoteOrderQty) : null,
      orderType: orderType || 'MARKET',
      dryRun: !!dryRun,
      status,
      activationPrice: (startInstantBuy || existingActivePos) ? null : parsedActivationPrice,
      activationDirection: (startInstantBuy || existingActivePos) ? null : activationDirection,
      activatedAt: existingActivePos ? existingActivePos.activatedAt : (startInstantBuy ? new Date().toISOString() : null),
      takeProfit: parsedTakeProfit,
      stopLoss: parsedStopLoss,
      filterSmartSl: !!filterSmartSl,
      slBuffer: parsedSlBuffer,
      isSlExtended: existingActivePos ? existingActivePos.isSlExtended : false,
      isSlProfitLocked: existingActivePos ? existingActivePos.isSlProfitLocked : false,
      lockedSlPrice: existingActivePos ? existingActivePos.lockedSlPrice : null,
      mexcSellOrderId: existingActivePos ? existingActivePos.mexcSellOrderId : null,
      sellExecutionPrice: existingActivePos ? existingActivePos.sellExecutionPrice : null,
      sellTriggeredAt: existingActivePos ? existingActivePos.sellTriggeredAt : null,
      filterObi: !!filterObi,
      filterVolume: !!filterVolume,
      filterRsi: !!filterRsi,
      filter40sVolume: filter40sVolume !== undefined ? !!filter40sVolume : true,
      consensusMode: consensusMode || 'SMART_CONFLUENCE',
      autoRepeat: !!autoRepeat,
      startImmediately: !!startImmediately,
      activationOffset: activationOffset ? parseFloat(activationOffset) : null,
      peakPrice: initialPrice,
      totalNetProfit: existingActivePos ? existingActivePos.totalNetProfit : 0,
      tradeHistory: existingActivePos ? (existingActivePos.tradeHistory || []) : [],
      initialPrice,
      bottomPrice: existingActivePos ? existingActivePos.bottomPrice : bottomPrice,
      triggerPrice: existingActivePos ? existingActivePos.triggerPrice : triggerPrice,
      currentPrice: initialPrice,
      createdAt: existingActivePos ? existingActivePos.createdAt : new Date().toISOString(),
      triggeredAt: existingActivePos ? existingActivePos.triggeredAt : (startInstantBuy ? new Date().toISOString() : null),
      mexcOrderId: existingActivePos ? existingActivePos.mexcOrderId : null,
      executionPrice: existingActivePos ? existingActivePos.executionPrice : (startInstantBuy ? initialPrice : null),
      error: null
    };

    if (startInstantBuy) {
      if (dryRun) {
        newOrder.executionPrice = initialPrice;
        this.log(`[DRY RUN] Auto-Loop started: First trade bought immediately at market price ${initialPrice} USDT. Transitioning to TP/SL monitoring.`, 'success', symbol);
      } else {
        try {
          // Real Spot Wallet Holding Guard: Check if asset is ALREADY held in spot wallet before sending instant market buy!
          try {
            const balances = await this.mexcClient.getBalances();
            const asset = symbol.replace('USDT', '').toUpperCase();
            const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
            if (assetBal) {
              const totalQty = (parseFloat(assetBal.free || 0) + parseFloat(assetBal.locked || 0));
              const notionalUsdt = totalQty * initialPrice;
              if (notionalUsdt >= 10.0) {
                this.log(`🔒 [REAL WALLET HOLDING GUARD] Physical wallet balance for ${symbol} is $${notionalUsdt.toFixed(2)} USDT (>= $10.00). Instant Market Buy CANCELLED! Card state transitioned to TP/SL monitoring!`, 'warning', symbol);
                newOrder.status = 'TP_SL_ACTIVE';
                newOrder.executionPrice = initialPrice;
                this.orders.push(newOrder);
                this.saveOrders();
                return newOrder;
              }
            }
          } catch (wErr) {}

          this.log(`🚀 [IMMEDIATE MARKET BUY VIA UI ACTION] Auto-Loop started: Sending instant MARKET BUY order to MEXC server for ${symbol}...`, 'info', symbol);
          
          let result = null;
          let lastBuyErr = null;
          const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000];
          let buyQty = null;

          if (newOrder.quantity) {
            for (const mult of decimalsToTry) {
              const qtyToTry = Math.floor(newOrder.quantity * mult) / mult;
              if (qtyToTry <= 0) continue;
              try {
                const orderParams = { symbol, side: 'BUY', type: 'MARKET', quantity: qtyToTry };
                this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(orderParams)}`, 'info', symbol);
                result = await this.mexcClient.placeOrder(orderParams);
                this.log(`[MEXC API RESPONSE] Order Placed Success -> ${JSON.stringify(result)}`, 'success', symbol);
                if (result && result.orderId) { buyQty = qtyToTry; break; }
              } catch (err) {
                lastBuyErr = err;
                if ((err.message || '').includes('quantity scale')) continue;
                throw err;
              }
            }
          } else if (newOrder.quoteOrderQty) {
            try {
              const orderParams = { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: newOrder.quoteOrderQty };
              this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(orderParams)}`, 'info', symbol);
              result = await this.mexcClient.placeOrder(orderParams);
              this.log(`[MEXC API RESPONSE] Order Placed Success -> ${JSON.stringify(result)}`, 'success', symbol);
            } catch (err) { lastBuyErr = err; }
          }

          if (!result || !result.orderId) {
            throw lastBuyErr || new Error('Failed to place initial MARKET buy order.');
          }

          newOrder.mexcOrderId = result.orderId;
          
          // Query executed fill price from MEXC
          let execPrice = initialPrice;
          try {
            this.log(`[MEXC API REQUEST] GET /api/v3/order -> Symbol: ${symbol}, OrderID: ${result.orderId}`, 'info', symbol);
            const fills = await this.mexcClient.getOrder(symbol, result.orderId);
            this.log(`[MEXC API RESPONSE] Query Fills Success -> ${JSON.stringify(fills)}`, 'success', symbol);
            if (fills && parseFloat(fills.executedQty) > 0) {
              const cumQuote = parseFloat(fills.cummulativeQuoteQty || 0);
              const execQty  = parseFloat(fills.executedQty || 1);
              if (cumQuote > 0) execPrice = cumQuote / execQty;
            }
          } catch(e) {}

          newOrder.executionPrice = execPrice;
          this.log(`✅ [MARKET BUY FILLED] Order ${result.orderId} executed at ${execPrice} USDT!`, 'success', symbol);
          
          if (parsedTakeProfit) {
            const tpPrice = execPrice + parsedTakeProfit;
            const grossQty = newOrder.quantity || (newOrder.quoteOrderQty / execPrice);
            
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

  // Purge ALL active tracking cards for fresh start
  clearAllOrders() {
    this.orders = [];
    this.saveOrders();
    this.log('🧹 ALL active tracking cards purged by user request.', 'warning');
    return this.orders;
  }

  async startTracking() {
    if (this.intervalId) return;

    // Register tracking loop IMMEDIATELY so ticks run without delay
    this.intervalId = setInterval(async () => {
      await this.tick();
    }, this.pollInterval);

    // Auto-Sync Live Wallet Holdings asynchronously in background (NON-BLOCKING)
    this.syncLiveWalletOrders().catch(() => {});
  }

  // Automatically scan MEXC Spot Wallet on server boot and restore Active Tracking Cards for whitelist crypto assets in wallet
  async syncLiveWalletOrders() {
    if (!this.mexcClient || !this.mexcClient.hasCredentials()) return;
    try {
      const balances = await this.mexcClient.getBalances();
      if (!Array.isArray(balances)) return;

      const allowedCryptoWhitelist = new Set(['BTC', 'ETH', 'SOL', 'ONDO', 'SUI', 'UNI', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'SHIB', 'PEPE', 'NEAR', 'FET', 'RNDR', 'TAO', 'WIF', 'BONK', 'FLOKI', 'BNB', 'MATIC', 'XAUT', 'PAXG', 'GOLD']);

      for (const bal of balances) {
        const asset = (bal.asset || '').toUpperCase();
        // IGNORE fiat/stablecoins and IGNORE any stock tokens/equity derivatives (like NVDAX, USO, AAPL, etc.)
        if (!allowedCryptoWhitelist.has(asset)) continue;

        const totalQty = parseFloat(bal.free || 0) + parseFloat(bal.locked || 0);
        if (totalQty <= 0) continue;

        const symbol = asset + 'USDT';
        
        let currentPrice = 0;
        try { currentPrice = await this.mexcClient.getTickerPrice(symbol); } catch (e) { continue; }
        if (!currentPrice || currentPrice <= 0) continue;

        const notionalUsdt = totalQty * currentPrice;
        let existingOrder = this.orders.find(o => o.symbol === symbol);

        // STRICT DUST CHECK: Only ignore if total balance value in wallet is genuinely under 10.0 USDT and no coins are locked in open sell orders!
        if (currentPrice > 0 && notionalUsdt < 10.0 && (parseFloat(bal.locked || 0) === 0)) {
          if (existingOrder && existingOrder.status === 'TP_SL_ACTIVE' && !existingOrder.mexcSellOrderId) {
            existingOrder.status = 'PENDING_ACTIVATION';
            existingOrder.executionPrice = null;
            this.log(`⚠️ [DUST BALANCE IGNORED] ${asset} wallet value is only $${notionalUsdt.toFixed(2)} USDT (< $10.00 minimum trade). Resetting card state to PENDING_ACTIVATION!`, 'info', symbol);
            this.saveOrders();
          }
          continue;
        }

        if (!existingOrder) {
          // Find last buy price from trade history or use current ticker price
          let execPrice = currentPrice;
          try {
            const trades = await this.mexcClient.getMyTrades(symbol, 5);
            if (Array.isArray(trades) && trades.length > 0) {
              const buyTrade = trades.reverse().find(t => !t.isBuyerMaker); // Find recent BUY
              if (buyTrade && parseFloat(buyTrade.price) > 0) execPrice = parseFloat(buyTrade.price);
            }
          } catch (tErr) {}

          let mexcSellOrderId = null;
          try {
            const openOrders = await this.mexcClient.getOpenOrders(symbol);
            if (Array.isArray(openOrders) && openOrders.length > 0) {
              const sellOrder = openOrders.find(o => o.side === 'SELL');
              if (sellOrder && sellOrder.orderId) mexcSellOrderId = sellOrder.orderId;
            }
          } catch (oErr) {}

          const newOrder = {
            id: 'ord_restored_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            symbol,
            trailValue: 0.25,
            quantity: null,
            quoteOrderQty: Math.max(50, Math.round(notionalUsdt)),
            orderType: 'MARKET',
            dryRun: false,
            status: 'TP_SL_ACTIVE',
            activationPrice: null,
            activationDirection: null,
            activatedAt: new Date().toISOString(),
            takeProfit: 0.6,
            stopLoss: 0.5,
            filterSmartSl: true,
            slBuffer: 0.2,
            isSlExtended: false,
            isSlProfitLocked: false,
            lockedSlPrice: null,
            mexcSellOrderId,
            sellExecutionPrice: null,
            sellTriggeredAt: null,
            filterObi: true,
            filterVolume: false,
            filterRsi: false,
            filter40sVolume: true,
            autoRepeat: true,
            startImmediately: false,
            activationOffset: 0.5,
            peakPrice: execPrice * 1.002,
            totalNetProfit: 0,
            tradeHistory: [],
            initialPrice: execPrice,
            bottomPrice: null,
            triggerPrice: null,
            currentPrice,
            createdAt: new Date().toISOString(),
            triggeredAt: new Date().toISOString(),
            mexcOrderId: 'restored_' + Date.now(),
            executionPrice: execPrice,
            error: null,
            localBottom: execPrice
          };

          this.orders.push(newOrder);
          this.log(`🔄 [AUTO-RESTORED WALLET ASSET] Found ${totalQty.toFixed(4)} ${asset} in MEXC wallet ($${notionalUsdt.toFixed(2)} USDT). Restored Active Tracking Card with MEXC Limit Sell Order ID ${mexcSellOrderId || 'Attached'}!`, 'success', symbol);
          this.saveOrders();
        } else if (existingOrder.status !== 'TP_SL_ACTIVE' && existingOrder.status !== 'PENDING_EXECUTION' && existingOrder.status !== 'CANCELLED') {
          // If asset is physically in wallet ($10+ USDT), sync card state to TP_SL_ACTIVE!
          existingOrder.status = 'TP_SL_ACTIVE';
          existingOrder.executionPrice = currentPrice;
          try {
            const openOrders = await this.mexcClient.getOpenOrders(symbol);
            if (Array.isArray(openOrders) && openOrders.length > 0) {
              const sellOrder = openOrders.find(o => o.side === 'SELL');
              if (sellOrder && sellOrder.orderId) existingOrder.mexcSellOrderId = sellOrder.orderId;
            }
          } catch (oErr) {}
          this.log(`🔄 [AUTO-SYNCED WALLET ASSET] Updated ${symbol} card state to TP_SL_ACTIVE for physical wallet holding ($${notionalUsdt.toFixed(2)} USDT)!`, 'info', symbol);
          this.saveOrders();
        }
      }
    } catch (e) {
      this.log(`Failed to sync live wallet assets: ${e.message}`, 'warning');
    }
  }

  // Check tracking loop (Ensure tracking loop is permanently active)
  checkTrackingLoop() {
    if (!this.intervalId) {
      this.startTracking();
    }
  }

  // Execute a single iteration of tracking
  async tick() {
    if (this.isTicking) return;
    this.isTicking = true;
    try {
      const activeOrders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');
      if (activeOrders.length === 0) {
        const now = Date.now();
        if (!this.lastStandbyHeartbeat || (now - this.lastStandbyHeartbeat > 30000)) {
          this.lastStandbyHeartbeat = now;
          this.log('💚 [ENGINE STANDBY] Bot engine active & polling ready. Waiting for tracking cards...', 'info');
        }
        return;
      }

    // Get unique active symbols to minimize API calls
    const symbols = [...new Set(activeOrders.map(o => o.symbol))];
    const prices = {};

    // Use bulk ticker fetching if tracking multiple symbols to avoid Akamai WAF rate-limiting
    if (symbols.length > 1) {
      try {
        const allTickers = await this.mexcClient.getAllTickerPrices();
        if (Array.isArray(allTickers)) {
          const priceMap = {};
          allTickers.forEach(t => { if (t.symbol && t.price) priceMap[t.symbol.toUpperCase()] = parseFloat(t.price); });
          symbols.forEach(sym => {
            if (priceMap[sym]) prices[sym] = priceMap[sym];
          });
        }
      } catch (bulkErr) {
        // Fallback to single symbol queries
      }
    }

    // Fetch any missing symbols individually with retry
    for (const symbol of symbols) {
      if (prices[symbol] !== undefined) continue;
      try {
        const price = await this.mexcClient.getTickerPrice(symbol);
        prices[symbol] = price;
      } catch (e) {
        this.log(`Error fetching price for ${symbol}: ${e.message}`, 'warning', symbol);
      }
    }

    let changed = false;

    for (const order of activeOrders) {
      const currentPrice = prices[order.symbol] !== undefined ? prices[order.symbol] : order.currentPrice;
      if (currentPrice === undefined || currentPrice === null) continue;

      order.currentPrice = currentPrice;
      changed = true;

      // 1.4 Check activation price if waiting
      if (order.status === 'PENDING_ACTIVATION') {
        // Dynamic Peak Tracking: if autoRepeat is active and price goes up, trail the peak and activationPrice
        if (order.autoRepeat && order.activationOffset) {
          if (!order.peakPrice || currentPrice > order.peakPrice) {
            order.peakPrice = currentPrice;
            order.activationPrice = order.peakPrice * (1 - (order.activationOffset / 100));
            changed = true;
          }
        }

        // Check Standard Dip Activation -> Trails buy
        let shouldActivateDip = false;
        let activationReason = '';

        const isDownDirection = order.activationDirection === 'DOWN' || !order.activationDirection || (order.autoRepeat && order.activationOffset);

        if (isDownDirection && currentPrice <= order.activationPrice) {
          shouldActivateDip = true;
          activationReason = `price ${currentPrice} hit dip activation target ${order.activationPrice.toFixed(4)}`;
        } else if (order.activationDirection === 'UP' && currentPrice >= order.activationPrice) {
          shouldActivateDip = true;
          activationReason = `price ${currentPrice} hit target ${order.activationPrice.toFixed(4)}`;
        }

        if (shouldActivateDip) {
          order.status = 'RUNNING';
          order.activatedAt = new Date().toISOString();
          order.bottomPrice = currentPrice;
          const trailDollar = currentPrice * (order.trailValue / 100);
          order.triggerPrice = currentPrice + trailDollar;
          this.log(
            `Trailing stop buy activated via Dip: ${activationReason}. (Trigger target: >= ${order.triggerPrice.toFixed(4)}).`,
            'success',
            order.symbol
          );
          changed = true;
          continue;
        }

        // Live Heartbeat Tick Log (Every 3 seconds) so user sees live tracking progress in Logs Console
        const now = Date.now();
        if (!order.lastHeartbeatLogTime || (now - order.lastHeartbeatLogTime > 3000)) {
          order.lastHeartbeatLogTime = now;
          const dipOffset = order.activationOffset || 0.6;
          const targetPriceStr = order.activationPrice ? order.activationPrice.toFixed(4) : '-';
          this.log(
            `⚡ [LIVE TICK] ${order.symbol}: Live Price $${currentPrice.toFixed(4)} USDT | Dip Activation Target: $${targetPriceStr} USDT (-${dipOffset}%). Price monitoring active...`,
            'info',
            order.symbol
          );
        }

        continue; // Wait for next tick to monitor trailing stop
      }

      // 1.5 Check TP/SL OCO checks if already bought and holding
      if (order.status === 'TP_SL_ACTIVE') {
        const now = Date.now();
        // Automatic Ghost Order Self-Healing: Verify real MEXC balance for real trades
        if (!order.dryRun) {
          if (!order.lastGhostCheckTime || (now - order.lastGhostCheckTime > 5000)) {
            order.lastGhostCheckTime = now;

            // FIRST: Check if the placed TP Limit Sell order was filled on MEXC!
            if (order.mexcSellOrderId) {
              try {
                const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
                if (queryRes && queryRes.status === 'FILLED') {
                  const tpDollar = (order.takeProfit / 100) * (order.executionPrice || order.initialPrice);
                  order.status = 'TRIGGERED';
                  order.sellExecutionPrice = parseFloat(queryRes.price) || ((order.executionPrice || order.initialPrice) + tpDollar);
                  order.sellTriggeredAt = new Date().toISOString();
                  this.log(`🎉 [REAL] Take Profit hit! Limit Sell order ${order.mexcSellOrderId} filled on MEXC at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
                  changed = true;
                  await this.handleOrderCycleComplete(order);
                  continue;
                }
              } catch (e) {}
            }

            const asset = order.symbol.replace('USDT', '').toUpperCase();
            try {
              const balances = await this.mexcClient.getBalances();
              const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
              const freeBal = assetBal ? (parseFloat(assetBal.free) || 0) : 0;
              const lockedBal = assetBal ? (parseFloat(assetBal.locked) || 0) : 0;
              const totalBal = freeBal + lockedBal;
              const currentPrice = prices[order.symbol] || order.currentPrice || 0;
              const notionalValUsdt = totalBal * currentPrice;

              // Only reset if price is valid (> 0), no sell order is active, locked balance is 0, AND total balance value is genuinely under 10.0 USDT
              if (currentPrice > 0 && notionalValUsdt < 10.0 && !order.mexcSellOrderId && lockedBal === 0) {
                this.log(`🚨 [DUST/GHOST ORDER DETECTED] ${order.symbol} status is TP_SL_ACTIVE but physical MEXC ${asset} balance value is only $${notionalValUsdt.toFixed(2)} USDT (< $10.00 minimum). Resetting card state from TP_SL_ACTIVE to PENDING_ACTIVATION...`, 'warning', order.symbol);
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
        // 50% Take Profit Progress Lock Guard: Lock SL Floor when price reaches 50% of TP target
        if (order.executionPrice && !order.isSlProfitLocked) {
          const gainPct = ((currentPrice - order.executionPrice) / order.executionPrice) * 100;
          const tpTargetPct = (order.takeProfit || 0.6);
          const halfTpPct = tpTargetPct * 0.50; // 50% of Take Profit offset

          if (gainPct >= halfTpPct - 0.000001) {
            order.isSlProfitLocked = true;
            order.justProfitLocked = true;
            
            // Lock SL Floor at 50% TP Gain (or Break-even +0.15% Net Gain minimum)
            const lockedSlPct = Math.max(0.15, halfTpPct * 0.70);
            const lockedSlDollar = (lockedSlPct / 100) * order.executionPrice;
            
            order.lockedSlPrice = order.executionPrice + lockedSlDollar;
            const targetGainPrice = (order.executionPrice * (1 + halfTpPct / 100)).toFixed(4);
            const newSlTarget = order.lockedSlPrice.toFixed(4);
            this.log(
              `🔒 [50% TP PROFIT LOCK GUARD] Price reached 50% TP progress (+${gainPct.toFixed(2)}% gain >= ${targetGainPrice} USDT)! Stop Loss floor locked at Buy Price +${lockedSlPct.toFixed(2)}% ($${newSlTarget} USDT). Risk-Free Profit Locked!`,
              'success',
              order.symbol
            );
            changed = true;
          }
        }



        if (order.dryRun) {
          // Dry Run TP Check
          if (order.takeProfit) {
            const tpDollar = (order.takeProfit / 100) * order.executionPrice;
            if (currentPrice >= (order.executionPrice + tpDollar)) {
              order.status = 'TRIGGERED';
              order.sellExecutionPrice = order.executionPrice + tpDollar;
              order.sellTriggeredAt = new Date().toISOString();
              this.log(`[DRY RUN] Take Profit hit! Simulated Limit Sell executed at ${order.sellExecutionPrice.toFixed(4)} USDT.`, 'success', order.symbol);
              changed = true;
              await this.handleOrderCycleComplete(order);
              continue;
            }
          }
        } else {
          // Live Position Heartbeat Tick Log (Every 3 seconds) so user sees active position progress
          if (!order.lastPosHeartbeatLogTime || (now - order.lastPosHeartbeatLogTime > 3000)) {
            order.lastPosHeartbeatLogTime = now;
            const modeLabel = order.adaptiveSlMode === 'NO_SL' ? '🛡️ NO_SL Mode (Hold for TP)' : `⚠️ SL Active ($${(order.activeSlPrice || 0).toFixed(4)})`;
            const tpTarget = (order.executionPrice || currentPrice) * (1 + ((order.takeProfit || 0.6) / 100));
            this.log(
              `⚡ [LIVE POSITION TICK] ${order.symbol}: Entry $${(order.executionPrice || currentPrice).toFixed(4)} | Live $${currentPrice.toFixed(4)} USDT | TP Target: $${tpTarget.toFixed(4)} USDT | Mode: ${modeLabel}`,
              'info',
              order.symbol
            );
          }

          order.lastStatusCheckTime = now;
          if (order.mexcSellOrderId) {
            try {
              const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
              if (queryRes && queryRes.status === 'FILLED') {
                const tpDollar = (order.takeProfit / 100) * order.executionPrice;
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = parseFloat(queryRes.price) || (order.executionPrice + tpDollar);
                order.sellTriggeredAt = new Date().toISOString();
                this.log(`[REAL] Take Profit hit! Limit Sell filled on MEXC at ${order.sellExecutionPrice} USDT.`, 'success', order.symbol);
                changed = true;
                await this.handleOrderCycleComplete(order);
                continue;
              }
            } catch (e) {
              this.log(`Error querying TP order status from MEXC: ${e.message}`, 'error', order.symbol);
            }
          }
        }

        // Common Stop Loss Target Price calculation (Dry Run & Real Mode)
        const slDollar = (order.stopLoss / 100) * order.executionPrice;
        let targetSlPrice = order.isSlProfitLocked && order.lockedSlPrice
          ? order.lockedSlPrice
          : (order.executionPrice - slDollar);
        
        if (order.filterSmartSl && order.isSlExtended && order.slBuffer) {
          const bufferDollar = (order.slBuffer / 100) * order.executionPrice;
          targetSlPrice -= bufferDollar;
        }

        // 45-Minute Stale Trade Break-even Exit Guard & 15m RSI Bearish Rescue
        if (order.executionPrice && (now - (order.buyTime || 0) >= 45 * 60 * 1000 || !order.lastRsiRescueCheck || now - order.lastRsiRescueCheck > 10000)) {
          order.lastRsiRescueCheck = now;
          try {
            const rsi15mNow = await this.calculate15mRSI(order.symbol);
            const gainPct = ((currentPrice - order.executionPrice) / order.executionPrice) * 100;

            // A) 15m RSI Bearish Rescue Guard: Exit immediately in profit/break-even if 15m RSI drops < 38
            if (gainPct >= 0 && rsi15mNow < 38) {
              this.log(
                `🛡️ [15M RSI BEARISH PROFIT RESCUE] ${order.symbol}: 15m RSI dropped to ${rsi15mNow.toFixed(1)} (< 38 Bearish Zone) while in gain (+${gainPct.toFixed(2)}%)! Executing IMMEDIATE MARKET SELL to rescue profit before crash!`,
                'warning',
                order.symbol
              );
              order.status = 'TRIGGERED';
              order.sellExecutionPrice = currentPrice;
              order.sellTriggeredAt = new Date().toISOString();
              changed = true;
              await this.handleOrderCycleComplete(order);
              continue;
            }

            // B) 45-Minute Stale Trade Break-even Exit Guard
            if (now - (order.buyTime || 0) >= 45 * 60 * 1000 && rsi15mNow < 45) {
              this.log(
                `⏳ [45-MIN STALE TRADE EXIT] ${order.symbol} held 45m without TP & 15m RSI is ${rsi15mNow.toFixed(1)} (< 45 Stagnant). Executing Market Exit at $${currentPrice.toFixed(4)} USDT to free capital!`,
                'warning',
                order.symbol
              );
              order.status = 'TRIGGERED';
              order.sellExecutionPrice = currentPrice;
              order.sellTriggeredAt = new Date().toISOString();
              changed = true;
              await this.handleOrderCycleComplete(order);
              continue;
            }
          } catch (staleErr) {}
        }

        // Check if Stop Loss target is hit (Bypassed if 15m Trend Guard set NO_SL!)
        if (order.justProfitLocked) {
          delete order.justProfitLocked;
        } else if (order.stopLoss && order.adaptiveSlMode !== 'NO_SL' && currentPrice <= targetSlPrice) {
          order.status = 'PENDING_EXECUTION'; // Transition immediately to block duplicate execution!

          // Smart SL Guard seller exhaustion evaluation (ONLY evaluated if Profit Lock was NOT activated!)
          if (order.isSlProfitLocked) {
            this.log(
              `🔒 [PROFIT LOCK EXECUTED] Price dropped back to $${targetSlPrice.toFixed(4)} USDT after >50% TP progress! Executing IMMEDIATE MARKET SELL to lock in profit (Smart SL Extension skipped).`,
              'success',
              order.symbol
            );
          } else if (order.filterSmartSl && !order.isSlExtended && order.slBuffer > 0) {
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
              const bufferDollar = (order.slBuffer / 100) * order.executionPrice;
              const oldSlTarget = targetSlPrice.toFixed(4);
              const newSlTarget = (targetSlPrice - bufferDollar).toFixed(4);
              this.log(
                `🛡️ [SMART SL GUARD] Seller exhaustion confirmed! Bids Support ${bidsRatioPct}% >= 45% (Buyers absorbing dip). Extending Stop Loss by +${order.slBuffer}% buffer (+$${bufferDollar.toFixed(4)} USDT). (Old SL: ${oldSlTarget}, Extended SL: ${newSlTarget}). Market sell DEFERRED, waiting for bounce!`,
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
            await this.handleOrderCycleComplete(order);
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
              const targetMinQty = grossQty * 0.70; // Minimum expected balance after cancellation unlock
              
              // Query exact free balance with retry loop to wait for MEXC balance unlock
              try {
                const asset = order.symbol.replace('USDT', '').toUpperCase();
                let assetBal = null;

                for (let attempt = 1; attempt <= 6; attempt++) {
                  const balances = await this.mexcClient.getBalances();
                  assetBal = balances.find(b => b.asset.toUpperCase() === asset);

                  if (assetBal) {
                    const freeQty = parseFloat(assetBal.free || 0);
                    // Only use free balance if it has ACTUALLY unlocked (>= 70% of grossQty position size)
                    if (freeQty >= targetMinQty) {
                      const safeFree = freeQty * 0.998;
                      const truncated = Math.floor(safeFree * 100000000) / 100000000;
                      if (truncated > 0) {
                        sellQty = truncated;
                        this.log(`[REAL] Stop Loss balance match: free balance ${sellQty} ${asset} unlocked successfully (Attempt ${attempt}/6).`, 'info', order.symbol);
                        break;
                      }
                    }
                  }

                  if (attempt < 6) {
                    this.log(`[REAL] Waiting 2.0s for MEXC balance unlock after TP cancellation (Attempt ${attempt}/6)...`, 'info', order.symbol);
                    await new Promise(r => setTimeout(r, 2000));
                  }
                }
              } catch (balErr) {
                this.log(`[REAL] Stop Loss balance query failed: ${balErr.message}. Falling back to estimated gross quantity ${sellQty}.`, 'warning', order.symbol);
              }

              // IMMEDIATE MARKET SELL FOR STOP LOSS (Protects capital instantly during market crash / SL extension hit)
              let sellResult = null;
              let lastErr = null;

              // Determine exact symbol precision scale (e.g. 100 for XRP/SOL/ONDO/SUI/UNI, 10000 for ETH/SOL/BNB, 100000 for BTC/Gold)
              const precisionMult = this.getSymbolQuantityPrecision(order.symbol, currentPrice);

              for (let attempt = 1; attempt <= 6; attempt++) {
                const qtyToTry = Math.floor(sellQty * precisionMult) / precisionMult;
                if (qtyToTry <= 0) break;

                try {
                  const sellParams = {
                    symbol: order.symbol,
                    side: 'SELL',
                    type: 'MARKET',
                    quantity: qtyToTry
                  };
                  sellResult = await this.mexcClient.placeOrder(sellParams);
                  if (sellResult && sellResult.orderId) {
                    this.log(`🚨 [IMMEDIATE SL MARKET SELL] Stop Loss triggered! Executed MARKET SELL for ${qtyToTry} ${order.symbol} to instantly protect capital (Order ID: ${sellResult.orderId})`, 'warning', order.symbol);
                    break;
                  }
                } catch (err) {
                  lastErr = err;
                  const errMsg = err.message || '';

                  if (errMsg.includes('30002') || errMsg.includes('1USDT') || (qtyToTry * currentPrice) < 1.0) {
                    this.log(`⚠️ [DUST BALANCE MIN 1 USDT SKIPPED] Remaining balance ${qtyToTry} ${order.symbol} ($${(qtyToTry * currentPrice).toFixed(4)} USDT) is below MEXC 1.0 USDT trade limit. Marking cycle complete.`, 'warning', order.symbol);
                    order.status = 'TRIGGERED';
                    order.sellExecutionPrice = currentPrice;
                    order.sellTriggeredAt = new Date().toISOString();
                    changed = true;
                    await this.handleOrderCycleComplete(order);
                    sellResult = { orderId: 'dust_skipped_' + Date.now() };
                    break;
                  }

                  if (errMsg.includes('Oversold') || errMsg.includes('30005')) {
                    // Query fresh unlocked free balance from MEXC
                    let freshFree = 0;
                    try {
                      const balances = await this.mexcClient.getBalances();
                      const asset = order.symbol.replace('USDT', '').toUpperCase();
                      const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
                      freshFree = assetBal ? parseFloat(assetBal.free || 0) : 0;
                      if (freshFree > 0) {
                        sellQty = freshFree * 0.999; // 0.1% safety buffer for fees & precision
                      } else {
                        sellQty = sellQty * 0.995;
                      }
                    } catch (bErr) {
                      sellQty = sellQty * 0.995;
                    }

                    const adjQty = Math.floor(sellQty * precisionMult) / precisionMult;

                    // CRITICAL FIX: If balance is genuinely 0 (already sold/transferred on MEXC), reset peak to current price and complete cycle!
                    if (freshFree === 0 || adjQty <= 0) {
                      this.log(`⚠️ [MANUAL SELL DETECTED] ${order.symbol}: Physical balance is 0 on MEXC (position was manually sold or liquidated). Resetting peak price to current market price ($${currentPrice} USDT) to require fresh dip before re-entry.`, 'warning', order.symbol);
                      order.peakPrice = currentPrice;
                      if (order.activationOffset) {
                        order.activationPrice = currentPrice * (1 - (order.activationOffset / 100));
                      }
                      order.status = 'TRIGGERED';
                      order.sellExecutionPrice = currentPrice;
                      order.sellTriggeredAt = new Date().toISOString();
                      changed = true;
                      await this.handleOrderCycleComplete(order);
                      sellResult = { orderId: 'zero_balance_oversold_' + Date.now() };
                      break;
                    }

                    this.log(`[REAL] Oversold (30005) detected for ${qtyToTry}. Adjusted safe quantity to ${adjQty} ${order.symbol} and retrying (Attempt ${attempt}/6)...`, 'warning', order.symbol);
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                  }

                  if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
                    // Precision scale mismatch fallback: try integer or 2-decimal scale
                    const altMult = precisionMult === 10000 ? 100 : 1;
                    const altQty = Math.floor(sellQty * altMult) / altMult;
                    if (altQty > 0) {
                      try {
                        sellResult = await this.mexcClient.placeOrder({ symbol: order.symbol, side: 'SELL', type: 'MARKET', quantity: altQty });
                        if (sellResult && sellResult.orderId) {
                          this.log(`🚨 [IMMEDIATE SL MARKET SELL] Stop Loss triggered! Executed MARKET SELL for ${altQty} ${order.symbol} with fallback precision (Order ID: ${sellResult.orderId})`, 'warning', order.symbol);
                          break;
                        }
                      } catch (fErr) {}
                    }
                  }
                  throw err;
                }
              }

              if (!sellResult || !sellResult.orderId) {
                throw lastErr || new Error('Failed to place SL Market Sell after precision retries.');
              }

              if (order.status !== 'TRIGGERED' && order.status !== 'PENDING_ACTIVATION') {
                // Fetch actual fill price or use current price (skip for synthetic dust_skipped order IDs)
                let slAvgPrice = currentPrice;
                if (sellResult.orderId && !sellResult.orderId.startsWith('dust_skipped_')) {
                  try {
                    const fills = await this.getActualOrderFills(order.symbol, sellResult.orderId, currentPrice);
                    if (fills && fills.avgPrice) slAvgPrice = fills.avgPrice;
                  } catch (fErr) {}
                }

                order.status = 'TRIGGERED';
                order.sellExecutionPrice = slAvgPrice;
                order.sellTriggeredAt = new Date().toISOString();
                await this.handleOrderCycleComplete(order);
              }
            } catch (e) {
              const errMsg = e.message || '';
              if (errMsg.includes('30002') || errMsg.includes('1USDT') || errMsg.includes('minimum transaction volume')) {
                this.log(`⚠️ [DUST BALANCE MIN 1 USDT SKIPPED] Trade value is below MEXC 1.0 USDT limit (${e.message}). Marking order cycle complete.`, 'warning', order.symbol);
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = currentPrice;
                order.sellTriggeredAt = new Date().toISOString();
                changed = true;
                await this.handleOrderCycleComplete(order);
              } else if ((e.message || '').includes('Oversold') || (e.message || '').includes('30005')) {
                // CRITICAL FIX: Oversold at outer catch = balance is 0. Mark TRIGGERED to break infinite loop!
                this.log(`⚠️ [OVERSOLD OUTER CATCH] ${order.symbol}: Oversold after all retries exhausted. Marking cycle complete to stop infinite retry loop. Error: ${e.message}`, 'warning', order.symbol);
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = currentPrice;
                order.sellTriggeredAt = new Date().toISOString();
                changed = true;
                await this.handleOrderCycleComplete(order);
              } else {
                order.status = 'TP_SL_ACTIVE'; // Revert state for retry on non-Oversold errors
                this.log(`Real SL Market Sell Order Error: ${e.message}`, 'error', order.symbol);
              }
            }
            changed = true;
            continue;
          }
        }
        continue; // Wait for next tick, do not run trailing buy checks
      }

      // Maintain recent price ticks for 2-tick rebound momentum confirmation
      order.recentTicks = order.recentTicks || [];
      order.recentTicks.push(currentPrice);
      if (order.recentTicks.length > 5) order.recentTicks.shift();

      // 1. Check if price bottomed out further
      if (currentPrice < order.bottomPrice) {
        const oldBottom = order.bottomPrice;
        order.bottomPrice = currentPrice;
        const trailDollar = currentPrice * (order.trailValue / 100);
        order.triggerPrice = currentPrice + trailDollar;
        this.log(
          `New bottom detected for ${order.symbol}: ${currentPrice} (was ${oldBottom}). Recalculated trigger to: ${order.triggerPrice.toFixed(4)}`,
          'info',
          order.symbol
        );
      }

      // 2. Check if price went up by the trail value (hits or exceeds trigger price)
      if (currentPrice >= order.triggerPrice) {
        // Solution 3: 2-Tick Micro Rebound Confirmation Filter (Fakeout Protection)
        const tickCount = order.recentTicks.length;
        if (tickCount >= 2) {
          const prevTick = order.recentTicks[tickCount - 2];
          if (currentPrice < prevTick) {
            const now = Date.now();
            if (!order.lastMomentumWaitLogTime || (now - order.lastMomentumWaitLogTime > 4000)) {
              order.lastMomentumWaitLogTime = now;
              this.log(`⏳ [REBOUND CONFIRMATION WAITING] ${order.symbol}: Rebound target reached at ${currentPrice} USDT, but micro-tick is dipping (${currentPrice} < ${prevTick}). Waiting for 2-tick upward confirmation...`, 'info', order.symbol);
            }
            continue;
          }
        }
        // Solution 1: Smart Confluence Consensus Engine
        let obiPassed = false;
        let rsiPassed = false;
        let volPassed = false;
        let takerPassed = false;

        let checkedCount = 0;
        let passedCount = 0;

        const failedReasons = [];
        const confirmedReasons = [];

        // 1. OBI Support Check
        if (order.filterObi) {
          checkedCount++;
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
            if (bidsRatio >= 0.60) {
              obiPassed = true;
              passedCount++;
              confirmedReasons.push(`OBI Support ${pctStr}% >= 60%`);
            } else {
              failedReasons.push(`OBI Support ${pctStr}% < 60%`);
            }
          } catch (e) {
            failedReasons.push(`OBI Query Error`);
          }
        }

        // 2. Volume Spike Check
        if (order.filterVolume) {
          checkedCount++;
          try {
            const klines = await this.mexcClient.getKlines(order.symbol, '1m', 6);
            if (klines && klines.length >= 6) {
              const currentVol = parseFloat(klines[5][5]);
              let totalPrevVol = 0;
              for (let j = 0; j < 5; j++) totalPrevVol += parseFloat(klines[j][5]);
              const avgPrevVol = totalPrevVol / 5;
              if (currentVol >= avgPrevVol * 1.5) {
                volPassed = true;
                passedCount++;
                confirmedReasons.push(`Volume Spike ${currentVol.toFixed(1)} >= 1.5x avg`);
              } else {
                failedReasons.push(`Volume Spike ${currentVol.toFixed(1)} < 1.5x avg`);
              }
            } else {
              failedReasons.push(`Insufficient Volume Data`);
            }
          } catch (e) {
            failedReasons.push(`Volume Query Error`);
          }
        }

        // 3. RSI Oversold Check
        if (order.filterRsi) {
          checkedCount++;
          try {
            const klines = await this.mexcClient.getKlines(order.symbol, '1m', 30);
            if (klines && klines.length >= 15) {
              const closes = klines.map(k => parseFloat(k[4]));
              const rsi = this.calculateRSI(closes);
              if (rsi <= 35) {
                rsiPassed = true;
                passedCount++;
                confirmedReasons.push(`RSI ${rsi.toFixed(1)} <= 35`);
              } else {
                failedReasons.push(`RSI ${rsi.toFixed(1)} > 35`);
              }
            } else {
              failedReasons.push(`Insufficient RSI Data`);
            }
          } catch (e) {
            failedReasons.push(`RSI Calc Error`);
          }
        }

        // 4. 40s Buyer Volume Check
        if (order.filter40sVolume) {
          checkedCount++;
          try {
            const delta = await this.calculateTakerVolumeDelta(order.symbol, 40000);
            const valStr = delta.takerBuyPct.toFixed(1);
            if (delta.takerBuyPct >= 60.0) {
              takerPassed = true;
              passedCount++;
              confirmedReasons.push(`40s Buyer Volume ${valStr}% >= 60%`);
            } else {
              failedReasons.push(`40s Buyer Volume ${valStr}% < 60%`);
            }
          } catch (vErr) {
            failedReasons.push(`40s Buyer Volume Error`);
          }
        }

        // Dynamic Pass Threshold Evaluation
        let passedFilters = false;
        const isStrict = order.consensusMode === 'STRICT_ALL';

        if (isStrict) {
          passedFilters = (checkedCount === 0) || (passedCount === checkedCount);
        } else {
          // Default: SMART_CONFLUENCE Mode (3/4, 2/3, 2/2, 1/1)
          if (checkedCount === 4) {
            passedFilters = (passedCount >= 3) || (rsiPassed && obiPassed);
          } else if (checkedCount === 3) {
            passedFilters = (passedCount >= 2);
          } else if (checkedCount === 2) {
            passedFilters = (passedCount >= 2);
          } else if (checkedCount === 1) {
            passedFilters = (passedCount >= 1);
          } else {
            passedFilters = true; // No checkboxes checked -> default pass
          }
        }

        if (!passedFilters) {
          // Throttling waiting logs to once every 4 seconds per order symbol
          const now = Date.now();
          if (!order.lastFilterFailLogTime || (now - order.lastFilterFailLogTime > 4000)) {
            order.lastFilterFailLogTime = now;
            const confirmedStr = confirmedReasons.length > 0 ? ` (Passed so far: ${confirmedReasons.join(' | ')})` : '';
            const reqStr = isStrict ? `${checkedCount}/${checkedCount} Strict` : (checkedCount === 4 ? `3/4 Confluence` : `${Math.max(1, checkedCount - 1)}/${checkedCount} Confluence`);
            this.log(`⏳ [BUY DEFERRED — WAITING FOR SIGNALS] ${order.symbol}: Rebound target reached at ${currentPrice} USDT, but waiting for consensus (${passedCount}/${checkedCount} passed, Need ${reqStr}). Pending/Failed: ${failedReasons.join(' | ')}.${confirmedStr}. Continuous trailing loop active...`, 'info', order.symbol);
          }
          continue;
        }

        // 🔒 PER-SYMBOL SINGLE ACTIVE POSITION GUARD: Block duplicate buys for the SAME coin while its position is active!
        const existingPosition = this.orders.find(o => o.symbol === order.symbol && o.id !== order.id && (o.status === 'TP_SL_ACTIVE' || o.status === 'PENDING_EXECUTION'));
        if (existingPosition) {
          const now = Date.now();
          if (!order.lastPosGuardLogTime || (now - order.lastPosGuardLogTime > 10000)) {
            order.lastPosGuardLogTime = now;
            this.log(`🔒 [POSITION GUARD LOCKED] Active position already open for ${order.symbol} (${existingPosition.id}). New buy blocked until ${order.symbol} active trade completes TP/SL!`, 'warning', order.symbol);
          }
          continue;
        }

        // 🛑 REAL SPOT WALLET HOLDING GUARD: Query live MEXC spot balance before sending any Market Buy request!
        if (!order.dryRun) {
          try {
            const balances = await this.mexcClient.getBalances();
            const asset = order.symbol.replace('USDT', '').toUpperCase();
            const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
            if (assetBal) {
              const totalQty = (parseFloat(assetBal.free || 0) + parseFloat(assetBal.locked || 0));
              const notionalUsdt = totalQty * currentPrice;
              if (notionalUsdt >= 10.0) {
                this.log(`🔒 [REAL WALLET HOLDING GUARD] Physical wallet balance for ${order.symbol} is $${notionalUsdt.toFixed(2)} USDT (>= $10.00 minimum). Market Buy CANCELLED to prevent duplicate buy! Card state transitioned to TP/SL monitoring!`, 'warning', order.symbol);
                order.status = 'TP_SL_ACTIVE';
                order.executionPrice = currentPrice;
                this.saveOrders();
                continue;
              }
            }
          } catch (wErr) {}
        }

        order.triggeredAt = new Date().toISOString();
        const mode = order.dryRun ? '[DRY RUN]' : '[REAL]';
        const indicatorLog = confirmedReasons.length > 0 ? ` (Exact Confirmed Metrics: ${confirmedReasons.join(' | ')})` : '';
        this.log(`🎯 [ENTRY CONFIRMED] Trailing buy triggered at ${currentPrice} USDT! All enabled indicators aligned 100%!${indicatorLog}. Executing ${mode} Market Buy...`, 'success', order.symbol);

        if (order.dryRun) {
          order.executionPrice = currentPrice;
          if (order.takeProfit || order.stopLoss) {
            order.status = 'TP_SL_ACTIVE';
            await this.apply15mTrendGuard(order);
            this.log(`[DRY RUN] Simulated Spot Buy order executed at ${currentPrice} USDT. Transitioning to TP/SL monitoring.`, 'success', order.symbol);
          } else {
            order.status = 'TRIGGERED';
            this.log(`[DRY RUN] Simulated Spot Buy order executed at ${currentPrice} USDT.`, 'success', order.symbol);
          }
        } else {
          try {
            order.status = 'PENDING_EXECUTION'; // intermediate state
            this.log(`🚀 [IMMEDIATE MARKET BUY] Trailing dip trigger + Consensus indicators ALIGNED! Sending instant MARKET BUY order to MEXC server for ${order.symbol}...`, 'success', order.symbol);
            
            let result = null;
            let lastBuyErr = null;
            const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000];
            let buyQty = null;

            if (order.quantity) {
              for (const mult of decimalsToTry) {
                const qtyToTry = Math.floor(order.quantity * mult) / mult;
                if (qtyToTry <= 0) continue;
                try {
                  const orderParams = { symbol: order.symbol, side: 'BUY', type: 'MARKET', quantity: qtyToTry };
                  this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(orderParams)}`, 'info', order.symbol);
                  result = await this.mexcClient.placeOrder(orderParams);
                  this.log(`[MEXC API RESPONSE] Order Placed Success -> ${JSON.stringify(result)}`, 'success', order.symbol);
                  if (result && result.orderId) { buyQty = qtyToTry; break; }
                } catch (err) {
                  lastBuyErr = err;
                  if ((err.message || '').includes('quantity scale')) continue;
                  throw err;
                }
              }
            } else if (order.quoteOrderQty) {
              try {
                const orderParams = { symbol: order.symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: order.quoteOrderQty };
                this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(orderParams)}`, 'info', order.symbol);
                result = await this.mexcClient.placeOrder(orderParams);
                this.log(`[MEXC API RESPONSE] Order Placed Success -> ${JSON.stringify(result)}`, 'success', order.symbol);
              } catch (err) { lastBuyErr = err; }
            }

            if (!result || !result.orderId) {
              throw lastBuyErr || new Error('Failed to place MARKET buy order on MEXC.');
            }

            order.mexcOrderId = result.orderId;
            
            // Query fill price
            let execPrice = currentPrice;
            try {
              this.log(`[MEXC API REQUEST] GET /api/v3/order -> Symbol: ${order.symbol}, OrderID: ${result.orderId}`, 'info', order.symbol);
              const fills = await this.mexcClient.getOrder(order.symbol, result.orderId);
              this.log(`[MEXC API RESPONSE] Query Fills Success -> ${JSON.stringify(fills)}`, 'success', order.symbol);
              if (fills && parseFloat(fills.executedQty) > 0) {
                const cumQuote = parseFloat(fills.cummulativeQuoteQty || 0);
                const execQty  = parseFloat(fills.executedQty || 1);
                if (cumQuote > 0) execPrice = cumQuote / execQty;
              }
            } catch(e) {}

            order.executionPrice = execPrice;
            this.log(`✅ [MARKET BUY FILLED] Order ${result.orderId} executed at ${execPrice} USDT! Transitioning to TP/SL monitoring.`, 'success', order.symbol);

            if (order.takeProfit || order.stopLoss) {
              order.status = 'TP_SL_ACTIVE';
              await this.apply15mTrendGuard(order);
              this.log(
                `[REAL] BUY Order placed successfully! Order ID: ${result.orderId}. Exec Price: ${execPrice}. Transitioning to TP/SL monitoring.`,
                'success',
                order.symbol
              );

              // If Take Profit is configured, place a real LIMIT SELL order on MEXC now!
              if (order.takeProfit) {
                try {
                  const tpDollar = (order.takeProfit / 100) * execPrice;
                  const tpPrice = execPrice + tpDollar;
                  const grossQty = order.quantity || (order.quoteOrderQty / execPrice);
                  
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
                      this.log(`[MEXC API REQUEST] POST /api/v3/order -> ${JSON.stringify(tpParams)}`, 'info', order.symbol);
                      tpResult = await this.mexcClient.placeOrder(tpParams);
                      this.log(`[MEXC API RESPONSE] TP Order Placed Success -> ${JSON.stringify(tpResult)}`, 'success', order.symbol);
                      if (tpResult && tpResult.orderId) {
                        order.mexcSellOrderId = tpResult.orderId;
                        this.log(`🎯 [REAL TP LIMIT SELL PLACED] Placed Limit Sell for ${qtyToTry} ${order.symbol} @ $${tpPrice.toFixed(4)} USDT (+${order.takeProfit}% TP Target)! (MEXC Order ID: ${tpResult.orderId})`, 'success', order.symbol);
                        break;
                      }
                    } catch (err) {
                      lastTpErr = err;
                      const errMsg = err.message || '';
                      if (errMsg.includes('Oversold') || errMsg.includes('30005')) {
                        this.log(`[REAL] Oversold (30005) detected on TP Limit Sell for ${order.symbol}. Retrying with 0.5% reduced quantity...`, 'warning', order.symbol);
                        const retryQty = Math.floor(qtyToTry * 0.995 * mult) / mult;
                        if (retryQty > 0) {
                          try {
                            const retryParams = { symbol: order.symbol, side: 'SELL', type: 'LIMIT', quantity: retryQty, price: tpPrice };
                            this.log(`[MEXC API REQUEST] POST /api/v3/order (RETRY) -> ${JSON.stringify(retryParams)}`, 'info', order.symbol);
                            tpResult = await this.mexcClient.placeOrder(retryParams);
                            if (tpResult && tpResult.orderId) {
                              order.mexcSellOrderId = tpResult.orderId;
                              this.log(`🎯 [REAL TP LIMIT SELL PLACED] Placed Limit Sell for ${retryQty} ${order.symbol} @ $${tpPrice.toFixed(4)} USDT (+${order.takeProfit}% TP Target)! (MEXC Order ID: ${tpResult.orderId})`, 'success', order.symbol);
                              break;
                            }
                          } catch (rErr) {}
                        }
                        continue;
                      }
                      if (errMsg.includes('quantity scale') || errMsg.includes('400') || errMsg.includes('code":400')) {
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
              await this.handleOrderCycleComplete(order);
            }
          } catch (err) {
            order.status = 'FAILED';
            order.error = err.message;
            this.log(`❌ [MEXC API ERROR] Immediate Market Buy order failed: ${err.message}`, 'error', order.symbol);
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
    // Guard: only run if this order is set for auto-repeat
    if (!order.autoRepeat) {
      return;
    }

    const cycleNum = (order.tradeHistory ? order.tradeHistory.length : 0) + 1;
    const buyPrice = order.executionPrice || 0;
    const sellPrice = order.sellExecutionPrice || order.currentPrice || 0;
    const qty = order.quantity || (order.quoteOrderQty && buyPrice > 0 ? (order.quoteOrderQty / buyPrice) : 1);

    // Determine trade type (Take Profit vs Profit Lock vs Stop Loss)
    let type = 'MANUAL_SELL';
    const profitPct = buyPrice > 0 ? ((sellPrice - buyPrice) / buyPrice * 100) : 0;
    if (order.takeProfit && profitPct >= (order.takeProfit - 0.05)) {
      type = 'TAKE_PROFIT';
    } else if (order.isSlProfitLocked) {
      type = 'PROFIT_LOCK_SELL';
    } else if (sellPrice < buyPrice) {
      type = 'STOP_LOSS';
    }

    // Account Specific Fee Rates (0.0% Taker promotion & 0.0% Maker promotion on MEXC)
    let accountFees = { makerCommission: 0.0000, takerCommission: 0.0000 };
    try {
      if (this.mexcClient && typeof this.mexcClient.getTradeFee === 'function') {
        const fetchedFees = await this.mexcClient.getTradeFee(order.symbol);
        if (fetchedFees) accountFees = fetchedFees;
      }
    } catch (fErr) {
      // Fallback default for user's account
    }

    const isBuyMaker = true; // Bot always places LIMIT (Maker) buys → 0% fee on user's MEXC account
    const isSellMaker = (type === 'TAKE_PROFIT'); // TP is LIMIT sell (Maker), SL is Taker (0% on MEXC)

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
      grossProfitUsdt: parseFloat((grossSellValue - grossBuyValue).toFixed(6)),
      mexcBuyFeeUsdt: parseFloat(buyFeeUsdt.toFixed(6)),
      mexcSellFeeUsdt: parseFloat(sellFeeUsdt.toFixed(6)),
      totalMexcFeesUsdt: parseFloat((buyFeeUsdt + sellFeeUsdt).toFixed(6)),
      profit: parseFloat(netUnitProfit.toFixed(8)),
      profitUsdt: parseFloat(cycleUsdtProfit.toFixed(6)),
      type,
      timestamp: new Date().toISOString()
    };

    if (!order.tradeHistory) order.tradeHistory = [];
    order.tradeHistory.push(tradeRecord);

    // Reset to pending activation for next cycle (REQUIRE FRESH HIGH PEAK AFTER SELL)
    order.status = 'PENDING_ACTIVATION';
    order.peakPrice = sellPrice;
    const offsetPct = order.activationOffset || 0.6;
    order.activationPrice = sellPrice * (1 - (offsetPct / 100));
    order.activationDirection = 'DOWN';
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
      `Cycle #${cycleNum} completed (${type}). Profit: ${cycleUsdtProfit.toFixed(4)} USDT. Fees: ${(buyFeeUsdt + sellFeeUsdt).toFixed(4)} USDT. Resetting to PENDING_ACTIVATION. New peak: ${order.peakPrice}`,
      'success',
      order.symbol
    );
    this.saveOrders();

    // Push live fee update to frontend in background (non-blocking)
    if (!order.dryRun) {
      this.emitFeesUpdate();
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

  // Determine exact symbol quantity precision scale based on asset price and symbol
  getSymbolQuantityPrecision(symbol, currentPrice = 0) {
    const sym = (symbol || '').toUpperCase();
    const price = currentPrice || 0;

    if (price >= 10000 || sym.includes('BTC') || sym.includes('WBTC') || sym.includes('SBTC')) {
      return 1000000; // 6 decimal places for $10,000+ assets (BTC, WBTC, SBTC) -> $0.01 remainder!
    }
    if (price >= 1000 || sym.includes('XAUT') || sym.includes('GOLD') || sym.includes('PAXG') || sym.includes('YFI')) {
      return 100000; // 5 decimal places for $1000+ assets (Gold XAUT/PAXG, YFI)
    }
    if (price >= 10.0 || sym.includes('ETH') || sym.includes('TAO') || sym.includes('BNB') || sym.includes('SOL') || sym.includes('MKR') || sym.includes('AAVE') || sym.includes('LTC') || sym.includes('QNT')) {
      return 10000; // 4 decimal places for $10+ assets (ETH, SOL, TAO, BNB, LTC, QNT)
    }
    if (price >= 0.01) {
      return 100; // 2 decimal places for $0.01 to $10 assets (SUI, XRP, ONDO, UNI, NEAR, DOGE)
    }
    return 1; // 0 decimal places (whole integers) for micro-penny tokens (< $0.01 like PEPE, SHIB, BONK)
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
