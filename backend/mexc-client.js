const crypto = require('crypto');
const axios = require('axios');

class MexcClient {
  constructor(apiKey = null, secretKey = null) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
    this.baseUrl = 'https://api.mexc.com';
    this.timeOffset = 0; // Difference in ms between MEXC server time and local system clock
  }

  setCredentials(apiKey, secretKey) {
    this.apiKey = apiKey;
    this.secretKey = secretKey;
  }

  hasCredentials() {
    return !!(this.apiKey && this.secretKey);
  }

  // Synchronize local time with MEXC server time to prevent Error 700003 (recvWindow)
  async syncTimeOffset() {
    try {
      const response = await axios.get(`${this.baseUrl}/api/v3/time`, { timeout: 5000 });
      if (response.data && response.data.serverTime) {
        const mexcTime = response.data.serverTime;
        const localTime = Date.now();
        this.timeOffset = mexcTime - localTime;
      }
    } catch (e) {
      // Fallback offset 0 if network time check fails
    }
  }

  // Internal helper to make signed requests (GET/POST)
  async _request(method, endpoint, params = {}, isPrivate = false) {
    const url = `${this.baseUrl}${endpoint}`;
    
    let headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    let queryParams = { ...params };

    if (isPrivate) {
      if (!this.apiKey || !this.secretKey) {
        throw new Error('API Key or Secret Key is not configured.');
      }
      headers['X-MEXC-APIKEY'] = this.apiKey;
      
      // Auto-sync time offset on initial private call
      if (!this.timeOffsetSynced) {
        this.timeOffsetSynced = true;
        await this.syncTimeOffset();
      }

      // Add timestamp + 60s recvWindow to private requests
      queryParams.timestamp = Date.now() + (this.timeOffset || 0);
      queryParams.recvWindow = 60000;

      // Build query string for signing
      const buildSignedUrl = (qParams) => {
        const sortedKeys = Object.keys(qParams).sort();
        const urlParams = new URLSearchParams();
        sortedKeys.forEach(key => {
          urlParams.append(key, qParams[key].toString());
        });
        const queryString = urlParams.toString();
        const signature = crypto
          .createHmac('sha256', this.secretKey)
          .update(queryString)
          .digest('hex');
        urlParams.append('signature', signature);
        return `${url}?${urlParams.toString()}`;
      };

      const requestUrl = buildSignedUrl(queryParams);
      
      try {
        const response = await axios({
          method,
          url: requestUrl,
          headers,
          data: {},
          timeout: 10000
        });
        return response.data;
      } catch (error) {
        let errorMsg = error.message;
        if (error.response && error.response.data) {
          if (typeof error.response.data === 'string' && error.response.data.includes('Access Denied')) {
            errorMsg = 'MEXC WAF Rate Limit / Access Denied (Akamai Shield). Retrying...';
          } else {
            errorMsg = JSON.stringify(error.response.data);
          }
        }

        // Auto-healing retry for Error 700003 (recvWindow time drift):
        if (errorMsg.includes('700003') || errorMsg.includes('recvWindow')) {
          try {
            await this.syncTimeOffset();
            queryParams.timestamp = Date.now() + (this.timeOffset || 0);
            const retryUrl = buildSignedUrl(queryParams);
            const retryRes = await axios({ method, url: retryUrl, headers, data: {}, timeout: 10000 });
            return retryRes.data;
          } catch (retryErr) {
            throw new Error(`MEXC API Error: ${retryErr.message}`);
          }
        }

        throw new Error(`MEXC API Error: ${errorMsg}`);
      }
    } else {
      // Public Request
      try {
        const response = await axios({
          method,
          url,
          params: queryParams,
          headers,
          timeout: 10000
        });
        return response.data;
      } catch (error) {
        let errorMsg = error.message;
        if (error.response && error.response.data) {
          if (typeof error.response.data === 'string' && error.response.data.includes('Access Denied')) {
            errorMsg = 'MEXC WAF Rate Limit / Access Denied (Akamai Shield). Retrying...';
          } else {
            errorMsg = JSON.stringify(error.response.data);
          }
        }
        throw new Error(`MEXC Public API Error: ${errorMsg}`);
      }
    }
  }

  // Public Endpoints
  async getTickerPrice(symbol) {
    const data = await this._request('GET', '/api/v3/ticker/price', { symbol: symbol.toUpperCase() }, false);
    return parseFloat(data.price);
  }

  async getAllTickerPrices() {
    return await this._request('GET', '/api/v3/ticker/price', {}, false);
  }

  async getExchangeInfo() {
    return await this._request('GET', '/api/v3/exchangeInfo', {}, false);
  }

  async getDepth(symbol, limit = 100) {
    return await this._request('GET', '/api/v3/depth', { symbol: symbol.toUpperCase(), limit }, false);
  }

  async getRecentTrades(symbol, limit = 100) {
    return await this._request('GET', '/api/v3/trades', { symbol: symbol.toUpperCase(), limit }, false);
  }

  async getKlines(symbol, interval, limit = 500) {
    return await this._request('GET', '/api/v3/klines', { symbol: symbol.toUpperCase(), interval, limit }, false);
  }

  async testConnection() {
    // Attempt to fetch account balances to verify credentials
    try {
      await this.getBalances();
      return true;
    } catch (error) {
      throw new Error(`API Connection failed: ${error.message}`);
    }
  }

  // Private Endpoints
  async getBalances() {
    const data = await this._request('GET', '/api/v3/account', {}, true);
    if (data && data.balances) {
      return data.balances.map(b => ({
        asset: b.asset,
        free: parseFloat(b.free),
        locked: parseFloat(b.locked)
      })).filter(b => b.free > 0 || b.locked > 0);
    }
    return [];
  }

  async placeOrder({ symbol, side, type, quantity, quoteOrderQty, price }) {
    const params = {
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase(), // BUY or SELL
      type: type.toUpperCase()   // LIMIT or MARKET
    };

    if (type.toUpperCase() === 'MARKET') {
      if (side.toUpperCase() === 'BUY') {
        if (quoteOrderQty) {
          params.quoteOrderQty = quoteOrderQty; // spend this amount of quote asset (e.g. USDT)
        } else if (quantity) {
          params.quantity = quantity; // buy this amount of base asset (e.g. BTC)
        } else {
          throw new Error('For MARKET BUY, either quantity or quoteOrderQty is required.');
        }
      } else {
        // MARKET SELL
        if (quantity) {
          params.quantity = quantity;
        } else {
          throw new Error('For MARKET SELL, quantity is required.');
        }
      }
    } else if (type.toUpperCase() === 'LIMIT') {
      if (!quantity || !price) {
        throw new Error('For LIMIT orders, both quantity and price are required.');
      }
      params.quantity = quantity;
      params.price = price;
      params.timeInForce = 'GTC'; // Good Til Cancelled
    }

    return await this._request('POST', '/api/v3/order', params, true);
  }

  async getOrder(symbol, orderId) {
    return await this._request('GET', '/api/v3/order', {
      symbol: symbol.toUpperCase(),
      orderId
    }, true);
  }

  async cancelOrder(symbol, orderId) {
    return await this._request('DELETE', '/api/v3/order', {
      symbol: symbol.toUpperCase(),
      orderId
    }, true);
  }

  // Query account specific trade fee rates from MEXC API
  async getTradeFee(symbol) {
    if (!this.hasCredentials()) {
      return { makerCommission: 0.0004, takerCommission: 0.0000 };
    }
    try {
      const data = await this._request('GET', '/api/v3/tradeFee', { symbol: symbol.toUpperCase() }, true);
      if (Array.isArray(data) && data.length > 0) {
        return {
          makerCommission: parseFloat(data[0].makerCommission) || 0.0004,
          takerCommission: parseFloat(data[0].takerCommission) || 0.0000
        };
      }
      if (data && data.makerCommission !== undefined) {
        return {
          makerCommission: parseFloat(data.makerCommission) || 0.0004,
          takerCommission: parseFloat(data.takerCommission) || 0.0000
        };
      }
    } catch (err) {
      // Fallback to user account default: 0% Taker promotion, 0.04% MX discount Maker fee
    }
    return { makerCommission: 0.0004, takerCommission: 0.0000 };
  }

  async getMyTrades(symbol, limit = 1000) {
    return await this._request('GET', '/api/v3/myTrades', {
      symbol: symbol.toUpperCase(),
      limit
    }, true);
  }
}

module.exports = MexcClient;
