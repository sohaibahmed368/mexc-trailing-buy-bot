const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const MexcClient = require('./mexc-client');
const OrderTracker = require('./tracker');

const app = express();
const server = http.createServer(app);

// Configure CORS to support frontend dev server on port 3000
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

app.use(cors());
app.use(express.json());

// Initialize MEXC client and Tracker
const mexcClient = new MexcClient();
const tracker = new OrderTracker(mexcClient, io);

// Port configuration
const PORT = process.env.PORT || 3001;

// Path variables
const configDir = path.join(__dirname, 'config');
const credentialsPath = path.join(configDir, 'credentials.json');

// Ensure config dir exists
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// 1. Load saved credentials on startup (env variables take priority for cloud deployments)
let savedConfig = { apiKey: '', secretKey: '', saveToDisk: false };

if (process.env.MEXC_API_KEY && process.env.MEXC_SECRET_KEY) {
  savedConfig = {
    apiKey: process.env.MEXC_API_KEY,
    secretKey: process.env.MEXC_SECRET_KEY,
    saveToDisk: false
  };
  mexcClient.setCredentials(process.env.MEXC_API_KEY, process.env.MEXC_SECRET_KEY);
  tracker.log('API keys configured via Environment Variables (Cloud Mode).', 'success');
} else if (fs.existsSync(credentialsPath)) {
  try {
    savedConfig = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    if (savedConfig.apiKey && savedConfig.secretKey) {
      mexcClient.setCredentials(savedConfig.apiKey, savedConfig.secretKey);
      tracker.log('Loaded API keys from local credentials file.', 'success');
    }
  } catch (e) {
    tracker.log(`Failed to load credentials file: ${e.message}`, 'error');
  }
}

// Start tracking immediately if there are running orders from storage
tracker.startTracking();

