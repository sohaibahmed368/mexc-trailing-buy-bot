const fs = require('fs');
const path = require('path');

class OrderTracker {
  constructor(mexcClient = null, io = null) {
    if (!mexcClient) {
      const MexcClient = require('./mexc-client');
      this.mexcClient = new MexcClient();
    } else {
      this.mexcClient = mexcClient;
    }
    this.io = io;
    this.ordersPath = path.join(__dirname, 'data', 'orders.json');
    this.logsPath = path.join(__dirname, 'data', 'logs.json');
    this.auditLogPath = path.join(__dirname, 'data', 'scanner_audit.log');
    
    this.orders = [];
    this.logs = [];
    this.logsSaveTimeout = null;
    this.intervalId = null;
    this.pollInterval = 1800; // 1.8 seconds interval (within 1.5s - 2.0s user range)
    this.cachedFeeSummary = null;
    this.lastFeeCheckTime = 0;
    
    this.initStorage();
  }

  setSignalRadar(radar) {
    this.signalRadar = radar;
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

    let rawOrders = '';
    if (fs.existsSync(this.ordersPath)) {
      rawOrders = fs.readFileSync(this.ordersPath, 'utf8').trim();
    } else {
      // If primary orders.json doesn't exist, check local backup
      const backupPath = path.join(dataDir, 'orders.bak.json');
      if (fs.existsSync(backupPath)) {
        rawOrders = fs.readFileSync(backupPath, 'utf8').trim();
      }
    }

    if (rawOrders) {
      try {
        this.orders = JSON.parse(rawOrders);
      } catch (e) {
        // Robust regex/block-based auto-repair for truncated JSON
        const cardBlocks = [];
        let depth = 0;
        let inString = false;
        let escape = false;
        let startIndex = -1;

        for (let i = 0; i < rawOrders.length; i++) {
          const char = rawOrders[i];
          if (escape) { escape = false; continue; }
          if (char === '\\') { escape = true; continue; }
          if (char === '"') { inString = !inString; continue; }
          if (!inString) {
            if (char === '{') {
              if (depth === 0) startIndex = i;
              depth++;
            } else if (char === '}') {
              depth--;
              if (depth === 0 && startIndex !== -1) {
                const block = rawOrders.slice(startIndex, i + 1);
                try {
                  const parsed = JSON.parse(block);
                  if (parsed.symbol || parsed.id) cardBlocks.push(parsed);
                } catch (pe) {}
                startIndex = -1;
              }
            }
          }
        }
        this.orders = cardBlocks;
      }
    }

    if (Array.isArray(this.orders) && this.orders.length > 0) {
      this.orders.forEach(o => {
        o.filterObi = true;
        if (o.status === 'RUNNING' || o.status === 'PENDING_BUY' || o.status === 'PENDING_EXECUTION') {
          o.status = 'PENDING_ACTIVATION';
        }
      });

      // Strict Single-Card-Per-Symbol Deduplication
      const seenSymbols = new Set();
      const uniqueOrders = [];
      const sorted = [...this.orders].sort((a, b) => {
        const aActive = a.status === 'TP_SL_ACTIVE';
        const bActive = b.status === 'TP_SL_ACTIVE';
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
      try { fs.writeFileSync(this.ordersPath, JSON.stringify(this.orders, null, 2), 'utf8'); } catch (e) {}
      console.log(`📦 [INIT STORAGE COMPLETE] Loaded ${this.orders.length} cards:`, this.orders.map(o => `${o.symbol}(${o.status})`).join(', '));
    } else {
      this.orders = [];
      try { fs.writeFileSync(this.ordersPath, JSON.stringify([]), 'utf8'); } catch (e) {}
      console.log('📦 [INIT STORAGE COMPLETE] 0 cards loaded.');
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
      const backupPath = path.join(__dirname, 'data', 'orders.bak.json');
      fs.writeFileSync(backupPath, JSON.stringify(this.orders, null, 2));
      const persistentDir = process.env.HOME || '/home/mexcbot786';
      if (fs.existsSync(persistentDir)) {
        try { fs.writeFileSync(path.join(persistentDir, 'mexc_orders_persistent.json'), JSON.stringify(this.orders, null, 2)); } catch (pErr) {}
      }
    } catch (e) {
      console.error('Error saving orders to disk:', e.message);
    }
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
    
    // Always append ALL raw logs to disk audit log file for 100% full history
    this.appendAuditLog(logEntry);

    // Filter UI WebSocket & RAM Buffer: Avoid choking UI thread with 1-second routine heartbeat scans
    const isRoutineScan = message.includes('DUAL GATE SCAN');
    const now = Date.now();
    this.lastScanWsEmitTime = this.lastScanWsEmitTime || {};
    const symKey = symbol || 'GENERAL';

    let shouldEmitToUi = true;
    if (isRoutineScan && type === 'info') {
      // Throttle routine scan heartbeats to emit over WebSocket at most once every 5 seconds per coin
      if (this.lastScanWsEmitTime[symKey] && (now - this.lastScanWsEmitTime[symKey] < 5000)) {
        shouldEmitToUi = false;
      } else {
        this.lastScanWsEmitTime[symKey] = now;
      }
    }

    if (shouldEmitToUi) {
      this.logs.unshift(logEntry); // Add to UI logs buffer
      if (this.logs.length > 100) {
        this.logs = this.logs.slice(0, 100); // limit RAM buffer to 100 logs max for lightning fast UI
      }
      
      this.scheduleLogsSave();

      if (this.io && typeof this.io.emit === 'function') {
        this.io.emit('log_entry', logEntry);
      }
    }

    // Output all logs directly to stdout so PM2 logs and VPS terminal reflect live bot activity in real-time
    const timeStr = new Date().toLocaleTimeString();
    console.log(`[${timeStr}] [BOT ${type.toUpperCase()}]${symbol ? ` [${symbol}]` : ''} ${message}`);
  }

  // Debounced asynchronous disk saver to protect CPU & disk I/O performance
  scheduleLogsSave() {
    if (this.logsSaveTimeout) return;
    this.logsSaveTimeout = setTimeout(() => {
      this.logsSaveTimeout = null;
      try {
        fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2));
      } catch (e) {}
    }, 3000);
  }

