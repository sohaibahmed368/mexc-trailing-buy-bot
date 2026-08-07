import React, { useState, useEffect } from 'react';
import { Clock, ShieldAlert, ShieldCheck, Activity } from 'lucide-react';
import io from 'socket.io-client';

interface StockMetric {
  symbol: string;
  name: string;
  price: number;
  bidPrice: number;
  askPrice: number;
  bidVol: number;
  askVol: number;
  obiPct: number;
  rsi4h: number;
  buyerDominant: boolean;
  dualGateMatched: boolean;
  updatedAt: string;
}

interface UsMarketSession {
  code: string;
  label: string;
  color: string;
  nyTimeStr: string;
}

interface LiveStreamPayload {
  session: UsMarketSession;
  pktTimeStr: string;
  stocks: StockMetric[];
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export const RealUSStockBoard: React.FC = () => {
  const [data, setData] = useState<LiveStreamPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    // 1. Initial REST API Fetch
    const fetchInitialData = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/real-us-stocks/live`);
        const json = await res.json();
        if (json.success && json.data) {
          setData(json.data);
        }
      } catch (err: any) {}
      finally {
        setLoading(false);
      }
    };

    fetchInitialData();

    // 2. Real-time WebSocket 1-Second Stream Connection
    const socket = io(BACKEND_URL);
    socket.on('real_us_stocks_update', (payload: LiveStreamPayload) => {
      setData(payload);
      setLoading(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: '2rem', color: '#94a3b8', textAlign: 'center' }}>
        <Activity className="animate-spin" style={{ margin: '0 auto 1rem auto' }} size={32} />
        <p>Connecting to Live Real Wall Street Stock Engine...</p>
      </div>
    );
  }

  const session = data?.session || {
    code: 'PRE_MARKET',
    label: '🟡 PRE-MARKET SESSION',
    color: '#f59e0b',
    nyTimeStr: 'N/A'
  };

  const pktTimeStr = data?.pktTimeStr || new Date().toLocaleString();
  const stocks = data?.stocks || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* 🏛️ Header Banner: Clock & US Market Session Status */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '1.25rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '1.5rem' }}>🏛️</span>
            <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.4rem', fontWeight: 800 }}>
              Real USA Wall Street Stock Live Board
            </h2>
          </div>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.85rem' }}>
            Direct Alpaca Markets NASDAQ Data Stream • 100-Level Order Book Depth • Real-Time OBI & 4h 15m RSI
          </p>
        </div>

        {/* Live Clock & Session Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#020617',
              border: '1px solid #1e293b',
              padding: '6px 12px',
              borderRadius: '8px',
              color: '#e2e8f0',
              fontSize: '0.85rem',
              fontWeight: 600
            }}
          >
            <Clock size={16} style={{ color: '#38bdf8' }} />
            <span>PKT: {pktTimeStr}</span>
          </div>

          <div
            style={{
              background: `${session.color}15`,
              border: `1px solid ${session.color}`,
              color: session.color,
              padding: '8px 16px',
              borderRadius: '8px',
              fontWeight: 800,
              fontSize: '0.9rem',
              letterSpacing: '0.5px'
            }}
          >
            {session.label}
          </div>
        </div>
      </div>

      {/* 📈 Live US Stock Grid Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '1.25rem'
        }}
      >
        {stocks.map((s) => {
          return (
            <div
              key={s.symbol}
              style={{
                background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
                border: s.dualGateMatched ? '2px solid #10b981' : '1px solid #334155',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                position: 'relative',
                boxShadow: s.dualGateMatched
                  ? '0 0 20px rgba(16, 185, 129, 0.2)'
                  : '0 2px 8px rgba(0, 0, 0, 0.2)'
              }}
            >
              {/* Stock Title Bar */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#38bdf8' }}>{s.symbol}</span>
                    <span style={{ color: '#64748b', fontSize: '0.75rem' }}>NASDAQ</span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600, marginTop: '2px' }}>
                    {s.name}
                  </div>
                </div>

                <div
                  style={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontWeight: 800,
                    fontSize: '1.1rem'
                  }}
                >
                  ${s.price.toFixed(2)}
                </div>
              </div>

              {/* OBI Gauge Meter Bar */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>Order Book Imbalance (OBI)</span>
                  <span style={{ fontWeight: 800, color: s.obiPct >= 55 ? '#10b981' : s.obiPct >= 50 ? '#38bdf8' : '#ef4444' }}>
                    {s.obiPct.toFixed(1)}%
                  </span>
                </div>

                <div
                  style={{
                    height: '8px',
                    width: '100%',
                    background: '#334155',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    display: 'flex'
                  }}
                >
                  <div
                    style={{
                      width: `${s.obiPct}%`,
                      background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                  <div
                    style={{
                      width: `${100 - s.obiPct}%`,
                      background: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)',
                      transition: 'width 0.3s ease'
                    }}
                  />
                </div>
              </div>

              {/* Orderbook Depth Bids vs Asks Metrics */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px',
                  background: '#020617',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid #1e293b'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>BUY WALLS (BIDS)</div>
                  <div style={{ fontSize: '0.85rem', color: '#34d399', fontWeight: 700 }}>
                    {s.bidVol.toLocaleString()} shares
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>SELL WALLS (ASKS)</div>
                  <div style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 700 }}>
                    {s.askVol.toLocaleString()} shares
                  </div>
                </div>
              </div>

              {/* Dominance Badge & 4h RSI */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '4px' }}>
                <div
                  style={{
                    background: s.buyerDominant ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    border: `1px solid ${s.buyerDominant ? '#10b981' : '#ef4444'}`,
                    color: s.buyerDominant ? '#10b981' : '#ef4444',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}
                >
                  {s.buyerDominant ? '🟢 Buyers Dominating' : '🔴 Sellers Dominating'}
                </div>

                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  4h 15m RSI:{' '}
                  <span style={{ fontWeight: 800, color: s.rsi4h <= 40 ? '#10b981' : '#e2e8f0' }}>
                    {s.rsi4h.toFixed(1)}
                  </span>
                </div>
              </div>

              {/* Dual Gate Status Indicator */}
              <div
                style={{
                  background: s.dualGateMatched ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : '#0f172a',
                  border: s.dualGateMatched ? 'none' : '1px solid #334155',
                  color: s.dualGateMatched ? '#fff' : '#64748b',
                  padding: '8px',
                  borderRadius: '6px',
                  textAlign: 'center',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                {s.dualGateMatched ? (
                  <>
                    <ShieldCheck size={16} />
                    <span>🛡️ DUAL GATE MATCHED (OBI ≥55% & RSI ≤40)</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={16} />
                    <span>⚡ SCANNING LIQUIDITY & RSI DIP...</span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
