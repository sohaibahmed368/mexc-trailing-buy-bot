const axios = require('axios');

class AlpacaClient {
  constructor() {
    this.apiKey = process.env.ALPACA_API_KEY_ID || '';
    this.secretKey = process.env.ALPACA_SECRET_KEY || '';
    this.isPaper = process.env.ALPACA_IS_PAPER !== 'false';
    this.baseUrl = this.isPaper 
      ? 'https://paper-api.alpaca.markets' 
      : 'https://api.alpaca.markets';
    this.dataUrl = 'https://data.alpaca.markets';
  }

  setCredentials(apiKey, secretKey, isPaper = true) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.isPaper = isPaper;
    this.baseUrl = isPaper 
      ? 'https://paper-api.alpaca.markets' 
      : 'https://api.alpaca.markets';
  }

  hasCredentials() {
    return !!(this.apiKey && this.secretKey);
  }

  getHeaders() {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.secretKey,
      'Content-Type': 'application/json'
    };
  }

  // Get Account Information (Buying power, Cash balance, Portfolio Value)
  async getAccount() {
    if (!this.hasCredentials()) {
      throw new Error('Alpaca API credentials not configured.');
    }
    try {
      const res = await axios.get(`${this.baseUrl}/v2/account`, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      return res.data;
    } catch (err) {
      const msg = err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : err.message;
      throw new Error(`Alpaca Account Error: ${msg}`);
    }
  }

  // Fetch Latest Trade / Bar Price for a Stock Symbol
  async getTickerPrice(symbol) {
    const cleanSym = symbol.toUpperCase().replace('USDT', '');
    
    // First try Data API for real-time trade
    if (this.hasCredentials()) {
      try {
        const res = await axios.get(`${this.dataUrl}/v2/stocks/${cleanSym}/trades/latest`, {
          headers: this.getHeaders(),
          timeout: 4000
        });
        if (res.data && res.data.trade && res.data.trade.p) {
          return parseFloat(res.data.trade.p);
        }
      } catch (e) {}
    }

    // Fallback public bar query / market ticker
    try {
      const res = await axios.get(`${this.dataUrl}/v2/stocks/${cleanSym}/bars/latest`, {
        headers: this.hasCredentials() ? this.getHeaders() : {},
        timeout: 4000
      });
      if (res.data && res.data.bar && res.data.bar.c) {
        return parseFloat(res.data.bar.c);
      }
    } catch (e) {}

    // Simulated fallback price for common stocks if market is closed or unauthenticated
    const fallbackPrices = {
      'USO': 76.50,   // United States Oil Fund (WTI Crude Oil ETF)
      'BNO': 81.20,   // United States Brent Oil Fund (Brent Crude Oil ETF)
      'GLD': 222.40,  // SPDR Gold Shares ETF
      'IAU': 45.20,   // iShares Gold Trust ETF
      'XLE': 88.30,   // Energy Sector ETF
      'NVDA': 122.50,
      'AAPL': 224.30,
      'TSLA': 248.80,
      'MSFT': 445.20,
      'SPY': 552.10,
      'AMZN': 185.60,
      'QQQ': 480.50,
      'AMD': 155.40
    };
    return fallbackPrices[cleanSym] || 76.50;
  }

  // Place Order on Alpaca (Market, Limit, Fractional)
  async placeOrder(params) {
    if (!this.hasCredentials()) {
      throw new Error('Alpaca API credentials not configured.');
    }
    try {
      const body = {
        symbol: params.symbol.toUpperCase().replace('USDT', ''),
        side: params.side.toLowerCase(),
        type: params.type.toLowerCase(), // 'market' or 'limit'
        time_in_force: params.time_in_force || 'gtc'
      };

      if (params.quantity || params.qty) {
        body.qty = String(params.quantity || params.qty);
      } else if (params.quoteOrderQty || params.notional) {
        body.notional = String(params.quoteOrderQty || params.notional);
      }

      if (params.limit_price || params.price) {
        body.limit_price = String(params.limit_price || params.price);
      }

      const res = await axios.post(`${this.baseUrl}/v2/orders`, body, {
        headers: this.getHeaders(),
        timeout: 8000
      });
      return res.data;
    } catch (err) {
      const msg = err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : err.message;
      throw new Error(`Alpaca Order Placement Error: ${msg}`);
    }
  }

  // Get Order Details & Fills
  async getOrder(orderId) {
    if (!this.hasCredentials()) {
      throw new Error('Alpaca API credentials not configured.');
    }
    try {
      const res = await axios.get(`${this.baseUrl}/v2/orders/${orderId}`, {
        headers: this.getHeaders(),
        timeout: 5000
      });
      return res.data;
    } catch (err) {
      const msg = err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : err.message;
      throw new Error(`Alpaca Get Order Error: ${msg}`);
    }
  }

  // Cancel Order
  async cancelOrder(orderId) {
    if (!this.hasCredentials()) {
      throw new Error('Alpaca API credentials not configured.');
    }
    try {
      const res = await axios.delete(`${this.baseUrl}/v2/orders/${orderId}`, {
        headers: this.getHeaders(),
        timeout: 5000
      });
      return res.data;
    } catch (err) {
      const msg = err.response && err.response.data && err.response.data.message
        ? err.response.data.message
        : err.message;
      throw new Error(`Alpaca Cancel Order Error: ${msg}`);
    }
  }

  // Get All Tradeable Assets from Alpaca API (/v2/assets)
  async getAssets(status = 'active') {
    if (this.hasCredentials()) {
      try {
        const res = await axios.get(`${this.baseUrl}/v2/assets`, {
          params: { status },
          headers: this.getHeaders(),
          timeout: 10000
        });
        if (Array.isArray(res.data)) {
          return res.data
            .filter(a => a.tradable)
            .map(a => ({ symbol: a.symbol, name: a.name, class: a.class }));
        }
      } catch (err) {}
    }
    return this.getFallbackAssets();
  }

  getFallbackAssets() {
    return [
      // Major Stocks
      { symbol: 'NVDA', name: 'NVIDIA Corporation', class: 'us_equity' },
      { symbol: 'AAPL', name: 'Apple Inc.', class: 'us_equity' },
      { symbol: 'TSLA', name: 'Tesla Inc.', class: 'us_equity' },
      { symbol: 'MSFT', name: 'Microsoft Corporation', class: 'us_equity' },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', class: 'us_equity' },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', class: 'us_equity' },
      { symbol: 'META', name: 'Meta Platforms Inc.', class: 'us_equity' },
      { symbol: 'NFLX', name: 'Netflix Inc.', class: 'us_equity' },
      { symbol: 'AMD', name: 'Advanced Micro Devices Inc.', class: 'us_equity' },
      { symbol: 'PLTR', name: 'Palantir Technologies Inc.', class: 'us_equity' },
      { symbol: 'COIN', name: 'Coinbase Global Inc.', class: 'us_equity' },
      { symbol: 'BAC', name: 'Bank of America Corp.', class: 'us_equity' },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', class: 'us_equity' },
      { symbol: 'INTC', name: 'Intel Corporation', class: 'us_equity' },
      { symbol: 'ORCL', name: 'Oracle Corporation', class: 'us_equity' },
      { symbol: 'DIS', name: 'The Walt Disney Company', class: 'us_equity' },
      { symbol: 'BA', name: 'The Boeing Company', class: 'us_equity' },
      { symbol: 'XOM', name: 'Exxon Mobil Corporation', class: 'us_equity' },
      { symbol: 'CVX', name: 'Chevron Corporation', class: 'us_equity' },
      { symbol: 'PEP', name: 'PepsiCo Inc.', class: 'us_equity' },
      { symbol: 'KO', name: 'The Coca-Cola Company', class: 'us_equity' },
      { symbol: 'MSTR', name: 'MicroStrategy Inc.', class: 'us_equity' },
      { symbol: 'SMCI', name: 'Super Micro Computer Inc.', class: 'us_equity' },
      
      // Oil & Commodities ETFs
      { symbol: 'USO', name: 'United States Oil Fund (WTI Oil)', class: 'us_equity' },
      { symbol: 'BNO', name: 'United States Brent Oil Fund', class: 'us_equity' },
      { symbol: 'XLE', name: 'Energy Select Sector SPDR Fund', class: 'us_equity' },
      { symbol: 'XOP', name: 'SPDR S&P Oil & Gas Exploration ETF', class: 'us_equity' },
      { symbol: 'OIH', name: 'VanEck Oil Services ETF', class: 'us_equity' },
      
      // Gold & Metals ETFs
      { symbol: 'GLD', name: 'SPDR Gold Shares', class: 'us_equity' },
      { symbol: 'IAU', name: 'iShares Gold Trust', class: 'us_equity' },
      { symbol: 'GLDM', name: 'SPDR Gold MiniShares Trust', class: 'us_equity' },
      { symbol: 'SLV', name: 'iShares Silver Trust', class: 'us_equity' },
      { symbol: 'GDX', name: 'VanEck Gold Miners ETF', class: 'us_equity' },

      // Index ETFs
      { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', class: 'us_equity' },
      { symbol: 'QQQ', name: 'Invesco QQQ Trust (Nasdaq 100)', class: 'us_equity' },
      { symbol: 'IWM', name: 'iShares Russell 2000 ETF', class: 'us_equity' },

      // Crypto Spot Pairs
      { symbol: 'BTCUSD', name: 'Bitcoin / USD', class: 'crypto' },
      { symbol: 'ETHUSD', name: 'Ethereum / USD', class: 'crypto' },
      { symbol: 'SOLUSD', name: 'Solana / USD', class: 'crypto' },
      { symbol: 'DOGEUSD', name: 'Dogecoin / USD', class: 'crypto' },
      { symbol: 'AVAXUSD', name: 'Avalanche / USD', class: 'crypto' },
      { symbol: 'LINKUSD', name: 'Chainlink / USD', class: 'crypto' }
    ];
  }

  // Get Current Open Positions
  async getPositions() {
    if (!this.hasCredentials()) return [];
    try {
      const res = await axios.get(`${this.baseUrl}/v2/positions`, {
        headers: this.getHeaders(),
        timeout: 5000
      });
      return res.data;
    } catch (err) {
      return [];
    }
  }
}

module.exports = AlpacaClient;
