import { useState, useEffect } from 'react';
import { Zap, CheckCircle2, ShieldCheck, Globe } from 'lucide-react';

interface ScalpData {
  symbol: string;
  price: number;
  timestamp: string;
  mexcBidsPct: number;
  binanceBidsPct: number;
  avgBidsPct: number;
  volMultiplier: number;
  rsi: number;
  mexcPass: boolean;
  binancePass: boolean;
  consensusVerified: boolean;
  avgObiPass: boolean;
  volPass: boolean;
  rsiPass: boolean;
  signalActive: boolean;
}

interface ScalpRadarProps {
  availableSymbols: string[];
  onSelectSymbol?: (symbol: string) => void;
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

function fmtPrice(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '-';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '-';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  });
}

export default function ScalpRadar({ availableSymbols, onSelectSymbol }: ScalpRadarProps) {
  const [symbol, setSymbol] = useState('ETHUSDT');
  const [data, setData] = useState<ScalpData | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchRadarData = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/scalp-radar/${symbol}`);
        if (res.ok) {
          const json = await res.json();
          if (isMounted) {
            setData(json);
          }
        }
      } catch (e) {
        // Silent catch to avoid spamming console
      }
    };

    fetchRadarData();

    // Poll every 3 seconds independently (ZERO logging in backend operation console)
    const interval = setInterval(fetchRadarData, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [symbol]);

  return (
    <div className="card scalp-radar-card" style={{
      background: data?.signalActive 
        ? 'linear-gradient(135deg, rgba(0, 230, 118, 0.1) 0%, rgba(11, 10, 15, 0.95) 100%)' 
        : 'linear-gradient(135deg, rgba(255, 255, 255, 0.02) 0%, rgba(11, 10, 15, 0.95) 100%)',
      border: `1px solid ${data?.signalActive ? 'rgba(0, 230, 118, 0.4)' : 'var(--border-color)'}`,
      boxShadow: data?.signalActive ? '0 0 20px rgba(0, 230, 118, 0.15)' : 'none',
      marginBottom: '1.5rem',
      transition: 'all 0.4s ease'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.8rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div style={{
            padding: '0.5rem',
            borderRadius: '8px',
            background: data?.signalActive ? 'rgba(0, 230, 118, 0.2)' : 'rgba(0, 242, 254, 0.1)',
            color: data?.signalActive ? 'var(--color-green)' : 'var(--color-cyan)',
            display: 'flex',
            alignItems: 'center'
          }}>
            <Zap size={20} className={data?.signalActive ? 'animate-pulse' : ''} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              Multi-Exchange Scalping Signal Radar
              <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '12px', background: 'rgba(0, 242, 254, 0.12)', color: 'var(--color-cyan)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Globe size={11} /> Binance + MEXC Aggregated
              </span>
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: '0.1rem 0 0 0' }}>
              Cross-exchange consensus scanner comparing global depth (Binance & MEXC) to eliminate single-venue manipulation
            </p>
          </div>
        </div>

        {/* Symbol Selector & Price */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <option value="ETHUSDT">ETHUSDT (Primary)</option>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
            <option value="SUIUSDT">SUIUSDT</option>
            {availableSymbols && availableSymbols
              .filter(s => !['ETHUSDT','BTCUSDT','SOLUSDT','SUIUSDT'].includes(s))
              .slice(0, 15)
              .map(sym => (
                <option value={sym} key={sym}>{sym}</option>
              ))
            }
          </select>

          {data && (
            <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>Live Price</span>
              <strong style={{ fontSize: '0.95rem', color: 'var(--text-primary)' }}>${fmtPrice(data.price)}</strong>
            </div>
          )}
        </div>
      </div>

      {/* Active Signal Banner Alert */}
      {data?.signalActive ? (
        <div style={{
          background: 'linear-gradient(90deg, rgba(0, 230, 118, 0.25) 0%, rgba(0, 230, 118, 0.08) 100%)',
          border: '1px solid rgba(0, 230, 118, 0.5)',
          borderRadius: '10px',
          padding: '0.8rem 1.2rem',
          marginBottom: '1rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.8rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle2 size={24} style={{ color: 'var(--color-green)' }} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <strong style={{ fontSize: '1rem', color: 'var(--color-green)' }}>
                  🚀 SHORT-TERM {data.symbol} BUY SIGNAL ACTIVE!
                </strong>
                {data.consensusVerified && (
                  <span style={{ fontSize: '0.7rem', background: 'rgba(0, 230, 118, 0.2)', color: 'var(--color-green)', padding: '0.1rem 0.4rem', borderRadius: '4px', border: '1px solid rgba(0,230,118,0.4)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    <ShieldCheck size={12} /> BINANCE & MEXC CONSENSUS VERIFIED 🛡️
                  </span>
                )}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Multi-Exchange Liquidity & Indicators Aligned! High probability 30m-1h momentum move.
              </span>
            </div>
          </div>

          {onSelectSymbol && (
            <button
              onClick={() => onSelectSymbol(data.symbol)}
              className="btn btn-success btn-sm"
              style={{
                background: 'linear-gradient(135deg, #00e676 0%, #00b0ff 100%)',
                color: '#0b0a0f',
                fontWeight: 700,
                border: 'none',
                boxShadow: '0 0 12px rgba(0, 230, 118, 0.4)'
              }}
            >
              <Zap size={14} /> Load Form for {data.symbol}
            </button>
          )}
        </div>
      ) : null}

      {/* 4 Multi-Exchange Indicators Gauges Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        
        {/* Metric 1: Binance Liquidity */}
        <div style={{
          background: data?.binancePass ? 'rgba(0, 230, 118, 0.05)' : 'rgba(255, 255, 255, 0.01)',
          border: `1px solid ${data?.binancePass ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
          borderRadius: '8px',
          padding: '0.6rem 0.8rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>1. Binance Bids (&ge;55%)</span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              background: data?.binancePass ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: data?.binancePass ? 'var(--color-green)' : 'var(--text-muted)'
            }}>
              {data?.binancePass ? 'MATCHED 🟢' : 'WAITING ⏳'}
            </span>
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: data?.binancePass ? 'var(--color-green)' : 'var(--text-primary)' }}>
            {data ? `${data.binanceBidsPct}%` : '...'}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Binance Global Liquidity Depth</span>
        </div>

        {/* Metric 2: MEXC Liquidity */}
        <div style={{
          background: data?.mexcPass ? 'rgba(0, 230, 118, 0.05)' : 'rgba(255, 255, 255, 0.01)',
          border: `1px solid ${data?.mexcPass ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
          borderRadius: '8px',
          padding: '0.6rem 0.8rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>2. MEXC Bids (&ge;55%)</span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              background: data?.mexcPass ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: data?.mexcPass ? 'var(--color-green)' : 'var(--text-muted)'
            }}>
              {data?.mexcPass ? 'MATCHED 🟢' : 'WAITING ⏳'}
            </span>
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: data?.mexcPass ? 'var(--color-green)' : 'var(--text-primary)' }}>
            {data ? `${data.mexcBidsPct}%` : '...'}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>MEXC Execution Order Book</span>
        </div>

        {/* Metric 3: Volume Spike */}
        <div style={{
          background: data?.volPass ? 'rgba(0, 230, 118, 0.05)' : 'rgba(255, 255, 255, 0.01)',
          border: `1px solid ${data?.volPass ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
          borderRadius: '8px',
          padding: '0.6rem 0.8rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>3. Volume Spike (&ge;1.5x)</span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              background: data?.volPass ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: data?.volPass ? 'var(--color-green)' : 'var(--text-muted)'
            }}>
              {data?.volPass ? 'MATCHED 🟢' : 'WAITING ⏳'}
            </span>
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: data?.volPass ? 'var(--color-green)' : 'var(--text-primary)' }}>
            {data ? `${data.volMultiplier}x` : '...'}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Current volume vs 5-candle avg</span>
        </div>

        {/* Metric 4: RSI Dip */}
        <div style={{
          background: data?.rsiPass ? 'rgba(0, 230, 118, 0.05)' : 'rgba(255, 255, 255, 0.01)',
          border: `1px solid ${data?.rsiPass ? 'rgba(0, 230, 118, 0.25)' : 'rgba(255, 255, 255, 0.05)'}`,
          borderRadius: '8px',
          padding: '0.6rem 0.8rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>4. RSI Dip Bounce (&le;40)</span>
            <span style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              padding: '0.1rem 0.35rem',
              borderRadius: '4px',
              background: data?.rsiPass ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              color: data?.rsiPass ? 'var(--color-green)' : 'var(--text-muted)'
            }}>
              {data?.rsiPass ? 'MATCHED 🟢' : 'WAITING ⏳'}
            </span>
          </div>
          <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: data?.rsiPass ? 'var(--color-green)' : 'var(--text-primary)' }}>
            {data ? `${data.rsi}` : '...'}
          </div>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Relative Strength Index (14)</span>
        </div>

      </div>
    </div>
  );
}
