const fs = require('fs');
const path = require('path');

class SmartGridTracker {
  constructor(mexcClient) {
    this.mexcClient = mexcClient;
    this.dataFilePath = path.join(__dirname, 'data', 'grid_orders.json');
    this.logsFilePath = path.join(__dirname, 'data', 'grid_logs.json');
    this.grids = [];
    this.logs = [];
    this.isPolling = false;
    this.pollInterval = 10000; // 10s polling interval
    this.intervalId = null;
    this.io = null;

    this.ensureDataDir();
    this.loadGrids();
    this.loadLogs();
  }

  ensureDataDir() {
    const dir = path.join(__dirname, 'data');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadGrids() {
    try {
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf8');
        this.grids = JSON.parse(raw);
      }
    } catch (e) {
      this.grids = [];
    }
  }

  saveGrids() {
    try {
      fs.writeFileSync(this.dataFilePath, JSON.stringify(this.grids, null, 2), 'utf8');
      if (this.io) {
        this.io.emit('grid_orders_updated', this.grids);
      }
    } catch (e) {
      console.error('Error saving grid orders:', e.message);
    }
  }

  loadLogs() {
    try {
      if (fs.existsSync(this.logsFilePath)) {
        const raw = fs.readFileSync(this.logsFilePath, 'utf8');
        this.logs = JSON.parse(raw);
      }
    } catch (e) {
      this.logs = [];
    }
  }

  log(message, type = 'info', symbol = null, gridId = null) {
    const entry = {
      id: 'glog_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      message,
      type,
      symbol,
      gridId
    };
    this.logs.unshift(entry);
    if (this.logs.length > 500) this.logs.pop();

    try {
      fs.writeFileSync(this.logsFilePath, JSON.stringify(this.logs, null, 2), 'utf8');
      if (this.io) {
        this.io.emit('grid_log_added', entry);
      }
    } catch (e) {}

    console.log(`[SMART GRID ${type.toUpperCase()}] ${symbol ? `[${symbol}] ` : ''}${message}`);
  }

  startTracking() {
    if (this.isPolling) return;
    this.isPolling = true;
    this.log(`Smart Absorption Grid Tracker started polling every ${this.pollInterval}ms.`, 'info');
    
    this.intervalId = setInterval(() => {
      this.tick().catch(err => {
        console.error('SmartGridTracker tick error:', err.message);
      });
    }, this.pollInterval);

    // Initial immediate tick
    this.tick().catch(err => {});
  }

