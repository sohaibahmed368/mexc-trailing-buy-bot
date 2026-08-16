import React, { useState, useEffect } from 'react';
import { Globe, Activity, Layers, Zap } from 'lucide-react';
import io from 'socket.io-client';

interface ExchangeMetric {
  exchangeId: string;
  name: string;
  icon: string;
  rank: number;
  price: number;
  rsi15m: number;
  ema20: number;
  obiPct: number;
  takerBuyPct: number;
  spotBuyVol?: number;
  spotSellVol?: number;
  futBuyVol?: number;
  futSellVol?: number;
  active: boolean;
}

interface SymbolMetrics {
  symbol: string;
  averagePrice: number;
  averageEma20: number;
  averageRsi15m: number;
  averageObiPct: number;
  spotObiPct?: number;
  futObiPct?: number;
  averageTakerBuyPct: number;
  totalSpotBuyVol?: number;
  totalSpotSellVol?: number;
  totalFutBuyVol?: number;
  totalFutSellVol?: number;
  trendStatus: string;
  trendBadge: string;
  trendColor: string;
  exchangesCount: number;
  exchanges: ExchangeMetric[];
}

interface SignalRadarPayload {
  symbols: Record<string, SymbolMetrics>;
  updatedAt: string;
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export const MultiExchangeSignalRadar: React.FC = () => {
  const [data, setData] = useState<SignalRadarPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 1. Initial REST API Fetch
    const fetchRadar = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/signal-radar/metrics`);
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        }
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };

    fetchRadar();

    // 2. 5-Second Fallback Polling Loop
    const intervalId = setInterval(fetchRadar, 5000);

    // 3. WebSocket Real-Time Stream
    const socket = io(BACKEND_URL);
    socket.on('signal_radar_update', (payload: SignalRadarPayload) => {
      setData(payload);
      setLoading(false);
    });

    return () => {
      clearInterval(intervalId);
      socket.disconnect();
    };
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: '1rem', color: '#94a3b8', textAlign: 'center' }}>
        <Activity className="animate-spin" style={{ margin: '0 auto 0.5rem auto' }} size={24} />
        <p style={{ margin: 0, fontSize: '0.85rem' }}>Loading Top 10 Exchanges Signal Radar Dashboard...</p>
      </div>
    );
  }

  const symbolKeys = data?.symbols ? Object.keys(data.symbols) : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'SUIUSDT', 'GOLD(XAUT)USDT', 'XRPUSDT'];

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        border: '1px solid #334155',
        borderRadius: '12px',
        padding: '1.25rem',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
        marginBottom: '1rem'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Globe size={20} style={{ color: '#38bdf8' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem', fontWeight: 800 }}>
            📡 Top 10 Exchanges Signal Radar (Spot + Futures 100-Depth)
          </h3>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: '#020617', padding: '4px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
          Aggregated Live 100-Depth Spot & Futures • 15m RSI • 20 EMA • Taker Flow
        </span>
      </div>

      {/* Symbol Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(310px, 1fr))', gap: '1rem' }}>
        {symbolKeys.map(sym => {
          const m = data?.symbols ? data.symbols[sym] : null;
          const avgObi = m ? m.averageObiPct : 50.0;
          const spotObi = m && m.spotObiPct !== undefined ? m.spotObiPct : avgObi;
          const futObi = m && m.futObiPct !== undefined ? m.futObiPct : avgObi;
          const avgRsi = m ? m.averageRsi15m : 50.0;
          const avgPrice = m ? m.averagePrice : 0;
          const dualGateMatched = (avgObi >= 55.0 && avgRsi <= 40.0);

          return (
            <div
              key={sym}
              style={{
                background: '#020617',
                border: dualGateMatched ? '2px solid #10b981' : '1px solid #1e293b',
                borderRadius: '10px',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                boxShadow: dualGateMatched ? '0 0 15px rgba(16, 185, 129, 0.2)' : 'none'
              }}
            >
              {/* Symbol Name & Price */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800, color: '#38bdf8', fontSize: '1rem' }}>{sym}</span>
                <span style={{ fontWeight: 800, color: '#f8fafc', fontSize: '0.95rem' }}>
                  ${avgPrice ? avgPrice.toLocaleString() : '-'}
                </span>
              </div>

              {/* Combined OBI Bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '4px' }}>
                  <span style={{ color: '#94a3b8', fontWeight: 600 }}>Top 10 Combined (Spot+Fut) OBI</span>
                  <span style={{ fontWeight: 800, color: avgObi >= 55 ? '#10b981' : (avgObi <= 45 ? '#ef4444' : '#f59e0b') }}>
                    {avgObi.toFixed(1)}% {avgObi >= 50 ? '🟢 Buyers' : '🔴 Sellers'}
                  </span>
                </div>
                <div style={{ height: '7px', background: '#334155', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                  <div style={{ width: `${Math.min(100, Math.max(0, avgObi))}%`, background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' }} />
                  <div style={{ width: `${Math.min(100, Math.max(0, 100 - avgObi))}%`, background: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)' }} />
                </div>
              </div>

              {/* Distinct Spot vs Futures OBI Breakdown Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#0b1329', padding: '8px', borderRadius: '8px', border: '1px solid #1e293b' }}>
                {/* Spot OBI */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', marginBottom: '3px' }}>
                    <span style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                      <Layers size={11} /> Spot OBI
                    </span>
                    <span style={{ fontWeight: 800, color: spotObi >= 55 ? '#10b981' : (spotObi <= 45 ? '#ef4444' : '#fbbf24') }}>
                      {spotObi.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, spotObi))}%`, background: '#fbbf24' }} />
                    <div style={{ width: `${Math.min(100, Math.max(0, 100 - spotObi))}%`, background: '#475569' }} />
                  </div>
                </div>

                {/* Futures OBI */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', marginBottom: '3px' }}>
                    <span style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                      <Zap size={11} /> Futures OBI
                    </span>
                    <span style={{ fontWeight: 800, color: futObi >= 55 ? '#10b981' : (futObi <= 45 ? '#ef4444' : '#38bdf8') }}>
                      {futObi.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ height: '4px', background: '#1e293b', borderRadius: '2px', overflow: 'hidden', display: 'flex' }}>
                    <div style={{ width: `${Math.min(100, Math.max(0, futObi))}%`, background: '#38bdf8' }} />
                    <div style={{ width: `${Math.min(100, Math.max(0, 100 - futObi))}%`, background: '#475569' }} />
                  </div>
                </div>
              </div>

              {/* RSI & Taker Flow */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.75rem', background: '#0f172a', padding: '6px 10px', borderRadius: '6px' }}>
                <div>
                  <span style={{ color: '#64748b' }}>4h 15m RSI: </span>
                  <span style={{ fontWeight: 800, color: avgRsi <= 40 ? '#10b981' : '#e2e8f0' }}>{avgRsi.toFixed(1)}</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ color: '#64748b' }}>Taker Buy: </span>
                  <span style={{ fontWeight: 800, color: '#38bdf8' }}>{m ? m.averageTakerBuyPct.toFixed(1) : '50.0'}%</span>
                </div>
              </div>

              {/* Status Badge */}
              <div
                style={{
                  background: dualGateMatched ? 'rgba(16, 185, 129, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                  border: `1px solid ${dualGateMatched ? '#10b981' : '#334155'}`,
                  color: dualGateMatched ? '#10b981' : '#94a3b8',
                  padding: '6px',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '0.75rem',
                  fontWeight: 700
                }}
              >
                {dualGateMatched ? '🎯 DUAL GATE MATCHED (OBI ≥55% & RSI ≤40)' : '⚡ SCANNING TOP 10 EXCHANGES...'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