// Cache trading symbols from MEXC on startup
let symbolsCache = [];
async function loadSymbolsCache() {
  try {
    const info = await mexcClient.getExchangeInfo();
    if (info && Array.isArray(info.symbols)) {
      // Filter for online USDT trading pairs
      symbolsCache = info.symbols
        .filter(s => s.quoteAsset === 'USDT' && (s.status === '1' || s.status === 'ENABLED' || s.status === 'TRADING' || s.status === 'online'))
        .map(s => s.symbol)
        .sort();
      tracker.log(`Successfully cached ${symbolsCache.length} active USDT trading pairs from MEXC.`, 'success');
    }
  } catch (e) {
    tracker.log(`Failed to load exchange symbols: ${e.message}. Using standard fallback pairs.`, 'error');
    // Fallback list of major pairs
    symbolsCache = ['BTCUSDT', 'ETHUSDT', 'MXUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'AVAXUSDT'];
  }
}
loadSymbolsCache();

// API Endpoints

// Get config state (without revealing secret keys fully)
app.get('/api/config', (req, res) => {
  const isEnv = !!(process.env.MEXC_API_KEY && process.env.MEXC_SECRET_KEY);
  res.json({
    hasCredentials: mexcClient.hasCredentials(),
    apiKey: isEnv 
      ? '[Environment Variable]' 
      : (savedConfig.apiKey ? `${savedConfig.apiKey.substring(0, 6)}...${savedConfig.apiKey.substring(savedConfig.apiKey.length - 4)}` : ''),
    saveToDisk: savedConfig.saveToDisk,
    pollInterval: tracker.pollInterval
  });
});

// Get available trading symbols
app.get('/api/symbols', (req, res) => {
  res.json(symbolsCache);
});

// Update credentials
app.post('/api/config', async (req, res) => {
  const { apiKey, secretKey, saveToDisk } = req.body;

  if (!apiKey || !secretKey) {
    return res.status(400).json({ error: 'API Key and Secret Key are required.' });
  }

  try {
    // Temp client to test connection before applying
    const testClient = new MexcClient(apiKey, secretKey);
    await testClient.testConnection();

    // Verification succeeded, apply configuration
    mexcClient.setCredentials(apiKey, secretKey);
    savedConfig = { apiKey, secretKey, saveToDisk };

    if (saveToDisk) {
      fs.writeFileSync(credentialsPath, JSON.stringify(savedConfig, null, 2));
      tracker.log('API credentials saved to disk.', 'success');
    } else {
      // Remove credentials from disk if user opted out
      if (fs.existsSync(credentialsPath)) {
        fs.unlinkSync(credentialsPath);
      }
      tracker.log('API credentials updated in memory only.', 'success');
    }

    res.json({ success: true, message: 'API Credentials updated and verified successfully.' });
  } catch (error) {
    tracker.log(`Credentials update failed: ${error.message}`, 'error');
    res.status(400).json({ error: error.message });
  }
});

// Remove credentials
app.delete('/api/config', (req, res) => {
  mexcClient.setCredentials(null, null);
  savedConfig = { apiKey: '', secretKey: '', saveToDisk: false };
  
  if (fs.existsSync(credentialsPath)) {
    fs.unlinkSync(credentialsPath);
  }
  
  tracker.log('API credentials deleted.', 'warning');
  res.json({ success: true, message: 'API Credentials removed.' });
});

// Test connection endpoint
app.post('/api/config/test', async (req, res) => {
  const { apiKey, secretKey } = req.body;
  
  try {
    const testClient = new MexcClient(apiKey, secretKey);
    const balances = await testClient.getBalances();
    res.json({ success: true, balances });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Fetch balances and calculate total USDT asset value
app.get('/api/balances', async (req, res) => {
  if (!mexcClient.hasCredentials()) {
    return res.status(400).json({ error: 'API Credentials not configured.' });
  }
  try {
    const [balances, tickerPrices] = await Promise.all([
      mexcClient.getBalances(),
      mexcClient.getAllTickerPrices()
    ]);

    // Create a map of symbol prices for fast lookup
    const priceMap = new Map();
    if (Array.isArray(tickerPrices)) {
      tickerPrices.forEach(p => {
        priceMap.set(p.symbol, parseFloat(p.price));
      });
    }

    let totalUsdt = 0;
    const enrichedBalances = balances.map(b => {
      const total = b.free + b.locked;
      let price = 0;
      let estUsdtValue = 0;

      if (b.asset === 'USDT' || b.asset === 'USD') {
        price = 1;
        estUsdtValue = total;
      } else {
        const symbol = `${b.asset}USDT`;
        if (priceMap.has(symbol)) {
          price = priceMap.get(symbol);
          estUsdtValue = total * price;
        }
      }

      totalUsdt += estUsdtValue;

      return {
        ...b,
        price,
        estUsdtValue: parseFloat(estUsdtValue.toFixed(4))
      };
    });

    // Sort balances: USDT/USD first, then highest value, then alphabetical
    enrichedBalances.sort((a, b) => {
      if (a.asset === 'USDT' || a.asset === 'USD') return -1;
      if (b.asset === 'USDT' || b.asset === 'USD') return 1;
      if (b.estUsdtValue !== a.estUsdtValue) {
        return b.estUsdtValue - a.estUsdtValue;
      }
      return a.asset.localeCompare(b.asset);
    });

    res.json({
      totalUsdt: parseFloat(totalUsdt.toFixed(2)),
      balances: enrichedBalances
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get orders list
app.get('/api/orders', (req, res) => {
  res.json(tracker.getOrders());
});

// Create trailing stop order
app.post('/api/orders', async (req, res) => {
  const { symbol, trailValue, quantity, quoteOrderQty, orderType, dryRun, activationPrice, takeProfit, stopLoss, filterSmartSl, slBuffer, filterObi, filterVolume, filterRsi, autoRepeat, activationOffset, startImmediately } = req.body;
  
  try {
    const order = await tracker.addOrder({
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
      filterObi,
      filterVolume,
      filterRsi,
      autoRepeat,
      activationOffset,
      startImmediately
    });
    res.json(order);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Cancel trailing stop order
app.delete('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await tracker.cancelOrder(id);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Clear historical orders
app.delete('/api/orders', (req, res) => {
  try {
    tracker.clearHistory();
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Fetch logs
app.get('/api/logs', (req, res) => {
  res.json(tracker.getLogs());
});

// Update polling interval
app.post('/api/settings/interval', (req, res) => {
  const { interval } = req.body;
  if (!interval || isNaN(interval) || interval < 200) {
    return res.status(400).json({ error: 'Interval must be a number and at least 200ms.' });
  }
  tracker.setPollInterval(parseInt(interval));
  res.json({ success: true, pollInterval: tracker.pollInterval });
});

// Order book range analysis endpoint
app.post('/api/analysis/orderflow', async (req, res) => {
  const { symbol, lowerLimit, upperLimit, limit } = req.body;

  if (!symbol || lowerLimit === undefined || upperLimit === undefined) {
    return res.status(400).json({ error: 'Symbol, lowerLimit, and upperLimit are required.' });
  }

  const parsedLower = parseFloat(lowerLimit);
  const parsedUpper = parseFloat(upperLimit);
  const parsedLimit = limit ? parseInt(limit) : 1000;

  if (isNaN(parsedLower) || isNaN(parsedUpper) || parsedLower < 0 || parsedUpper < 0) {
    return res.status(400).json({ error: 'Limits must be positive numbers.' });
  }

  if (parsedLower >= parsedUpper) {
    return res.status(400).json({ error: 'Lower limit must be less than upper limit.' });
  }

  try {
    const depth = await mexcClient.getDepth(symbol, parsedLimit);
    
    let bidsCount = 0;
    let totalBidsVolume = 0;
    let totalBidsValue = 0;

    let asksCount = 0;
    let totalAsksVolume = 0;
    let totalAsksValue = 0;

    if (depth && Array.isArray(depth.bids)) {
      depth.bids.forEach(([priceStr, qtyStr]) => {
        const price = parseFloat(priceStr);
        const qty = parseFloat(qtyStr);
        if (price >= parsedLower && price <= parsedUpper) {
          bidsCount++;
          totalBidsVolume += qty;
          totalBidsValue += (price * qty);
        }
      });
    }

    if (depth && Array.isArray(depth.asks)) {
      depth.asks.forEach(([priceStr, qtyStr]) => {
        const price = parseFloat(priceStr);
        const qty = parseFloat(qtyStr);
        if (price >= parsedLower && price <= parsedUpper) {
          asksCount++;
          totalAsksVolume += qty;
          totalAsksValue += (price * qty);
        }
      });
    }

    const totalValue = totalBidsValue + totalAsksValue;
    let bidsPercentage = 0;
    let asksPercentage = 0;
    let dominant = 'equal';

    if (totalValue > 0) {
      bidsPercentage = parseFloat(((totalBidsValue / totalValue) * 100).toFixed(1));
      asksPercentage = parseFloat(((totalAsksValue / totalValue) * 100).toFixed(1));
      if (totalBidsValue > totalAsksValue) {
        dominant = 'bids';
      } else if (totalAsksValue > totalBidsValue) {
        dominant = 'asks';
      }
    }

    res.json({
      symbol: symbol.toUpperCase(),
      lowerLimit: parsedLower,
      upperLimit: parsedUpper,
      bids: {
        volume: parseFloat(totalBidsVolume.toFixed(6)),
        value: parseFloat(totalBidsValue.toFixed(2)),
        percentage: bidsPercentage,
        count: bidsCount
      },
      asks: {
        volume: parseFloat(totalAsksVolume.toFixed(6)),
        value: parseFloat(totalAsksValue.toFixed(2)),
        percentage: asksPercentage,
        count: asksCount
      },
      dominant,
      difference: parseFloat(Math.abs(totalBidsValue - totalAsksValue).toFixed(2))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend build in production
const frontendBuildPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
}

// Socket connection
io.on('connection', (socket) => {
  socket.emit('orders_update', tracker.getOrders());
  socket.emit('logs_init', tracker.getLogs());
  
  socket.on('disconnect', () => {
    // console.log('Client disconnected');
  });
});

// Start Server
server.listen(PORT, () => {
  tracker.log(`MEXC Trailing Buy Bot Server is running on port ${PORT}`, 'success');
});