  stopTracking() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPolling = false;
    this.log('Smart Absorption Grid Tracker stopped.', 'info');
  }

  async createGridBot(params) {
    const symbol = (params.symbol || '').toUpperCase().trim();
    if (!symbol) throw new Error('Symbol is required.');

    const lowerPrice = parseFloat(params.lowerPrice);
    const upperPrice = parseFloat(params.upperPrice);
    const gridCount = parseInt(params.gridCount, 10);
    const totalInvestmentUsdt = parseFloat(params.totalInvestmentUsdt);

    if (isNaN(lowerPrice) || lowerPrice <= 0) throw new Error('Invalid lower price limit.');
    if (isNaN(upperPrice) || upperPrice <= lowerPrice) throw new Error('Upper price must be greater than lower price.');
    if (isNaN(gridCount) || gridCount < 2) throw new Error('Grid count must be at least 2.');
    if (isNaN(totalInvestmentUsdt) || totalInvestmentUsdt <= 0) throw new Error('Invalid total investment USDT.');

    // Fetch live ticker price
    const currentPrice = await this.mexcClient.getTickerPrice(symbol);
    if (!currentPrice || currentPrice <= 0) throw new Error(`Could not fetch live price for ${symbol}`);

    const stepSize = (upperPrice - lowerPrice) / (gridCount - 1);
    const stepPct = (stepSize / lowerPrice) * 100;
    const investmentPerGrid = totalInvestmentUsdt / gridCount;

    const levels = [];
    for (let i = 0; i < gridCount; i++) {
      const price = lowerPrice + (i * stepSize);
      // If level is below current price -> BUY side. If level is above current price -> SELL side.
      const side = price <= currentPrice ? 'BUY' : 'SELL';
      levels.push({
        index: i,
        price: parseFloat(price.toFixed(4)),
        side,
        status: 'IDLE', // 'IDLE', 'BUY_PLACED', 'BUY_FILLED', 'SELL_PLACED', 'CANCELLED_PRESSURE'
        mexcOrderId: null,
        buyExecPrice: null,
        sellTargetPrice: null,
        filledAt: null
      });
    }

    const gridBot = {
      id: 'grid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      symbol,
      lowerPrice,
      upperPrice,
      gridCount,
      stepSize: parseFloat(stepSize.toFixed(4)),
      stepPct: parseFloat(stepPct.toFixed(2)),
      totalInvestmentUsdt,
      investmentPerGrid: parseFloat(investmentPerGrid.toFixed(2)),
      dryRun: params.dryRun !== false,
      filterObi: params.filterObi !== false,
      filter40sVolume: params.filter40sVolume !== false,
      filterSmartSl: params.filterSmartSl !== false,
      consensusMode: params.consensusMode || 'SMART_CONFLUENCE',
      status: 'RUNNING', // 'RUNNING', 'PAUSED', 'STOPPED'
      totalNetProfitUsdt: 0,
      gridHistory: [],
      levels,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.grids.unshift(gridBot);
    this.saveGrids();
    this.log(`Created Smart Grid Bot for ${symbol} ($${lowerPrice} - $${upperPrice}, ${gridCount} Grids, $${totalInvestmentUsdt} USDT).`, 'success', symbol, gridBot.id);

    return gridBot;
  }

  async stopGridBot(id) {
    const grid = this.grids.find(g => g.id === id);
    if (!grid) throw new Error('Grid bot not found.');
    grid.status = 'STOPPED';
    grid.updatedAt = new Date().toISOString();
    this.saveGrids();
    this.log(`Stopped Smart Grid Bot ${grid.symbol} (ID: ${id})`, 'info', grid.symbol, id);
    return grid;
  }

  async pauseGridBot(id) {
    const grid = this.grids.find(g => g.id === id);
    if (!grid) throw new Error('Grid bot not found.');
    grid.status = 'PAUSED';
    grid.updatedAt = new Date().toISOString();
    this.saveGrids();
    this.log(`Paused Smart Grid Bot ${grid.symbol} (ID: ${id})`, 'info', grid.symbol, id);
    return grid;
  }

  async resumeGridBot(id) {
    const grid = this.grids.find(g => g.id === id);
    if (!grid) throw new Error('Grid bot not found.');
    grid.status = 'RUNNING';
    grid.updatedAt = new Date().toISOString();
    this.saveGrids();
    this.log(`Resumed Smart Grid Bot ${grid.symbol} (ID: ${id})`, 'info', grid.symbol, id);
    return grid;
  }

  async deleteGridBot(id) {
    const idx = this.grids.findIndex(g => g.id === id);
    if (idx === -1) throw new Error('Grid bot not found.');
    const symbol = this.grids[idx].symbol;
    this.grids.splice(idx, 1);
    this.saveGrids();
    this.log(`Deleted Smart Grid Bot ${symbol} (ID: ${id})`, 'info', symbol, id);
    return true;
  }

  async calculateOBI(symbol) {
    try {
      const depth = await this.mexcClient.getDepth(symbol, 20);
      if (!depth || !depth.bids || !depth.asks || depth.bids.length === 0 || depth.asks.length === 0) {
        return 50;
      }
      let bidVol = 0;
      let askVol = 0;
      depth.bids.forEach(b => { bidVol += parseFloat(b[1]) || 0; });
      depth.asks.forEach(a => { askVol += parseFloat(a[1]) || 0; });

      const total = bidVol + askVol;
      if (total === 0) return 50;
      return (bidVol / total) * 100;
    } catch (e) {
      return 50;
    }
  }

  async calculate40sTakerVolume(symbol) {
    try {
      if (typeof this.mexcClient.getAggTrades === 'function') {
        const trades = await this.mexcClient.getAggTrades(symbol, 40000);
        if (!trades || trades.length === 0) return 50;
        let takerBuy = 0;
        let takerSell = 0;
        trades.forEach(t => {
          const qty = parseFloat(t.qty || t.q) || 0;
          if (t.isBuyerMaker) takerSell += qty;
          else takerBuy += qty;
        });
        const total = takerBuy + takerSell;
        if (total === 0) return 50;
        return (takerBuy / total) * 100;
      }
    } catch (e) {}
    return 55; // Default safe fallback
  }

  async tick() {
    const runningGrids = this.grids.filter(g => g.status === 'RUNNING');
    if (runningGrids.length === 0) return;

    for (const grid of runningGrids) {
      try {
        const currentPrice = await this.mexcClient.getTickerPrice(grid.symbol);
        if (!currentPrice || currentPrice <= 0) continue;

        grid.currentPrice = currentPrice;
        let changed = false;

        // Process each grid level
        for (const level of grid.levels) {
          // A. Process Buy Grid Level
          if (level.side === 'BUY' && (level.status === 'IDLE' || level.status === 'CANCELLED_PRESSURE')) {
            // Price has reached or dropped near this specific Buy Grid level
            const isNearGridLevel = Math.abs(currentPrice - level.price) <= (grid.stepSize * 0.55);
            if (isNearGridLevel && currentPrice <= level.price * 1.001) {
              // Evaluate Absorption Confluence
              let checkedCount = 0;
              let passedCount = 0;

              const obiVal = await this.calculateOBI(grid.symbol);
              const takerVal = await this.calculate40sTakerVolume(grid.symbol);

              if (grid.filterObi) {
                checkedCount++;
                if (obiVal >= 60) passedCount++;
              }

              if (grid.filter40sVolume) {
                checkedCount++;
                if (takerVal >= 60) passedCount++;
              }

              const requiredCount = (grid.consensusMode === 'SMART_CONFLUENCE')
                ? (checkedCount > 1 ? checkedCount - 1 : Math.max(1, checkedCount))
                : checkedCount;

              const confluencePassed = checkedCount === 0 || (passedCount >= requiredCount);

              if (confluencePassed) {
                // Signals ENABLED: Execute Buy at Grid Level!
                level.status = 'BUY_FILLED';
                level.buyExecPrice = currentPrice;
                level.filledAt = new Date().toISOString();
                
                // Immediately calculate target Limit Sell price: ExecPrice * (1 + stepPct/100)
                level.sellTargetPrice = parseFloat((currentPrice * (1 + (grid.stepPct / 100))).toFixed(4));
                level.side = 'SELL'; // Shift level to SELL side for the next loop!
                level.status = 'IDLE'; // Ready for Limit Sell monitoring

                const grossQty = grid.investmentPerGrid / currentPrice;
                this.log(`🎯 [SMART GRID BUY EXECUTED] ${grid.symbol} Grid #${level.index + 1} bought at $${currentPrice.toFixed(4)} USDT (OBI: ${obiVal.toFixed(1)}%, Taker: ${takerVal.toFixed(1)}%). Placed Limit Sell target at $${level.sellTargetPrice.toFixed(4)} USDT (+${grid.stepPct}% TP).`, 'success', grid.symbol, grid.id);
                changed = true;
              } else {
                // Signals FAILED (Heavy Selling Pressure): CANCEL BUY ORDER and let price drop to lower grid!
                if (level.status !== 'CANCELLED_PRESSURE') {
                  level.status = 'CANCELLED_PRESSURE';
                  this.log(`⚠️ [GRID BUY CANCELLED - HEAVY SELLING PRESSURE] ${grid.symbol} Grid #${level.index + 1} @ $${level.price} cancelled (OBI: ${obiVal.toFixed(1)}%, Taker: ${takerVal.toFixed(1)}%). Letting price drop to lower grid!`, 'warning', grid.symbol, grid.id);
                  changed = true;
                }
              }
            }
          }

          // B. Process Sell Grid Level
          else if (level.side === 'SELL' && level.sellTargetPrice) {
            // Price has reached or exceeded the Limit Sell target
            if (currentPrice >= level.sellTargetPrice) {
              const buyPrice = level.buyExecPrice || level.price;
              const sellPrice = currentPrice;
              const qty = grid.investmentPerGrid / buyPrice;
              
              const grossProfitUsdt = (sellPrice - buyPrice) * qty;
              const netProfitUsdt = grossProfitUsdt * 0.998; // 0.20% MEXC fee allowance

              grid.totalNetProfitUsdt = (grid.totalNetProfitUsdt || 0) + netProfitUsdt;
              
              grid.gridHistory.unshift({
                levelIndex: level.index,
                buyPrice,
                sellPrice,
                profitUsdt: parseFloat(netProfitUsdt.toFixed(4)),
                timestamp: new Date().toISOString()
              });

              this.log(`💰 [SMART GRID SELL FILLED] ${grid.symbol} Grid #${level.index + 1} sold at $${sellPrice.toFixed(4)} USDT (Buy: $${buyPrice.toFixed(4)}). Net Profit: +$${netProfitUsdt.toFixed(4)} USDT!`, 'success', grid.symbol, grid.id);

              // Reset level back to BUY side for next dip cycle!
              level.side = 'BUY';
              level.status = 'IDLE';
              level.buyExecPrice = null;
              level.sellTargetPrice = null;
              changed = true;
            }
          }
        }

        if (changed) {
          grid.updatedAt = new Date().toISOString();
          this.saveGrids();
        }
      } catch (gridErr) {
        console.error(`Error processing grid bot ${grid.id}:`, gridErr.message);
      }
    }
  }
}

module.exports = SmartGridTracker;
