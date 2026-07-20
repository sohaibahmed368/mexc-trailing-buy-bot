import { useState } from 'react';
import { AreaChart, HelpCircle, AlertCircle, TrendingUp, TrendingDown, RefreshCw } from 'lucide-react';

interface AnalysisResult {
  symbol: string;
  lowerLimit: number;
  upperLimit: number;
  bids: {
    volume: number;
    value: number;
    percentage: number;
    count: number;
  };
  asks: {
    volume: number;
    value: number;
    percentage: number;
    count: number;
  };
  dominant: 'bids' | 'asks' | 'equal';
  difference: number;
}

interface OrderBookAnalysisProps {
  availableSymbols: string[];
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export default function OrderBookAnalysis({ availableSymbols }: OrderBookAnalysisProps) {
  const [symbol, setSymbol] = useState('MXUSDT');
  const [lowerLimit, setLowerLimit] = useState('');
  const [upperLimit, setUpperLimit] = useState('');
  const [depthLimit, setDepthLimit] = useState('1000');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);

    const parsedLower = parseFloat(lowerLimit);
    const parsedUpper = parseFloat(upperLimit);

    if (isNaN(parsedLower) || parsedLower < 0) {
      setError('Please enter a valid positive lower price limit.');
      return;
    }
    if (isNaN(parsedUpper) || parsedUpper < 0) {
      setError('Please enter a valid positive upper price limit.');
      return;
    }
    if (parsedLower >= parsedUpper) {
      setError('Lower limit must be strictly less than the upper limit.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/analysis/orderflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.toUpperCase().trim(),
          lowerLimit: parsedLower,
          upperLimit: parsedUpper,
          limit: parseInt(depthLimit)
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to analyze order book.');
      }

      const data = await res.json();
      setResult(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred during analysis.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
        {/* Analysis Form */}
        <form onSubmit={handleAnalyze} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', alignItems: 'end', background: 'rgba(255,255,255,0.01)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
          {/* Symbol */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="analysis-symbol">Symbol</label>
            <div className="input-wrapper">
              <input
                id="analysis-symbol"
                type="text"
                list="analysis-symbols-datalist"
                placeholder="e.g. BTCUSDT"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                disabled={loading}
                required
              />
              <datalist id="analysis-symbols-datalist">
                {availableSymbols && availableSymbols.map(sym => (
                  <option value={sym} key={sym} />
                ))}
              </datalist>
            </div>
          </div>

          {/* Lower Price Limit */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="lowerLimit">Lower Price Limit</label>
            <div className="input-wrapper">
              <input
                id="lowerLimit"
                type="number"
                step="any"
                placeholder="e.g. 58000"
                value={lowerLimit}
                onChange={(e) => setLowerLimit(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          {/* Upper Price Limit */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="upperLimit">Upper Price Limit</label>
            <div className="input-wrapper">
              <input
                id="upperLimit"
                type="number"
                step="any"
                placeholder="e.g. 59000"
                value={upperLimit}
                onChange={(e) => setUpperLimit(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          {/* Depth Limit */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="depthLimit" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Depth API Limit
              <span title="Number of bids/asks price levels to query from MEXC. Higher limits inspect wider price bands but take slightly longer." style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={12} />
              </span>
            </label>
            <div className="input-wrapper">
              <select
                id="depthLimit"
                value={depthLimit}
                onChange={(e) => setDepthLimit(e.target.value)}
                disabled={loading}
              >
                <option value="100">100 levels</option>
                <option value="500">500 levels</option>
                <option value="1000">1,000 levels (Standard)</option>
                <option value="2000">2,000 levels</option>
                <option value="5000">5,000 levels (Max Depth)</option>
              </select>
            </div>
          </div>

          {/* Submit */}
          <div>
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', height: '42px' }}>
              {loading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" style={{ animation: 'spin 1s linear infinite' }} /> Analyzing...
                </>
              ) : (
                <>
                  <AreaChart size={16} /> Scan Range
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Errors */}
      {error && (
        <div style={{ color: 'var(--color-red)', background: 'rgba(255, 23, 68, 0.08)', padding: '1rem', borderRadius: '10px', border: '1px solid rgba(255, 23, 68, 0.15)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Loading State without result */}
      {loading && !result && (
        <div className="empty-state" style={{ padding: '4rem 1rem' }}>
          <RefreshCw size={36} className="animate-spin" style={{ animation: 'spin 1.5s linear infinite', color: 'var(--color-cyan)', opacity: 0.8 }} />
          <h3>Fetching order book from MEXC...</h3>
          <p>Scanning depth up to {depthLimit} price levels within range {lowerLimit} to {upperLimit} USDT</p>
        </div>
      )}

      {/* Results Dashboard */}
      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          
          {/* Header Dominance Banner */}
          <div style={{
            background: result.dominant === 'bids' 
              ? 'linear-gradient(to right, rgba(0,230,118,0.1) 0%, rgba(0,0,0,0) 100%)' 
              : result.dominant === 'asks'
                ? 'linear-gradient(to right, rgba(255,23,68,0.1) 0%, rgba(0,0,0,0) 100%)'
                : 'var(--bg-input)',
            border: `1px solid ${
              result.dominant === 'bids' 
                ? 'rgba(0,230,118,0.2)' 
                : result.dominant === 'asks'
                  ? 'rgba(255,23,68,0.2)'
                  : 'var(--border-color)'
            }`,
            borderRadius: '12px',
            padding: '1rem 1.25rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {result.dominant === 'bids' ? (
                <TrendingUp size={24} style={{ color: 'var(--color-green)' }} />
              ) : result.dominant === 'asks' ? (
                <TrendingDown size={24} style={{ color: 'var(--color-red)' }} />
              ) : (
                <AreaChart size={24} style={{ color: 'var(--text-secondary)' }} />
              )}
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>
                  {result.dominant === 'bids' && `BUY SUPPORT DOMINANT (BIDS)`}
                  {result.dominant === 'asks' && `SELL WALL DOMINANT (ASKS)`}
                  {result.dominant === 'equal' && `BALANCED BUY/SELL VOLUME`}
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
                  Analyzed range: ${result.lowerLimit.toLocaleString()} to ${result.upperLimit.toLocaleString()} USDT for {result.symbol}
                </p>
              </div>
            </div>
            
            <div style={{ textAlign: 'right' }}>
              <span style={{ 
                fontSize: '1.5rem', 
                fontWeight: 700, 
                color: result.dominant === 'bids' ? 'var(--color-green)' : result.dominant === 'asks' ? 'var(--color-red)' : 'var(--text-primary)' 
              }}>
                {result.dominant === 'bids' ? result.bids.percentage : result.asks.percentage}%
              </span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Dominance</span>
            </div>
          </div>

          {/* Visual Percentage Bar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <div className="progress-labels" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--color-green)', fontWeight: 600 }}>Buy Bids ({result.bids.percentage}%)</span>
              <span style={{ color: 'var(--color-red)', fontWeight: 600 }}>Sell Asks ({result.asks.percentage}%)</span>
            </div>
            <div style={{
              width: '100%',
              height: '24px',
              backgroundColor: 'var(--bg-input)',
              borderRadius: '6px',
              overflow: 'hidden',
              display: 'flex',
              boxShadow: 'inset 0 1px 5px rgba(0,0,0,0.5)',
              border: '1px solid var(--border-color)'
            }}>
              {result.bids.value === 0 && result.asks.value === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  No open orders found in this price range.
                </div>
              ) : (
                <>
                  <div style={{ 
                    width: `${result.bids.percentage}%`, 
                    backgroundColor: 'rgba(0, 230, 118, 0.75)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    paddingLeft: '0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: '#0b0a0f',
                    transition: 'width 0.3s ease'
                  }}>
                    {result.bids.percentage >= 10 && `${result.bids.percentage}%`}
                  </div>
                  <div style={{ 
                    width: `${result.asks.percentage}%`, 
                    backgroundColor: 'rgba(255, 23, 68, 0.75)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'flex-end',
                    paddingRight: '0.5rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: 'white',
                    transition: 'width 0.3s ease'
                  }}>
                    {result.asks.percentage >= 10 && `${result.asks.percentage}%`}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Aggregated value cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            
            {/* BUY bids card */}
            <div className="card" style={{ background: 'rgba(0,230,118,0.02)', borderColor: 'rgba(0,230,118,0.1)', padding: '1rem 1.25rem' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--color-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', borderBottom: '1px solid rgba(0,230,118,0.1)', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-green)' }} /> Buy Bids Summary
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Total Bid Value</span>
                  <strong style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>
                    ${result.bids.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </strong>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Total Volume</span>
                    <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {result.bids.volume.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Order Levels</span>
                    <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {result.bids.count} levels
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* SELL asks card */}
            <div className="card" style={{ background: 'rgba(255,23,68,0.02)', borderColor: 'rgba(255,23,68,0.1)', padding: '1rem 1.25rem' }}>
              <h4 style={{ fontSize: '0.85rem', color: 'var(--color-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', borderBottom: '1px solid rgba(255,23,68,0.1)', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-red)' }} /> Sell Asks Summary
              </h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block' }}>Total Ask Value</span>
                  <strong style={{ fontSize: '1.2rem', fontFamily: 'var(--font-mono)' }}>
                    ${result.asks.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </strong>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Total Volume</span>
                    <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {result.asks.volume.toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Order Levels</span>
                    <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                      {result.asks.count} levels
                    </span>
                  </div>
                </div>
              </div>
            </div>

          </div>

          {/* Difference & summary */}
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '1rem', fontSize: '0.85rem' }}>
            <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Net Order Flow Delta:</span>
              <strong style={{ 
                color: result.dominant === 'bids' ? 'var(--color-green)' : result.dominant === 'asks' ? 'var(--color-red)' : 'inherit',
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem'
              }}>
                {result.dominant === 'bids' ? '+' : result.dominant === 'asks' ? '-' : ''}
                ${result.difference.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
              </strong>
            </div>
            <p style={{ color: 'var(--text-muted)', lineHeight: '1.4' }}>
              {result.dominant === 'bids' ? (
                <span>
                  Within the range of ${result.lowerLimit.toLocaleString()} to ${result.upperLimit.toLocaleString()} USDT, 
                  there is <strong>${result.difference.toLocaleString()} USDT more buying power (Bids)</strong> than selling power. 
                  This represents a strong buy wall / support zone. Prices are likely to hold or bounce in this region.
                </span>
              ) : result.dominant === 'asks' ? (
                <span>
                  Within the range of ${result.lowerLimit.toLocaleString()} to ${result.upperLimit.toLocaleString()} USDT, 
                  there is <strong>${result.difference.toLocaleString()} USDT more selling power (Asks)</strong> than buying power. 
                  This indicates a strong sell wall / resistance zone. Pushing price above this zone may require heavy volume.
                </span>
              ) : (
                <span>
                  There is an equal balance of buy and sell orders within the price range of ${result.lowerLimit.toLocaleString()} to ${result.upperLimit.toLocaleString()} USDT. No dominant wall is present.
                </span>
              )}
            </p>
          </div>

        </div>
      )}
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