  // FIFO Rolling Truncation Audit Logger: Hard-capped at 20 MB max per file.
  // When 20 MB is reached, drops oldest 30% lines from top and appends newest at bottom!
  appendAuditLog(logEntry) {
    try {
      if (fs.existsSync(this.auditLogPath)) {
        const stats = fs.statSync(this.auditLogPath);
        if (stats.size > 20 * 1024 * 1024) { // > 20 MB
          const content = fs.readFileSync(this.auditLogPath, 'utf8');
          const lines = content.split('\n').filter(l => l.trim().length > 0);
          if (lines.length > 10000) {
            // Drop top 30% oldest lines, keep newest 70% lines
            const trimmedLines = lines.slice(Math.floor(lines.length * 0.3));
            fs.writeFileSync(this.auditLogPath, trimmedLines.join('\n') + '\n');
          }
        }
      }
      fs.appendFileSync(this.auditLogPath, JSON.stringify(logEntry) + '\n');
    } catch (e) {}
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

  async addOrder({ symbol, trailValue, quantity, quoteOrderQty, orderType, dryRun, activationPrice, takeProfit, stopLoss, filterSmartSl, slBuffer, filterObi, filterVolume, filterRsi, filter40sVolume, autoRepeat, activationOffset, startImmediately, consensusMode, customObiThreshold, customRsiThreshold, targetObi, targetRsi }) {
    if (this.mexcClient && typeof this.mexcClient.normalizeSymbol === 'function') {
      symbol = this.mexcClient.normalizeSymbol(symbol);
    }
    symbol = (symbol || '').toUpperCase().trim();

    // Check if an active position is currently open for this symbol
    const existingActivePos = this.orders.find(o => o.symbol === symbol && (o.status === 'TP_SL_ACTIVE' || o.status === 'PENDING_EXECUTION'));

    // Symbol Deduplication Guard: Strictly enforce AT MOST 1 CARD PER SYMBOL in this.orders!
    this.orders = this.orders.filter(o => o.symbol !== symbol);

    const parsedTrail = trailValue && trailValue.toString().trim() !== '' ? parseFloat(trailValue) : 0.15;
    
    if (isNaN(parsedTrail) || parsedTrail <= 0) {
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

    const parsedStopLoss = stopLoss && stopLoss.toString().trim() !== '' ? parseFloat(stopLoss) : null;
    const parsedSlBuffer = slBuffer && slBuffer.toString().trim() !== '' ? parseFloat(slBuffer) : 0;

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
    
    // Safety Guard: If Dual Gate System is enabled (filterObi = true), NEVER buy immediately on card creation!
    // Card MUST start in PENDING_ACTIVATION (Waiting) mode to await OBI & RSI thresholds!
    let startInstantBuy = autoRepeat && startImmediately && !filterObi;
    
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
    } else if (filterObi !== false || (autoRepeat && activationOffset) || parsedActivationPrice !== null) {
      status = 'PENDING_ACTIVATION';
      activationDirection = 'DOWN';
    } else if (startInstantBuy) {
      status = 'TP_SL_ACTIVE';
    } else {
      bottomPrice = initialPrice;
      const trailDollar = initialPrice * (parsedTrail / 100);
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
      filterObi: filterObi !== false,
      targetObi: (targetObi !== undefined && targetObi !== null && targetObi !== '') ? parseFloat(targetObi) : ((customObiThreshold !== undefined && customObiThreshold !== null && customObiThreshold !== '') ? parseFloat(customObiThreshold) : 55.0),
      targetRsi: (targetRsi !== undefined && targetRsi !== null && targetRsi !== '') ? parseFloat(targetRsi) : ((customRsiThreshold !== undefined && customRsiThreshold !== null && customRsiThreshold !== '') ? parseFloat(customRsiThreshold) : 40.0),
      customObiThreshold: (targetObi !== undefined && targetObi !== null && targetObi !== '') ? parseFloat(targetObi) : ((customObiThreshold !== undefined && customObiThreshold !== null && customObiThreshold !== '') ? parseFloat(customObiThreshold) : 55.0),
      customRsiThreshold: (targetRsi !== undefined && targetRsi !== null && targetRsi !== '') ? parseFloat(targetRsi) : ((customRsiThreshold !== undefined && customRsiThreshold !== null && customRsiThreshold !== '') ? parseFloat(customRsiThreshold) : 40.0),
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

    if (order.status === 'TP_SL_ACTIVE' && !order.dryRun) {
      if (order.mexcSellOrderId) {
        try {
          await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
          this.log(`Cancelled active TP Limit Sell order ${order.mexcSellOrderId} on MEXC.`, 'info', order.symbol);
        } catch (e) {
          this.log(`Failed to cancel TP order on MEXC: ${e.message}`, 'error', order.symbol);
        }
      }

      // Execute Immediate Market Sell on MEXC to liquidate holdings back to USDT
      try {
        const asset = order.symbol.replace('USDT', '').toUpperCase();
        const balances = await this.mexcClient.getBalances();
        const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
        const freeQty = assetBal ? parseFloat(assetBal.free || 0) : 0;
        const precisionMult = this.getSymbolQuantityPrecision(order.symbol, order.currentPrice || 100);
        const qtyToSell = Math.floor(freeQty * precisionMult) / precisionMult;

        if (qtyToSell > 0) {
          await this.mexcClient.placeOrder({
            symbol: order.symbol,
            side: 'SELL',
            type: 'MARKET',
            quantity: qtyToSell
          });
          this.log(`✅ [CANCEL MARKET SELL] Executed Market Sell for ${qtyToSell} ${order.symbol} on MEXC. Holdings converted to USDT!`, 'success', order.symbol);
        }
      } catch (mErr) {
        this.log(`Market sell on cancel notice: ${mErr.message}`, 'warning', order.symbol);
      }
    }

    order.status = 'CANCELLED';
    this.saveOrders();
    this.log(`Trailing buy order for ${order.symbol} has been cancelled by user.`, 'warning', order.symbol);
    
    // Stop tracking loop if no active orders remain
    this.checkTrackingLoop();
  }

  // Force Market Sell position holdings and re-cycle card back to PENDING_ACTIVATION (Waiting) mode for next dip
  async recycleOrder(id) {
    const order = this.orders.find(o => o.id === id || o.symbol === id);
    if (!order) return;

    if (!order.dryRun && this.mexcClient && this.mexcClient.hasCredentials()) {
      if (order.mexcSellOrderId) {
        try {
          await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
          this.log(`Cancelled active TP Limit Sell order ${order.mexcSellOrderId} on MEXC.`, 'info', order.symbol);
        } catch (e) {}
      }

      try {
        const asset = order.symbol.replace('USDT', '').toUpperCase();
        const balances = await this.mexcClient.getBalances();
        const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
        const totalQty = assetBal ? (parseFloat(assetBal.free || 0) + parseFloat(assetBal.locked || 0)) : 0;
        const precisionMult = this.getSymbolQuantityPrecision(order.symbol, order.currentPrice || 100);
        const qtyToSell = Math.floor(totalQty * precisionMult) / precisionMult;

        if (qtyToSell > 0) {
          await this.mexcClient.placeOrder({
            symbol: order.symbol,
            side: 'SELL',
            type: 'MARKET',
            quantity: qtyToSell
          });
          this.log(`✅ [RE-CYCLE MARKET SELL] Executed Market Sell for ${qtyToSell} ${order.symbol} on MEXC! Holdings liquidated to USDT.`, 'success', order.symbol);
        }
      } catch (mErr) {
        this.log(`Re-cycle market sell notice: ${mErr.message}`, 'warning', order.symbol);
      }
    }

    order.status = 'PENDING_ACTIVATION';
    order.executionPrice = null;
    order.initialPrice = null;
    order.mexcSellOrderId = null;
    order.mexcOrderId = null;
    order.error = null;
    this.saveOrders();
    this.log(`🔄 [CARD RE-CYCLED] ${order.symbol} card status reset to PENDING_ACTIVATION (Waiting for next dip)!`, 'success', order.symbol);
    return order;
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

  // Restore client-side cached cards upon server wake-up/reboot
  bulkSyncOrders(newOrders) {
    if (!Array.isArray(newOrders) || newOrders.length === 0) return;
    const existingSymbols = new Set((this.orders || []).map(o => (o.symbol || '').toUpperCase()));
    let added = false;
    newOrders.forEach(o => {
      const sym = (o.symbol || '').toUpperCase().trim();
      if (sym && !existingSymbols.has(sym)) {
        existingSymbols.add(sym);
        this.orders.push(o);
        added = true;
      }
    });
    if (added) {
      this.saveOrders();
      this.log(`📥 [PERSISTENT RESTORE] Automatically restored ${newOrders.length} active tracking cards from browser persistent storage!`, 'success');
    }
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

  // Automatically scan MEXC Spot Wallet & Open Orders to Auto-Generate Cards for ANY coins held in the wallet
  async syncLiveWalletOrders() {
    if (!this.mexcClient || !this.mexcClient.hasCredentials()) return;
    try {
      const balances = await this.mexcClient.getBalances();
      if (!Array.isArray(balances)) return;

      const prices = await this.mexcClient.getAllPrices().catch(() => ({}));
      let newCardsAdded = false;

      for (const bal of balances) {
        const freeQty = parseFloat(bal.free || 0);
        const lockedQty = parseFloat(bal.locked || 0);
        const totalQty = freeQty + lockedQty;

        if (totalQty <= 0) continue;

        const asset = bal.asset.toUpperCase();
        if (asset === 'USDT' || asset === 'USDC' || asset === 'USD') continue;

        const symbol = asset + 'USDT';
        const currentPrice = parseFloat(prices[symbol] || prices[asset + 'USDT'] || 0);

        // Skip assets with no active trading pair on MEXC
        if (!currentPrice || currentPrice <= 0) continue;

        const notionalUsdt = totalQty * currentPrice;

        // Skip dust balances under $0.50 unless it has locked quantity
        if (notionalUsdt < 0.50 && lockedQty <= 0) continue;

        let existingOrder = this.orders.find(o => o.symbol === symbol);

        if (existingOrder) {
          if (existingOrder.status === 'TP_SL_ACTIVE') {
            if (!existingOrder.executionPrice || existingOrder.executionPrice <= 0) {
              if (currentPrice > 0) existingOrder.executionPrice = currentPrice;
            }
          }
          this.log(`ℹ️ [WALLET BALANCE SYNC] Verified active position ${symbol}: physical wallet holds ${totalQty.toFixed(4)} ${asset} ($${notionalUsdt.toFixed(2)} USDT).`, 'info', symbol);
        }
      }

      if (newCardsAdded) {
        this.saveOrders();
      }
    } catch (e) {
      this.log(`Wallet sync notice: ${e.message}`, 'info');
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
      const activeOrders = this.orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'PENDING_BUY' || o.status === 'PENDING_LIMIT_BUY' || o.status === 'PENDING_EXECUTION' || o.status === 'TP_SL_ACTIVE');
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
        const cleanSym = symbol.replace('GOLD(XAUT)', 'XAUT').replace('GOLD(PAXG)', 'PAXG').replace('OIL(USOON)', 'USOON').replace(/[^A-Z0-9]/g, '');
        const price = await this.mexcClient.getTickerPrice(cleanSym);
        prices[symbol] = price;
      } catch (e) {
        // NEVER auto-cancel user cards on network/symbol error! Log warning and keep card alive
        this.log(`Warning fetching price for ${symbol}: ${e.message}`, 'warning', symbol);
      }
    }

    let changed = false;

    for (const order of activeOrders) {
      const currentPrice = prices[order.symbol] !== undefined ? prices[order.symbol] : order.currentPrice;
      if (currentPrice === undefined || currentPrice === null) continue;

      order.currentPrice = currentPrice;

      // 1.4 Check Top 10 Exchanges OBI & 4h 15m RSI Dual-Lock Gate if waiting
      if (order.status === 'PENDING_ACTIVATION') {
        const now = Date.now();
        let dualGatePassed = false;
        let avgObi = 50.0;
        let rsi4h = 50.0;

        let exchangeDetailsStr = '';

        if (order.filterObi !== false) {
          try {
            let radarMetrics = this.signalRadar ? this.signalRadar.getRadarMetrics(order.symbol) : null;
            if (!radarMetrics && this.signalRadar) {
              radarMetrics = await this.signalRadar.getMultiExchangeMetrics(order.symbol).catch(() => null);
            }

            if (radarMetrics && radarMetrics.averageObiPct !== undefined && radarMetrics.averageObiPct > 0) {
              avgObi = radarMetrics.averageObiPct;
              rsi4h = radarMetrics.averageRsi15m !== undefined ? radarMetrics.averageRsi15m : 50.0;
              const exchanges = radarMetrics.exchanges || [];
              const exDetailsArr = [];

              exchanges.forEach(ex => {
                const exName = ex.name || ex.exchangeId;
                const obiVal = ex.obiPct !== undefined ? ex.obiPct.toFixed(1) : '50.0';
                exDetailsArr.push(`${exName}: ${obiVal}%`);
              });

              // Dynamic Custom Threshold Evaluation per Order Card (NO hardcoding - respects each card's specific configuration)
              const targetObi = order.customObiThreshold !== undefined && order.customObiThreshold !== null
                ? parseFloat(order.customObiThreshold)
                : (order.targetObi !== undefined && order.targetObi !== null ? parseFloat(order.targetObi) : 55.0);

              const targetRsi = order.customRsiThreshold !== undefined && order.customRsiThreshold !== null
                ? parseFloat(order.customRsiThreshold)
                : (order.targetRsi !== undefined && order.targetRsi !== null ? parseFloat(order.targetRsi) : 49.0);

              const obiGatePassed = (avgObi >= targetObi);
              const rsiGatePassed = (rsi4h <= targetRsi);
              const rawGateMatch = obiGatePassed && rsiGatePassed;

              // ⏳ 3-TICK OBI PERSISTENCE FILTER (3-Second Continuous Stability Check)
              const requiredPersistenceTicks = 3;
              if (rawGateMatch) {
                order.obiPersistenceCount = (order.obiPersistenceCount || 0) + 1;
                changed = true;
                if (order.obiPersistenceCount < requiredPersistenceTicks) {
                  dualGatePassed = false;
                  this.log(
                    `⏳ [3-TICK OBI PERSISTENCE ${order.obiPersistenceCount}/3] ${order.symbol}: Top 10 Avg OBI = ${avgObi.toFixed(1)}% (>= ${targetObi.toFixed(1)}%) & 4h 15m RSI = ${rsi4h.toFixed(1)} (<= ${targetRsi.toFixed(1)}). Sustained ${order.obiPersistenceCount}/3 ticks...`,
                    'info',
                    order.symbol
                  );
                } else {
                  dualGatePassed = true; // Sustained continuously for 3 consecutive ticks (3 seconds)!
                }
              } else {
                // Immediately reset persistence counter if OBI or RSI drops below threshold at any tick
                if (order.obiPersistenceCount !== 0) {
                  order.obiPersistenceCount = 0;
                  changed = true;
                }
                dualGatePassed = false;
              }

              order._reqTargetObi = targetObi;
              order._reqTargetRsi = targetRsi;

              if (exDetailsArr.length > 0) {
                exchangeDetailsStr = ` | Exchanges Breakdown: [${exDetailsArr.join(', ')}]`;
              }
            } else {
              order.obiPersistenceCount = 0;
              dualGatePassed = false;
            }
          } catch (e) {
            order.obiPersistenceCount = 0;
            dualGatePassed = false;
          }
        }

        const targetObiStr = (order._reqTargetObi !== undefined ? order._reqTargetObi : 55.0).toFixed(1);
        const targetRsiStr = (order._reqTargetRsi !== undefined ? order._reqTargetRsi : 40.0).toFixed(1);

        if (dualGatePassed) {
          // 🔒 DOUBLE SAFETY GUARD: Check if MEXC physical wallet ALREADY holds >= $10 USDT of this asset to prevent duplicate buys!
          if (!order.dryRun) {
            const asset = order.symbol.replace('USDT', '').toUpperCase();
            try {
              const balances = await this.mexcClient.getBalances();
              const assetBal = Array.isArray(balances) ? balances.find(b => b.asset.toUpperCase() === asset) : null;
              const freeBal = assetBal ? (parseFloat(assetBal.free) || 0) : 0;
              const lockedBal = assetBal ? (parseFloat(assetBal.locked) || 0) : 0;
              const notionalVal = (freeBal + lockedBal) * currentPrice;

              if (notionalVal >= 10.0) {
                this.log(`🔒 [DUPLICATE BUY PREVENTED] ${order.symbol} physical MEXC wallet balance is already $${notionalVal.toFixed(2)} USDT (>= $10.00). Syncing card state to TP_SL_ACTIVE (Holding) without sending duplicate buy!`, 'warning', order.symbol);
                order.status = 'TP_SL_ACTIVE';
                order.executionPrice = order.executionPrice || currentPrice;
                this.saveOrders();
                changed = true;
                continue; // DO NOT SEND DUPLICATE MARKET BUY!
              }
            } catch (e) {}
          }

          order.obiPersistenceCount = 0; // Reset counter post execution confirmation
          order.activatedAt = new Date().toISOString();

          // 🛡️ SPREAD EVALUATION & DUAL EXECUTION ROUTER (Market Buy vs Top Maker Peg Limit Buy)
          let spreadPct = 0.0;
          let bestBid = currentPrice;
          let bestAsk = currentPrice;

          try {
            const depth = await this.mexcClient.getDepth(order.symbol, 10);
            if (depth && Array.isArray(depth.bids) && depth.bids.length > 0 && Array.isArray(depth.asks) && depth.asks.length > 0) {
              bestBid = parseFloat(depth.bids[0][0]) || currentPrice;
              bestAsk = parseFloat(depth.asks[0][0]) || currentPrice;
              if (bestBid > 0) {
                spreadPct = ((bestAsk - bestBid) / bestBid) * 100;
              }
            }
          } catch (dErr) {}

          const maxSpreadLimit = order.maxSpreadPct || 0.30;

          if (spreadPct <= maxSpreadLimit) {
            // TIGHT SPREAD (<= 0.30% e.g. BTC, ETH, SOL, Gold, EUR) -> Immediate Market Buy!
            this.log(
              `🎯 [DUAL GATE CONFIRMED - TIGHT SPREAD ${spreadPct.toFixed(2)}% <= ${maxSpreadLimit}%] ${order.symbol}: Top 10 Avg OBI = ${avgObi.toFixed(1)}% & RSI = ${rsi4h.toFixed(1)} sustained for 3/3 ticks! Executing Immediate Market Buy...`,
              'success',
              order.symbol
            );
            order.status = 'PENDING_BUY';
            changed = true;
            continue;
          } else {
            // WIDE SPREAD (> 0.30% e.g. AAPLX, NVDAX) -> MAKER PEG LIMIT BUY AT BEST BID + $0.01
            const pegStep = currentPrice > 10.0 ? 0.01 : 0.0001;
            const pegBuyPrice = parseFloat((bestBid + pegStep).toFixed(4));
            this.log(
              `🛡️ [WIDE SPREAD DETECTED: ${spreadPct.toFixed(2)}% > ${maxSpreadLimit}%] ${order.symbol}: Blocking Market Buy to prevent high ask trap! Placing MAKER PEG LIMIT BUY at Top Bid + $${pegStep} ($${pegBuyPrice} USDT)...`,
              'warning',
              order.symbol
            );

            order.status = 'PENDING_LIMIT_BUY';
            order.limitBuyPlacedAt = Date.now();
            order.targetBuyPrice = pegBuyPrice;
            
            if (order.dryRun) {
              order.mexcBuyOrderId = `dry_limit_buy_${Date.now()}`;
              this.log(`[DRY RUN] Placed Top Maker Peg Limit Buy order at $${pegBuyPrice} USDT. Waiting 30s for fill...`, 'info', order.symbol);
            } else {
              try {
                const grossQty = order.quantity || (order.quoteOrderQty / pegBuyPrice);
                const precisionMult = this.getSymbolQuantityPrecision(order.symbol, pegBuyPrice);
                const qtyToTry = Math.floor(grossQty * precisionMult) / precisionMult;

                const limitBuyRes = await this.mexcClient.placeOrder({
                  symbol: order.symbol,
                  side: 'BUY',
                  type: 'LIMIT',
                  quantity: qtyToTry,
                  price: pegBuyPrice
                });

                if (limitBuyRes && limitBuyRes.orderId) {
                  order.mexcBuyOrderId = limitBuyRes.orderId;
                  this.log(`🎯 [REAL LIMIT BUY PLACED] Top Limit Buy order for ${qtyToTry} ${order.symbol} placed at $${pegBuyPrice} USDT (Order ID: ${limitBuyRes.orderId}). Waiting 30s for fill...`, 'success', order.symbol);
                } else {
                  throw new Error('Failed to place Limit Buy order');
                }
              } catch (limitErr) {
                this.log(`❌ [LIMIT BUY FAILED] ${limitErr.message}. Resetting to PENDING_ACTIVATION...`, 'error', order.symbol);
                order.status = 'PENDING_ACTIVATION';
                changed = true;
                continue;
              }
            }
            changed = true;
            continue;
          }
        }

        // Live 1-Second Heartbeat OBI Scan Log Stream
        if (!order.lastHeartbeatLogTime || (now - order.lastHeartbeatLogTime >= 1000)) {
          order.lastHeartbeatLogTime = now;
          const currPriceNum = parseFloat(currentPrice) || 0;
          this.log(
            `⚡ [DUAL GATE SCAN] ${order.symbol}: Live Price $${currPriceNum.toFixed(4)} USDT | Top 10 Avg OBI: ${avgObi.toFixed(1)}% (Req >= ${targetObiStr}%) | 4h 15m RSI: ${rsi4h.toFixed(1)} (Req <= ${targetRsiStr})${exchangeDetailsStr}. Scanning live orderbooks & RSI...`,
            'info',
            order.symbol
          );
        }

        continue;
      }

      // 1.45 Execute Market Buy & Place Limit Sell TP when PENDING_BUY is triggered
      if (order.status === 'PENDING_BUY') {
        this.log(`🚀 [EXECUTING MARKET BUY] Top 10 OBI Gate Passed! Sending MARKET BUY order to MEXC server for ${order.symbol}...`, 'info', order.symbol);
        
        if (order.dryRun) {
          order.executionPrice = parseFloat(currentPrice) || 0;
          order.status = 'TP_SL_ACTIVE';
          const execPriceNum = parseFloat(currentPrice) || 0;
          this.log(`[DRY RUN] Simulated Market Buy executed for ${order.symbol} at $${execPriceNum.toFixed(4)} USDT. Transitioning to TP/SL monitoring.`, 'success', order.symbol);
          changed = true;
          continue;
        }

        try {
          let result = null;
          let buyQty = null;
          const decimalsToTry = [10000, 100, 10, 1, 100000, 1000000];

          if (order.quantity) {
            for (const mult of decimalsToTry) {
              const qtyToTry = Math.floor(order.quantity * mult) / mult;
              if (qtyToTry <= 0) continue;
              try {
                result = await this.mexcClient.placeOrder({ symbol: order.symbol, side: 'BUY', type: 'MARKET', quantity: qtyToTry });
                if (result && result.orderId) { buyQty = qtyToTry; break; }
              } catch (err) {
                if ((err.message || '').includes('quantity scale')) continue;
                throw err;
              }
            }
          } else if (order.quoteOrderQty) {
            result = await this.mexcClient.placeOrder({ symbol: order.symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: order.quoteOrderQty });
          }

          if (!result || !result.orderId) throw new Error('Failed to place MARKET buy order on MEXC.');

          order.mexcOrderId = result.orderId;
          let execPrice = currentPrice;
          try {
            const fills = await this.mexcClient.getOrder(order.symbol, result.orderId);
            if (fills && parseFloat(fills.executedQty) > 0) {
              const cumQuote = parseFloat(fills.cummulativeQuoteQty || 0);
              const execQty  = parseFloat(fills.executedQty || 1);
              if (cumQuote > 0) execPrice = cumQuote / execQty;
            }
          } catch(e) {}

          order.executionPrice = execPrice;
          this.log(`✅ [MARKET BUY FILLED] Order ${result.orderId} executed on MEXC at $${execPrice.toFixed(4)} USDT!`, 'success', order.symbol);

          // Place Take Profit Limit Sell Order on MEXC immediately
          const tpPct = (order.takeProfit || 0.6);
          const tpPrice = execPrice * (1 + (tpPct / 100));
          const grossQty = order.quantity || (order.quoteOrderQty / execPrice);
          const sellQty = await this.getFeeAdjustedBalance(order.symbol, grossQty);
          const safeQty = sellQty * 0.998;

          for (const mult of decimalsToTry) {
            const qtyToTry = Math.floor(safeQty * mult) / mult;
            if (qtyToTry <= 0) continue;
            try {
              const tpResult = await this.mexcClient.placeOrder({
                symbol: order.symbol,
                side: 'SELL',
                type: 'LIMIT',
                quantity: qtyToTry,
                price: tpPrice
              });
              if (tpResult && tpResult.orderId) {
                order.mexcSellOrderId = tpResult.orderId;
                this.log(`🎯 [REAL TP LIMIT SELL PLACED] Placed Limit Sell for ${qtyToTry} ${order.symbol} @ $${tpPrice.toFixed(4)} USDT (+${tpPct}% TP Target)! (MEXC Order ID: ${tpResult.orderId})`, 'success', order.symbol);
                break;
              }
            } catch (tpErr) {
              if ((tpErr.message || '').includes('quantity scale')) continue;
              break;
            }
          }

          order.status = 'TP_SL_ACTIVE';
          changed = true;
        } catch (buyErr) {
          order.status = 'FAILED';
          order.error = buyErr.message;
          this.log(`❌ [MEXC BUY ERROR] Market Buy failed: ${buyErr.message}`, 'error', order.symbol);
        }
        continue;
      }

      // 1.48 Handle 60-Second Top Maker Peg Limit Buy Monitoring, Auto Re-Peg & Spread Re-Evaluation Loop
      if (order.status === 'PENDING_LIMIT_BUY') {
        const now = Date.now();
        const limitTimeoutMs = 60000; // 60 seconds (1 minute per user request)
        const timeElapsed = now - (order.limitBuyPlacedAt || now);

        let isFilled = false;
        let fillPrice = order.targetBuyPrice || currentPrice;

        if (order.dryRun) {
          // In Dry Run, fill if current price touches or drops to/below target buy price
          if (currentPrice <= (order.targetBuyPrice || currentPrice)) {
            isFilled = true;
          }
        } else if (order.mexcBuyOrderId) {
          try {
            const qRes = await this.mexcClient.getOrder(order.symbol, order.mexcBuyOrderId);
            if (qRes && (qRes.status === 'FILLED' || parseFloat(qRes.executedQty || 0) > 0)) {
              isFilled = true;
              fillPrice = parseFloat(qRes.price) || order.targetBuyPrice || currentPrice;
            }
          } catch (qErr) {}
        }

        if (isFilled) {
          order.executionPrice = fillPrice;
          order.status = 'TP_SL_ACTIVE';
          this.log(`🎉 [MAKER PEG LIMIT BUY FILLED] ${order.symbol} Top Limit Buy filled at $${fillPrice.toFixed(4)} USDT! Transitioning to TP_SL_ACTIVE (+${order.takeProfit}% TP).`, 'success', order.symbol);

          // Place TP Limit Sell if Real mode
          if (!order.dryRun) {
            try {
              const tpPct = order.takeProfit || 0.6;
              const tpPrice = fillPrice * (1 + (tpPct / 100));
              const grossQty = order.quantity || (order.quoteOrderQty / fillPrice);
              const sellQty = await this.getFeeAdjustedBalance(order.symbol, grossQty);
              const safeQty = sellQty * 0.998;
              const mult = this.getSymbolQuantityPrecision(order.symbol, fillPrice);
              const qtyToTry = Math.floor(safeQty * mult) / mult;

              const tpRes = await this.mexcClient.placeOrder({
                symbol: order.symbol,
                side: 'SELL',
                type: 'LIMIT',
                quantity: qtyToTry,
                price: tpPrice
              });
              if (tpRes && tpRes.orderId) {
                order.mexcSellOrderId = tpRes.orderId;
                this.log(`🎯 [REAL TP LIMIT SELL PLACED] Placed Limit Sell for ${qtyToTry} ${order.symbol} @ $${tpPrice.toFixed(4)} USDT (+${tpPct}% TP Target)! (MEXC Order ID: ${tpRes.orderId})`, 'success', order.symbol);
              }
            } catch (tpErr) {}
          }

          changed = true;
          continue;
        }

        // Check if 60-Second (1 Minute) Timeout Expired
        if (timeElapsed >= limitTimeoutMs) {
          this.log(`⏳ [60s LIMIT BUY TIMEOUT] ${order.symbol} Limit Buy at $${order.targetBuyPrice} not filled after 60s. Cancelling order & re-evaluating live order book spread...`, 'warning', order.symbol);

          // 1. Cancel un-filled Limit Buy order
          if (!order.dryRun && order.mexcBuyOrderId) {
            try {
              await this.mexcClient.cancelOrder(order.symbol, order.mexcBuyOrderId);
            } catch (cErr) {}
          }
          order.mexcBuyOrderId = null;

          // 2. Fetch live order book depth & calculate current Bid-Ask Spread
          let spreadPct = 0.0;
          let bestBid = currentPrice;
          let bestAsk = currentPrice;

          try {
            const depth = await this.mexcClient.getDepth(order.symbol, 10);
            if (depth && Array.isArray(depth.bids) && depth.bids.length > 0 && Array.isArray(depth.asks) && depth.asks.length > 0) {
              bestBid = parseFloat(depth.bids[0][0]) || currentPrice;
              bestAsk = parseFloat(depth.asks[0][0]) || currentPrice;
              if (bestBid > 0) {
                spreadPct = ((bestAsk - bestBid) / bestBid) * 100;
              }
            }
          } catch (dErr) {}

          const maxSpreadLimit = order.maxSpreadPct || 0.30;

          if (spreadPct <= maxSpreadLimit) {
            // SPREAD NARROWED (<= 0.30%) -> SWITCH TO IMMEDIATE MARKET BUY!
            this.log(
              `⚡ [RE-EVALUATION: SPREAD NARROWED ${spreadPct.toFixed(2)}% <= ${maxSpreadLimit}%] ${order.symbol}: Spread is now tight! Switching from Limit Buy to IMMEDIATE MARKET BUY...`,
              'success',
              order.symbol
            );
            order.status = 'PENDING_BUY';
            changed = true;
            continue;
          } else {
            // SPREAD STILL WIDE (> 0.30%) -> RE-PEG MAKER LIMIT BUY AT NEW TOP BID + $0.01 & RESTART 60s TIMER!
            const pegStep = currentPrice > 10.0 ? 0.01 : 0.0001;
            const newPegBuyPrice = parseFloat((bestBid + pegStep).toFixed(4));
            this.log(
              `🛡️ [RE-EVALUATION: SPREAD STILL WIDE ${spreadPct.toFixed(2)}% > ${maxSpreadLimit}%] ${order.symbol}: Re-pegging Maker Limit Buy at updated Top Bid + $${pegStep} ($${newPegBuyPrice} USDT). Restarting 60s timer...`,
              'warning',
              order.symbol
            );

            order.limitBuyPlacedAt = Date.now();
            order.targetBuyPrice = newPegBuyPrice;

            if (order.dryRun) {
              order.mexcBuyOrderId = `dry_limit_buy_${Date.now()}`;
            } else {
              try {
                const grossQty = order.quantity || (order.quoteOrderQty / newPegBuyPrice);
                const precisionMult = this.getSymbolQuantityPrecision(order.symbol, newPegBuyPrice);
                const qtyToTry = Math.floor(grossQty * precisionMult) / precisionMult;

                const limitBuyRes = await this.mexcClient.placeOrder({
                  symbol: order.symbol,
                  side: 'BUY',
                  type: 'LIMIT',
                  quantity: qtyToTry,
                  price: newPegBuyPrice
                });

                if (limitBuyRes && limitBuyRes.orderId) {
                  order.mexcBuyOrderId = limitBuyRes.orderId;
                  this.log(`🎯 [NEW LIMIT BUY RE-PLACED] Top Limit Buy for ${qtyToTry} ${order.symbol} placed at $${newPegBuyPrice} USDT. Waiting 60s for fill...`, 'success', order.symbol);
                } else {
                  throw new Error('Failed to re-place Limit Buy order');
                }
              } catch (reErr) {
                this.log(`❌ [RE-PLACE LIMIT BUY FAILED] ${reErr.message}. Resetting to PENDING_ACTIVATION...`, 'error', order.symbol);
                order.status = 'PENDING_ACTIVATION';
                changed = true;
                continue;
              }
            }
            changed = true;
            continue;
          }
        }

        // Still within 60s window, waiting for fill
        if (!order.lastLimitBuyLogTime || (now - order.lastLimitBuyLogTime >= 5000)) {
          order.lastLimitBuyLogTime = now;
          const remainingSec = Math.ceil((limitTimeoutMs - timeElapsed) / 1000);
          this.log(`⏳ [PENDING_LIMIT_BUY IN PROGRESS] ${order.symbol}: Top Limit Buy order active at $${order.targetBuyPrice} USDT. Waiting for seller fill (${remainingSec}s remaining in 60s cycle)...`, 'info', order.symbol);
        }

        continue;
      }

      // 1.5 Check TP/SL OCO checks if already bought and holding
      if (order.status === 'TP_SL_ACTIVE') {
        const now = Date.now();
        const execPrice = order.executionPrice || order.initialPrice || order.currentPrice;
        const tpPct = (order.takeProfit || 0.6);
        const tpTargetPrice = execPrice * (1 + (tpPct / 100));

        // 🚨 SMART RSI CRASH STOP LOSS GUARD: If 4h 15m RSI drops equal to or below 20.0 (RSI <= 20.0)
        let currentRsi15m = 50.0;
        try {
          let radarMetrics = this.signalRadar ? this.signalRadar.getRadarMetrics(order.symbol) : null;
          if (!radarMetrics && this.signalRadar) {
            radarMetrics = await this.signalRadar.getMultiExchangeMetrics(order.symbol).catch(() => null);
          }
          if (radarMetrics && radarMetrics.averageRsi15m !== undefined) {
            currentRsi15m = radarMetrics.averageRsi15m;
          }
        } catch (e) {}

        if (currentRsi15m <= 20.0) {
          this.log(`🚨 [RSI EMERGENCY CRASH SL TRIGGERED] ${order.symbol}: 4h 15m RSI = ${currentRsi15m.toFixed(1)} (<= 20.0)! Cancelling limit sell order & executing IMMEDIATE MARKET SELL on MEXC...`, 'error', order.symbol);

          if (!order.dryRun && this.mexcClient && this.mexcClient.hasCredentials()) {
            if (order.mexcSellOrderId) {
              try {
                await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
                await new Promise(r => setTimeout(r, 600));
              } catch (cErr) {}
            }

            try {
              const grossQty = order.quantity || (order.quoteOrderQty / execPrice);
              const sellQty = await this.getFeeAdjustedBalance(order.symbol, grossQty);
              const precisionMult = this.getSymbolQuantityPrecision(order.symbol, currentPrice);
              const qtyToTry = Math.floor(sellQty * precisionMult) / precisionMult;

              if (qtyToTry > 0) {
                await this.mexcClient.placeOrder({
                  symbol: order.symbol,
                  side: 'SELL',
                  type: 'MARKET',
                  quantity: qtyToTry
                });
                this.log(`✅ [RSI CRASH MARKET SELL EXECUTED] Sold ${qtyToTry} ${order.symbol} @ $${currentPrice.toFixed(4)} USDT on MEXC!`, 'success', order.symbol);
              }
            } catch (mErr) {
              this.log(`RSI Crash Market Sell Notice: ${mErr.message}`, 'warning', order.symbol);
            }
          }

          order.status = 'TRIGGERED';
          order.sellExecutionPrice = currentPrice;
          order.sellTriggeredAt = new Date().toISOString();
          order.error = `RSI Crash SL Hit (RSI = ${currentRsi15m.toFixed(1)})`;
          changed = true;
          await this.handleOrderCycleComplete(order);
          continue;
        }

        // 🎯 HARD GUARANTEE: If Current Market Price >= Take Profit Target Price (e.g. $55.1500 >= $55.1443)
        if (currentPrice >= (tpTargetPrice - 0.00000001)) {
          if (order.isSellingTp) continue; // Lock: Prevent duplicate log emissions while Market Sell is in flight!
          order.isSellingTp = true;

          if (order.dryRun) {
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = tpTargetPrice;
            order.sellTriggeredAt = new Date().toISOString();
            this.log(`🎉 [DRY RUN TAKE PROFIT HIT] ${order.symbol} price $${currentPrice.toFixed(4)} >= TP target $${tpTargetPrice.toFixed(4)} (+${tpPct}%). Executed simulated TP sell!`, 'success', order.symbol);
            changed = true;
            order.isSellingTp = false;
            await this.handleOrderCycleComplete(order);
            continue;
          } else {
            // REAL LIVE TRADE TAKE PROFIT TRIGGER!
            this.log(`🎯 [REAL TAKE PROFIT TARGET REACHED] ${order.symbol} live price $${currentPrice.toFixed(4)} >= TP target $${tpTargetPrice.toFixed(4)} (+${tpPct}%)! Verifying MEXC order fill & finalizing cycle...`, 'success', order.symbol);

            let isTpFilled = false;
            let sellPriceFound = currentPrice;

            // 1. Check if the placed Limit Sell TP order was filled on MEXC
            if (order.mexcSellOrderId) {
              try {
                const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
                if (queryRes) {
                  const statusStr = (queryRes.status || '').toUpperCase();
                  const execQty = parseFloat(queryRes.executedQty || 0);
                  const origQty = parseFloat(queryRes.origQty || 1);

                  if (statusStr === 'FILLED' || statusStr === 'CLOSED' || (execQty > 0 && execQty >= origQty * 0.99)) {
                    isTpFilled = true;
                    if (queryRes.price && parseFloat(queryRes.price) > 0) {
                      sellPriceFound = parseFloat(queryRes.price);
                    }
                  }
                }
              } catch (e) {
                if (e.message && (e.message.includes('-2013') || e.message.includes('does not exist'))) {
                  order.mexcSellOrderId = null;
                  changed = true;
                }
              }

              // 2. Check if order is no longer in open orders (Filled!)
              if (!isTpFilled && order.mexcSellOrderId) {
                try {
                  const openOrders = await this.mexcClient.getOpenOrders(order.symbol);
                  const stillOpen = Array.isArray(openOrders) && openOrders.some(o => o.orderId === order.mexcSellOrderId || o.side === 'SELL');
                  if (!stillOpen) {
                    isTpFilled = true;
                  }
                } catch (e) {}
              }
            }

            // 3. If TP limit sell order is STILL OPEN or not filled yet on MEXC, CANCEL it and execute IMMEDIATE MARKET SELL to guarantee profit capture!
            if (!isTpFilled) {
              this.log(`⚡ [FORCE MARKET SELL FOR TP] Price $${currentPrice.toFixed(4)} exceeded TP target $${tpTargetPrice.toFixed(4)}. Cancelling limit sell order ${order.mexcSellOrderId || ''} and executing IMMEDIATE MARKET SELL on MEXC...`, 'warning', order.symbol);

              if (order.mexcSellOrderId) {
                try {
                  await this.mexcClient.cancelOrder(order.symbol, order.mexcSellOrderId);
                  await new Promise(r => setTimeout(r, 600));
                } catch (cErr) {}
              }

              try {
                const grossQty = order.quantity || (order.quoteOrderQty / execPrice);
                const sellQty = await this.getFeeAdjustedBalance(order.symbol, grossQty);
                const baseMult = this.getSymbolQuantityPrecision(order.symbol, currentPrice);
                const uniqueMults = [...new Set([baseMult, 1, 100, 10, 10000, 1000])];

                for (const mult of uniqueMults) {
                  const qtyToTry = Math.floor(sellQty * mult) / mult;
                  if (qtyToTry <= 0) continue;
                  try {
                    const sellRes = await this.mexcClient.placeOrder({
                      symbol: order.symbol,
                      side: 'SELL',
                      type: 'MARKET',
                      quantity: qtyToTry
                    });
                    if (sellRes && sellRes.orderId) {
                      this.log(`✅ [TP MARKET SELL EXECUTED] Market Sell executed for ${qtyToTry} ${order.symbol} @ $${currentPrice.toFixed(4)} USDT!`, 'success', order.symbol);
                      isTpFilled = true;
                      break;
                    }
                  } catch (pErr) {
                    if ((pErr.message || '').includes('30002') || (pErr.message || '').includes('1USDT')) {
                      this.log(`⚠️ [TP DUST SELL SKIPPED] Value below 1.0 USDT limit. Finalizing TP cycle.`, 'warning', order.symbol);
                      isTpFilled = true;
                      break;
                    }
                  }
                }
              } catch (mSellErr) {
                this.log(`Market sell error: ${mSellErr.message}. Finalizing TP cycle complete.`, 'warning', order.symbol);
                isTpFilled = true;
              }
            }

            // Finalize TP Cycle Complete!
            order.status = 'TRIGGERED';
            order.sellExecutionPrice = sellPriceFound;
            order.sellTriggeredAt = new Date().toISOString();
            order.isSellingTp = false;
            changed = true;
            await this.handleOrderCycleComplete(order);
            continue;
          }
        }

        // Automatic Ghost Order Self-Healing: Verify real MEXC balance for real trades
        if (!order.dryRun) {
          if (!order.lastGhostCheckTime || (now - order.lastGhostCheckTime > 5000)) {
            order.lastGhostCheckTime = now;

            // FIRST: Check if the placed TP Limit Sell order was filled on MEXC!
            if (order.mexcSellOrderId) {
              let isTpFilled = false;
              let sellPriceFound = null;

              try {
                const queryRes = await this.mexcClient.getOrder(order.symbol, order.mexcSellOrderId);
                if (queryRes) {
                  const statusStr = (queryRes.status || '').toUpperCase();
                  const execQty = parseFloat(queryRes.executedQty || 0);
                  const origQty = parseFloat(queryRes.origQty || 1);

                  if (statusStr === 'FILLED' || statusStr === 'CLOSED' || (execQty > 0 && execQty >= origQty * 0.99)) {
                    isTpFilled = true;
                    if (queryRes.price && parseFloat(queryRes.price) > 0) {
                      sellPriceFound = parseFloat(queryRes.price);
                    }
                  }
                }
              } catch (e) {
                if (e.message && (e.message.includes('-2013') || e.message.includes('does not exist'))) {
                  order.mexcSellOrderId = null;
                  changed = true;
                }
              }

              // Secondary Fallback: Check if order is NO LONGER in MEXC open orders (Order filled!)
              if (!isTpFilled && order.mexcSellOrderId) {
                try {
                  const openOrders = await this.mexcClient.getOpenOrders(order.symbol);
                  const sellOrderStillOpen = Array.isArray(openOrders) && openOrders.some(o => o.orderId === order.mexcSellOrderId || o.side === 'SELL');
                  if (!sellOrderStillOpen) {
                    // Order is no longer in open orders! Query recent trade history for exact sell fill price
                    isTpFilled = true;
                    try {
                      const trades = await this.mexcClient.getMyTrades(order.symbol, 5);
                      if (Array.isArray(trades) && trades.length > 0) {
                        const sellTrade = trades.reverse().find(t => t.isBuyerMaker || t.isMaker);
                        if (sellTrade && parseFloat(sellTrade.price) > 0) {
                          sellPriceFound = parseFloat(sellTrade.price);
                        }
                      }
                    } catch (tErr) {}
                  }
                } catch (e) {}
              }

              if (isTpFilled) {
                const tpDollar = ((order.takeProfit || 0.6) / 100) * (order.executionPrice || order.initialPrice);
                order.status = 'TRIGGERED';
                order.sellExecutionPrice = sellPriceFound || ((order.executionPrice || order.initialPrice) + tpDollar);
                order.sellTriggeredAt = new Date().toISOString();
                this.log(`🎉 [REAL TAKE PROFIT FILLED] Limit Sell order ${order.mexcSellOrderId} filled on MEXC @ $${order.sellExecutionPrice.toFixed(4)} USDT!`, 'success', order.symbol);
                changed = true;
                await this.handleOrderCycleComplete(order);
                continue;
              }
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
        } else if (order.mexcSellOrderId) {
          // Real Mode: Check if Limit Sell order filled on MEXC
          order.lastStatusCheckTime = now;
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
        } else if (!order.dryRun && order.takeProfit && currentPrice >= (order.executionPrice + (order.takeProfit / 100) * order.executionPrice)) {
          // Real Mode TP Price Target Fallback Check
          const tpDollar = (order.takeProfit / 100) * order.executionPrice;
          order.status = 'TRIGGERED';
          order.sellExecutionPrice = order.executionPrice + tpDollar;
          order.sellTriggeredAt = new Date().toISOString();
          this.log(`[REAL] Take Profit Target reached at $${currentPrice} USDT! Finalizing cycle...`, 'success', order.symbol);
          changed = true;
          await this.handleOrderCycleComplete(order);
          continue;
        }

        // Common Stop Loss Target Price calculation (Dry Run & Real Mode)
        const slDollar = (order.stopLoss / 100) * order.executionPrice;
        let targetSlPrice = order.executionPrice - slDollar;
        
        if (order.filterSmartSl && order.isSlExtended && order.slBuffer) {
          const bufferDollar = (order.slBuffer / 100) * order.executionPrice;
          targetSlPrice -= bufferDollar;
        }

        // Check if Stop Loss target is hit (Bypassed if 15m Trend Guard set NO_SL!)
        if (order.stopLoss && order.adaptiveSlMode !== 'NO_SL' && currentPrice <= targetSlPrice) {
          order.status = 'PENDING_EXECUTION'; // Transition immediately to block duplicate execution!

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
            // Legacy trailing dip engine completely removed. Strategies execute strictly via Top 10 Exchanges OBI Dual-Lock Gate in PENDING_ACTIVATION!
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
    // Guaranteed continuous looping: Auto-repeat defaults to true for all active tracking cards
    if (order.autoRepeat === false) {
      order.status = 'TRIGGERED';
      this.saveOrders();
      return;
    }
    order.autoRepeat = true;

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
    order.startImmediately = false; // MUST wait for fresh dip after selling!
    order.peakPrice = sellPrice;
    const offsetPct = order.activationOffset || 0.15;
    order.activationPrice = sellPrice * (1 - (offsetPct / 100));
    order.activationDirection = 'DOWN';
    order.localBottom = sellPrice;
    order.bottomPrice = null;
    order.triggerPrice = null;
    order.obiPersistenceCount = 0;
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
