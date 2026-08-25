import React, { useState, useEffect } from 'react';
import { Layers, Activity, Clock } from 'lucide-react';
import io from 'socket.io-client';

interface VenueMetric {
  id: string;
  name: string;
  category: 'futures' | 'interbank' | 'retail_ecn' | 'crypto';
  icon: string;
  region: string;
  instrument: string;
  price: number;
  spotObiPct: number;
  futObiPct: number;
  combinedObiPct: number;
  buyerVolumeUsd: number;
  sellerVolumeUsd: number;
  spreadBps: number;
  active: boolean;
}

interface OrderBookLevel {
  level: number;
  price: number;
  volumeOz: number;
  volumeUsd: number;
  barPct: number;
}

interface OrderBookLadder {
  referencePrice: number;
  spreadUsd: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

interface GoldRadarPayload {
  averagePrice: number;
  consensusObiPct: number;
  spotObiPct: number;
  futObiPct: number;
  totalBuyerUsd: number;
  totalSellerUsd: number;
  totalLiquidityUsd: number;
  currentSession: string;
  sessionColor: string;
  sentimentBadge: string;
  sentimentColor: string;
  venuesCount: number;
  venues: VenueMetric[];
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export const GlobalGoldLiquidityRadar: React.FC = () => {
  const [data, setData] = useState<GoldRadarPayload | null>(null);
  const [orderBook, setOrderBook] = useState<OrderBookLadder | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'futures' | 'interbank' | 'retail_ecn' | 'crypto'>('all');
  const [showLadder, setShowLadder] = useState<boolean>(false);

  const [lastTickTime, setLastTickTime] = useState<string>('');

  useEffect(() => {
    // 1. Live REST fetch with cache-busting timestamp
    const fetchGoldRadar = async () => {
      try {
        const ts = Date.now();
        const [metricsRes, bookRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/gold-radar/metrics?_t=${ts}`),
          fetch(`${BACKEND_URL}/api/gold-radar/orderbook?_t=${ts}`)
        ]);

        if (metricsRes.ok) {
          const json = await metricsRes.json();
          if (json.success && json.data) {
            setData(json.data);
            setLastTickTime(new Date().toLocaleTimeString());
          }
        }

        if (bookRes.ok) {
          const json = await bookRes.json();
          if (json.success && json.data) setOrderBook(json.data);
        }
      } catch (e) {
      } finally {
        setLoading(false);
      }
    };

    fetchGoldRadar();
    const intervalId = setInterval(fetchGoldRadar, 2500);

    // 2. WebSocket live feed
    const socket = io(BACKEND_URL);
    socket.on('gold_radar_update', (payload: { success: boolean; data: GoldRadarPayload; orderBook: OrderBookLadder }) => {
      if (payload && payload.data) {
        setData(payload.data);
        if (payload.orderBook) setOrderBook(payload.orderBook);
        setLastTickTime(new Date().toLocaleTimeString());
        setLoading(false);
      }
    });

    return () => {
      clearInterval(intervalId);
      socket.disconnect();
    };
  }, []);

  if (loading && !data) {
    return (
      <div style={{ padding: '1.5rem', background: '#0b1329', borderRadius: '12px', border: '1px solid #1e293b', textAlign: 'center', color: '#94a3b8' }}>
        <Activity className="animate-spin" style={{ margin: '0 auto 0.5rem auto', color: '#eab308' }} size={24} />
        <p style={{ margin: 0, fontSize: '0.9rem' }}>Connecting to 25 Global Gold Exchange Feeds (CME, LMAX, Binance, MEXC)...</p>
      </div>
    );
  }

  const consensusObi = data?.consensusObiPct || 50.0;
  const buyerPct = consensusObi;
  const sellerPct = parseFloat((100 - consensusObi).toFixed(1));

  const filteredVenues = data?.venues.filter(v => {
    if (categoryFilter === 'all') return true;
    return v.category === categoryFilter;
  }) || [];

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #0b1329 0%, #172554 50%, #0f172a 100%)',
        borderRadius: '12px',
        border: '1px solid rgba(234, 179, 8, 0.25)',
        padding: '1.25rem',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        color: '#f8fafc'
      }}
    >
      {/* Top Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.5rem' }}>🪙</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, letterSpacing: '0.3px', color: '#fef08a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Global Institutional Gold Liquidity Radar
              <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '999px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                25 Venues Live Streaming (2.5s)
              </span>
            </h2>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>
              CME COMEX, Shanghai Gold Exchange, LMAX, EBS, cTrader & Top 10 Crypto Order Books
            </p>
          </div>
        </div>

        {/* Live Session & Sentiment Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: '0.35rem 0.75rem', borderRadius: '8px', border: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem' }}>
            <Clock size={13} style={{ color: data?.sessionColor || '#eab308' }} />
            <span style={{ color: data?.sessionColor || '#eab308', fontWeight: 700 }}>
              {data?.currentSession || 'Global Market Session'}
            </span>
          </div>

          <div style={{ background: 'rgba(15, 23, 42, 0.8)', padding: '0.35rem 0.75rem', borderRadius: '8px', border: `1px solid ${data?.sentimentColor || '#10b981'}`, color: data?.sentimentColor || '#10b981', fontWeight: 800, fontSize: '0.75rem' }}>
            {data?.sentimentBadge || 'NEUTRAL / BALANCED'}
          </div>

          {lastTickTime && (
            <span style={{ fontSize: '0.7rem', color: '#38bdf8', background: '#020617', padding: '0.35rem 0.6rem', borderRadius: '6px', border: '1px solid #1e293b', fontWeight: 600 }}>
              ⚡ {lastTickTime}
            </span>
          )}

          <button
            type="button"
            onClick={() => setShowLadder(!showLadder)}
            style={{
              background: showLadder ? 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)' : '#1e293b',
              color: showLadder ? '#0f172a' : '#fef08a',
              border: '1px solid rgba(234, 179, 8, 0.4)',
              padding: '0.35rem 0.75rem',
              borderRadius: '8px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem'
            }}
          >
            <Layers size={13} />
            {showLadder ? 'Hide L2 Order Book' : 'View L2 Order Book'}
          </button>
        </div>
      </div>

      {/* Hero Consensus Metrics Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
        {/* Metric 1: Reference Gold Price */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>Composite Gold Price (XAU/USD)</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#fef08a' }}>
              ${data?.averagePrice ? data.averagePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '2,650.00'}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#cbd5e1' }}>/ Troy Oz</span>
          </div>
        </div>

        {/* Metric 2: Global Consensus OBI */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase' }}>Global Consensus OBI</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: consensusObi >= 50 ? '#34d399' : '#f87171' }}>
              {consensusObi}% {consensusObi >= 50 ? 'Buyer Dominated' : 'Seller Dominated'}
            </span>
          </div>
          {/* Dual Split Bar */}
          <div style={{ height: '8px', width: '100%', background: '#334155', borderRadius: '4px', overflow: 'hidden', display: 'flex', marginTop: '0.4rem' }}>
            <div style={{ width: `${buyerPct}%`, background: 'linear-gradient(90deg, #059669 0%, #10b981 100%)' }} />
            <div style={{ width: `${sellerPct}%`, background: 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8', marginTop: '0.2rem' }}>
            <span style={{ color: '#34d399' }}>🟢 Buyers: {buyerPct}%</span>
            <span style={{ color: '#f87171' }}>🔴 Sellers: {sellerPct}%</span>
          </div>
        </div>

        {/* Metric 3: Spot OBI vs Futures OBI */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.2)' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>Spot OBI vs Futures OBI</span>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Spot Depth: </span>
              <strong style={{ color: (data?.spotObiPct || 50) >= 50 ? '#34d399' : '#f87171', fontSize: '0.95rem' }}>
                {data?.spotObiPct || 50.0}%
              </strong>
            </div>
            <div>
              <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Futures Depth: </span>
              <strong style={{ color: (data?.futObiPct || 50) >= 50 ? '#34d399' : '#f87171', fontSize: '0.95rem' }}>
                {data?.futObiPct || 50.0}%
              </strong>
            </div>
          </div>
        </div>

        {/* Metric 4: Total Tracked Depth */}
        <div style={{ background: 'rgba(15, 23, 42, 0.65)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(234, 179, 8, 0.2)' }}>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', display: 'block' }}>Tracked Global Liquidity Depth</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: '0.2rem' }}>
            <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#38bdf8' }}>
              ${data?.totalLiquidityUsd ? (data.totalLiquidityUsd / 1000000).toFixed(1) : '150.0'}M USD
            </span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Live Depth</span>
          </div>
        </div>
      </div>

      {/* Optional: Aggregated Level-2 Order Book Ladder */}
      {showLadder && orderBook && (
        <div style={{ background: '#020617', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fde047', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Layers size={14} /> Aggregated Multi-Venue Level-2 Order Book Ladder
            </span>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
              Spread: <strong style={{ color: '#38bdf8' }}>${orderBook.spreadUsd}</strong> ({(orderBook.spreadUsd / (orderBook.referencePrice || 1) * 100).toFixed(3)}%)
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Bids Column */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#34d399', fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: '0.3rem' }}>
                <span>BUY ORDERS (BIDS)</span>
                <span>VOL (OZ / USD)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.3rem' }}>
                {orderBook.bids.map(b => (
                  <div key={`bid-${b.level}`} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0.4rem', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: `${b.barPct}%`, background: 'rgba(16, 185, 129, 0.15)', zIndex: 1 }} />
                    <span style={{ color: '#34d399', fontWeight: 700, zIndex: 2 }}>${b.price.toFixed(2)}</span>
                    <span style={{ color: '#cbd5e1', zIndex: 2 }}>{b.volumeOz.toLocaleString()} oz (${(b.volumeUsd / 1000000).toFixed(2)}M)</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Asks Column */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#f87171', fontWeight: 700, borderBottom: '1px solid #1e293b', paddingBottom: '0.3rem' }}>
                <span>SELL ORDERS (ASKS)</span>
                <span>VOL (OZ / USD)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.3rem' }}>
                {orderBook.asks.map(a => (
                  <div key={`ask-${a.level}`} style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '0.2rem 0.4rem', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: `${a.barPct}%`, background: 'rgba(239, 68, 68, 0.15)', zIndex: 1 }} />
                    <span style={{ color: '#f87171', fontWeight: 700, zIndex: 2 }}>${a.price.toFixed(2)}</span>
                    <span style={{ color: '#cbd5e1', zIndex: 2 }}>{a.volumeOz.toLocaleString()} oz (${(a.volumeUsd / 1000000).toFixed(2)}M)</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Category Filter Navigation */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {[
          { key: 'all', label: `🌐 All Venues (${data?.venues.length || 25})` },
          { key: 'futures', label: '🏛️ Futures & Commodities (5)' },
          { key: 'interbank', label: '🏦 Interbank ECNs (5)' },
          { key: 'retail_ecn', label: '💎 Retail ECNs (4)' },
          { key: 'crypto', label: '🪙 Top 10 Crypto (11)' }
        ].map(tab => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setCategoryFilter(tab.key as any)}
            style={{
              background: categoryFilter === tab.key ? 'linear-gradient(135deg, #ca8a04 0%, #eab308 100%)' : '#0f172a',
              color: categoryFilter === tab.key ? '#0f172a' : '#cbd5e1',
              border: categoryFilter === tab.key ? 'none' : '1px solid #334155',
              padding: '0.35rem 0.75rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 25-Venue Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {filteredVenues.map(v => {
          const vBuyerPct = v.combinedObiPct;
          const vSellerPct = parseFloat((100 - v.combinedObiPct).toFixed(1));

          return (
            <div
              key={v.id}
              style={{
                background: 'rgba(15, 23, 42, 0.75)',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid #1e293b',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.4rem',
                transition: 'border-color 0.2s ease',
                position: 'relative'
              }}
            >
              {/* Venue Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>{v.icon}</span>
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#f8fafc', display: 'block' }}>{v.name}</strong>
                    <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>{v.instrument}</span>
                  </div>
                </div>

                <span style={{
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  color: v.combinedObiPct >= 50 ? '#34d399' : '#f87171',
                  background: v.combinedObiPct >= 50 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  padding: '0.15rem 0.4rem',
                  borderRadius: '4px',
                  border: `1px solid ${v.combinedObiPct >= 50 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`
                }}>
                  {v.combinedObiPct}% OBI
                </span>
              </div>

              {/* Progress Split Bar */}
              <div style={{ height: '6px', width: '100%', background: '#334155', borderRadius: '3px', overflow: 'hidden', display: 'flex', marginTop: '0.2rem' }}>
                <div style={{ width: `${vBuyerPct}%`, background: '#10b981' }} />
                <div style={{ width: `${vSellerPct}%`, background: '#ef4444' }} />
              </div>

              {/* Spot vs Futures Breakdown */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                <span>Spot OBI: <strong style={{ color: v.spotObiPct >= 50 ? '#34d399' : '#f87171' }}>{v.spotObiPct}%</strong></span>
                <span>Futures OBI: <strong style={{ color: v.futObiPct >= 50 ? '#34d399' : '#f87171' }}>{v.futObiPct}%</strong></span>
              </div>

              {/* Volumes and Price */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', borderTop: '1px solid #1e293b', paddingTop: '0.3rem', marginTop: '0.1rem' }}>
                <span style={{ color: '#38bdf8' }}>${v.price.toFixed(2)}</span>
                <span style={{ color: '#cbd5e1' }}>
                  B: <strong style={{ color: '#34d399' }}>${(v.buyerVolumeUsd / 1000000).toFixed(1)}M</strong> | S: <strong style={{ color: '#f87171' }}>${(v.sellerVolumeUsd / 1000000).toFixed(1)}M</strong>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
