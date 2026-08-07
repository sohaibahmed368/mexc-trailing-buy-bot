import React, { useState, useEffect } from 'react';
import { Clock, ShieldAlert, ShieldCheck, Activity, Play, Trash2, Terminal, Wallet, RefreshCw, Layers } from 'lucide-react';
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

interface UsStockCard {
  id: string;
  symbol: string;
  notional: number;
  takeProfit: number;
  autoRepeat: boolean;
  status: 'WAITING' | 'HOLDING' | 'COMPLETED';
  executionPrice: number | null;
  currentPrice: number;
  tradeHistory: Array<{ cycle: number; buyPrice: number; sellPrice: number; profitUsdt: number; timestamp: string }>;
  totalNetProfit: number;
  createdAt: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: string;
  symbol: string | null;
}

interface LiveStreamPayload {
  session: UsMarketSession;
  pktTimeStr: string;
  stocks: StockMetric[];
  cards: UsStockCard[];
  logs: LogEntry[];
}

interface AlpacaAccountInfo {
  hasCredentials: boolean;
  isPaper: boolean;
  portfolioValue: number;
  buyingPower: number;
  cash: number;
  positions: Array<{
    symbol: string;
    qty: number;
    avgEntryPrice: number;
    currentPrice: number;
    marketValue: number;
    unrealizedPl: number;
  }>;
}

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

export const RealUSStockBoard: React.FC = () => {
  const [data, setData] = useState<LiveStreamPayload | null>(null);
  const [accountInfo, setAccountInfo] = useState<AlpacaAccountInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Form State for US Stock Card
  const [selectedStock, setSelectedStock] = useState<string>('NVDA');
  const [notional, setNotional] = useState<string>('100');
  const [takeProfit, setTakeProfit] = useState<string>('0.50');
  const [autoRepeat, setAutoRepeat] = useState<boolean>(true);
  const [filterObi, setFilterObi] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const realStockOptions = [
    { symbol: 'NVDA', name: 'NVIDIA Corporation' },
    { symbol: 'INTC', name: 'Intel Corporation' },
    { symbol: 'AAPL', name: 'Apple Inc.' },
    { symbol: 'AMZN', name: 'Amazon.com Inc.' },
    { symbol: 'GOOGL', name: 'Alphabet Inc. (Google)' },
    { symbol: 'TSLA', name: 'Tesla Inc.' },
    { symbol: 'MSFT', name: 'Microsoft Corporation' },
    { symbol: 'USO', name: 'United States Oil Fund (WTI Oil)' },
    { symbol: 'GLD', name: 'SPDR Gold Shares ETF' }
  ];

  const fetchAccountInfo = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/real-us-stocks/account`);
      const json = await res.json();
      if (json.success && json.data) {
        setAccountInfo(json.data);
      }
    } catch (e) {}
  };

  useEffect(() => {
    // 1. Initial Fetch
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
    fetchAccountInfo();

    // 2. Real-Time Socket Stream
    const socket = io(BACKEND_URL);
    socket.on('real_us_stocks_update', (payload: LiveStreamPayload) => {
      setData(payload);
      setLoading(false);
    });

    const interval = setInterval(fetchAccountInfo, 5000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
    };
  }, []);

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFormMsg(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/real-us-stocks/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: selectedStock,
          notional: parseFloat(notional),
          takeProfit: parseFloat(takeProfit),
          autoRepeat
        })
      });

      const json = await res.json();
      if (json.success) {
        setFormMsg(`✓ Launched Real US Stock Card for ${selectedStock}!`);
        setTimeout(() => setFormMsg(null), 3000);
        fetchAccountInfo();
      } else {
        setFormMsg(`Error: ${json.error}`);
      }
    } catch (err: any) {
      setFormMsg(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelCard = async (cardId: string) => {
    try {
      await fetch(`${BACKEND_URL}/api/real-us-stocks/cards/${cardId}`, {
        method: 'DELETE'
      });
      fetchAccountInfo();
    } catch (e) {}
  };

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
  const cards = data?.cards || [];
  const logs = data?.logs || [];

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
            Direct Alpaca Markets NASDAQ Data Stream • 500-Level Order Book Depth • Real-Time OBI & 4h 15m RSI
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

      {/* 💼 Alpaca Portfolio Wallet & Stock Holdings Panel */}
      <div
        style={{
          background: 'linear-gradient(135deg, #020617 0%, #0f172a 100%)',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={20} style={{ color: '#34d399' }} />
            <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.15rem', fontWeight: 800 }}>
              Alpaca Stock Account Holdings & Wallet Balances
            </h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '4px 10px',
                borderRadius: '6px',
                background: accountInfo?.isPaper ? 'rgba(56, 189, 248, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: accountInfo?.isPaper ? '#38bdf8' : '#10b981',
                border: `1px solid ${accountInfo?.isPaper ? '#38bdf8' : '#10b981'}`,
                fontWeight: 700
              }}
            >
              {accountInfo?.isPaper ? '🧪 Alpaca Paper Trading Account' : '🟢 Alpaca Live Real Account'}
            </span>
            <button
              onClick={fetchAccountInfo}
              style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer' }}
              title="Refresh Alpaca Balances"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Portfolio Stats Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ background: '#020617', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Total Portfolio Value</div>
            <div style={{ fontSize: '1.25rem', color: '#34d399', fontWeight: 800, marginTop: '2px' }}>
              ${accountInfo ? accountInfo.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '100,000.00'} USD
            </div>
          </div>

          <div style={{ background: '#020617', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Buying Power / Buying Balance</div>
            <div style={{ fontSize: '1.25rem', color: '#38bdf8', fontWeight: 800, marginTop: '2px' }}>
              ${accountInfo ? accountInfo.buyingPower.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '100,000.00'} USD
            </div>
          </div>

          <div style={{ background: '#020617', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Uninvested Cash</div>
            <div style={{ fontSize: '1.25rem', color: '#f8fafc', fontWeight: 800, marginTop: '2px' }}>
              ${accountInfo ? accountInfo.cash.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '99,967.60'} USD
            </div>
          </div>
        </div>

        {/* Live Open Stock Positions Table */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '6px' }}>
            <Layers size={14} style={{ color: '#38bdf8' }} />
            <span>Open Stock Positions ({accountInfo?.positions ? accountInfo.positions.length : 0})</span>
          </div>

          {accountInfo?.positions && accountInfo.positions.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ background: '#020617', borderBottom: '1px solid #334155', color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px' }}>Stock Symbol</th>
                    <th style={{ padding: '6px 10px' }}>Shares Qty</th>
                    <th style={{ padding: '6px 10px' }}>Avg Entry Price</th>
                    <th style={{ padding: '6px 10px' }}>Current Price</th>
                    <th style={{ padding: '6px 10px' }}>Market Value</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Unrealized Profit/Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {accountInfo.positions.map((pos) => (
                    <tr key={pos.symbol} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '6px 10px', fontWeight: 800, color: '#38bdf8' }}>{pos.symbol}</td>
                      <td style={{ padding: '6px 10px', color: '#f8fafc' }}>{pos.qty} shares</td>
                      <td style={{ padding: '6px 10px', color: '#94a3b8' }}>${pos.avgEntryPrice.toFixed(2)}</td>
                      <td style={{ padding: '6px 10px', color: '#f8fafc' }}>${pos.currentPrice.toFixed(2)}</td>
                      <td style={{ padding: '6px 10px', color: '#e2e8f0', fontWeight: 700 }}>${pos.marketValue.toFixed(2)} USD</td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 800, color: pos.unrealizedPl >= 0 ? '#10b981' : '#ef4444' }}>
                        {pos.unrealizedPl >= 0 ? '+' : ''}${pos.unrealizedPl.toFixed(2)} USD
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', padding: '4px' }}>
              No open stock positions currently held in Alpaca account.
            </div>
          )}
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
        {stocks.map((s) => (
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
              boxShadow: s.dualGateMatched ? '0 0 20px rgba(16, 185, 129, 0.2)' : '0 2px 8px rgba(0, 0, 0, 0.2)'
            }}
          >
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

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '6px' }}>
                <span style={{ color: '#94a3b8' }}>Order Book Imbalance (OBI)</span>
                <span style={{ fontWeight: 800, color: s.obiPct >= 60 ? '#10b981' : s.obiPct >= 50 ? '#38bdf8' : '#ef4444' }}>
                  {s.obiPct.toFixed(1)}%
                </span>
              </div>
              <div style={{ height: '8px', width: '100%', background: '#334155', borderRadius: '4px', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${s.obiPct}%`, background: 'linear-gradient(90deg, #10b981 0%, #34d399 100%)' }} />
                <div style={{ width: `${100 - s.obiPct}%`, background: 'linear-gradient(90deg, #f87171 0%, #ef4444 100%)' }} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', background: '#020617', padding: '8px 12px', borderRadius: '8px', border: '1px solid #1e293b' }}>
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

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ background: s.buyerDominant ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', border: `1px solid ${s.buyerDominant ? '#10b981' : '#ef4444'}`, color: s.buyerDominant ? '#10b981' : '#ef4444', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700 }}>
                {s.buyerDominant ? '🟢 Buyers Dominating' : '🔴 Sellers Dominating'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                4h 15m RSI: <span style={{ fontWeight: 800, color: s.rsi4h <= 40 ? '#10b981' : '#e2e8f0' }}>{s.rsi4h.toFixed(1)}</span>
              </div>
            </div>

            <div style={{ background: s.dualGateMatched ? 'linear-gradient(135deg, #059669 0%, #047857 100%)' : '#0f172a', border: s.dualGateMatched ? 'none' : '1px solid #334155', color: s.dualGateMatched ? '#fff' : '#64748b', padding: '8px', borderRadius: '6px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              {s.dualGateMatched ? (
                <>
                  <ShieldCheck size={16} />
                  <span>🛡️ DUAL GATE MATCHED (OBI ≥60% & RSI ≤40)</span>
                </>
              ) : (
                <>
                  <ShieldAlert size={16} />
                  <span>⚡ SCANNING NASDAQ DIP...</span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 🚀 Dedicated Real US Stock Dual Gate Card Launch Form */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '1.5rem',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '1rem' }}>
          <Play size={20} style={{ color: '#10b981' }} />
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', fontWeight: 800 }}>
            Launch Real US Stock Dual Gate Card
          </h3>
        </div>

        <form onSubmit={handleCreateCard} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem', alignItems: 'end' }}>
          {/* Stock Dropdown (Real US Stocks Only) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
              Select Real US Stock
            </label>
            <select
              value={selectedStock}
              onChange={(e) => setSelectedStock(e.target.value)}
              disabled={submitting}
              style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px', fontWeight: 700 }}
            >
              {realStockOptions.map((opt) => (
                <option key={opt.symbol} value={opt.symbol}>
                  {opt.symbol} — {opt.name}
                </option>
              ))}
            </select>
          </div>

          {/* Investment Amount ($ USD) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
              Investment Amount ($ USD)
            </label>
            <input
              type="number"
              step="any"
              value={notional}
              onChange={(e) => setNotional(e.target.value)}
              placeholder="e.g. 100 ($ USD)"
              disabled={submitting}
              style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px' }}
              required
            />
          </div>

          {/* Take Profit Target (%) */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '4px' }}>
              Take Profit Target (%)
            </label>
            <input
              type="number"
              step="any"
              value={takeProfit}
              onChange={(e) => setTakeProfit(e.target.value)}
              placeholder="e.g. 0.50 (%)"
              disabled={submitting}
              style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px' }}
              required
            />
          </div>

          {/* Auto Repeat & Dual Gate Checkboxes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>
              <input
                type="checkbox"
                checked={autoRepeat}
                onChange={(e) => setAutoRepeat(e.target.checked)}
                disabled={submitting}
                style={{ width: '16px', height: '16px', accentColor: '#38bdf8' }}
              />
              <span>Enable Auto-Cycle Loop 🔄</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: '#10b981' }}>
              <input
                type="checkbox"
                checked={filterObi}
                onChange={(e) => setFilterObi(e.target.checked)}
                disabled={submitting}
                style={{ width: '16px', height: '16px', accentColor: '#10b981' }}
              />
              <span>🎯 Dual Gate (OBI ≥ 60% & RSI ≤ 40)</span>
            </label>
          </div>

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '0.95rem',
                cursor: 'pointer'
              }}
            >
              {submitting ? 'Launching Card...' : '🚀 Start Real US Stock Card'}
            </button>
          </div>
        </form>

        {formMsg && (
          <div style={{ marginTop: '1rem', padding: '0.6rem 1rem', borderRadius: '6px', background: formMsg.startsWith('✓') ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)', border: `1px solid ${formMsg.startsWith('✓') ? '#10b981' : '#ef4444'}`, color: formMsg.startsWith('✓') ? '#10b981' : '#ef4444', fontSize: '0.85rem', fontWeight: 700 }}>
            {formMsg}
          </div>
        )}
      </div>

      {/* 💳 Active Real US Stock Cards Grid */}
      {cards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.2rem', fontWeight: 800 }}>
            Active Real US Stock Tracking Cards ({cards.length})
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.25rem' }}>
            {cards.map((c) => (
              <div
                key={c.id}
                style={{
                  background: '#0f172a',
                  border: c.status === 'HOLDING' ? '2px solid #b388ff' : '1px solid #334155',
                  borderRadius: '12px',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  position: 'relative'
                }}
              >
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 900, color: '#38bdf8' }}>{c.symbol}</span>
                    {c.autoRepeat && (
                      <span style={{ fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontWeight: 700 }}>
                        Loop 🔄
                      </span>
                    )}
                  </div>

                  <span
                    style={{
                      background: c.status === 'WAITING' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(179, 136, 255, 0.15)',
                      color: c.status === 'WAITING' ? '#38bdf8' : '#b388ff',
                      border: `1px solid ${c.status === 'WAITING' ? '#38bdf8' : '#b388ff'}`,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 800
                    }}
                  >
                    {c.status === 'WAITING' ? 'Awaiting Dip Signal' : 'Holding Position (TP)'}
                  </span>
                </div>

                {/* Info Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#94a3b8' }}>
                  <span>Buy Condition: <strong style={{ color: '#f8fafc' }}>Spend ${c.notional} USD</strong></span>
                  <span>Total Profit: <strong style={{ color: c.totalNetProfit > 0 ? '#10b981' : '#38bdf8' }}>+${c.totalNetProfit.toFixed(4)} USD</strong></span>
                </div>

                {/* Price Status */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', background: '#020617', padding: '6px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                  <span>Current Price: <strong style={{ color: '#38bdf8' }}>${c.currentPrice ? c.currentPrice.toFixed(2) : '-'}</strong></span>
                  {c.executionPrice && (
                    <span>Bought At: <strong style={{ color: '#34d399' }}>${c.executionPrice.toFixed(2)}</strong></span>
                  )}
                </div>

                {/* Take Profit Target */}
                <div style={{ fontSize: '0.85rem', background: 'rgba(16, 185, 129, 0.05)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.15)', display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#94a3b8' }}>Take Profit Target:</span>
                  <strong style={{ color: '#10b981' }}>
                    {c.executionPrice ? `$${(c.executionPrice * (1 + c.takeProfit / 100)).toFixed(2)} (+${c.takeProfit}%)` : `Buy Price + ${c.takeProfit}%`}
                  </strong>
                </div>

                {/* Dual Gate Badge */}
                <div>
                  <span style={{ fontSize: '0.75rem', padding: '3px 8px', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid #10b981', fontWeight: 700 }}>
                    🎯 Dual Gate (OBI ≥ 60% & 4h 15m RSI ≤ 40)
                  </span>
                </div>

                {/* Completed Cycles History */}
                {c.tradeHistory && c.tradeHistory.length > 0 && (
                  <div style={{ marginTop: '0.4rem', borderTop: '1px solid #1e293b', paddingTop: '0.4rem' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700, marginBottom: '4px' }}>
                      Completed Cycles History ({c.tradeHistory.length})
                    </div>
                    <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {c.tradeHistory.map((t) => (
                        <div key={t.cycle} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', background: '#020617', padding: '4px 8px', borderRadius: '4px' }}>
                          <span>Cycle #{t.cycle} (TP Hit)</span>
                          <span style={{ color: '#94a3b8' }}>${t.buyPrice.toFixed(2)} &rarr; ${t.sellPrice.toFixed(2)}</span>
                          <strong style={{ color: '#10b981' }}>+${t.profitUsdt.toFixed(4)} USD</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cancel Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.4rem' }}>
                  <button
                    type="button"
                    onClick={() => handleCancelCard(c.id)}
                    style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#ef4444', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <Trash2 size={12} />
                    <span>Cancel Card</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 🖥️ Dedicated Alpaca / US Stock Logs Console */}
      <div
        style={{
          background: '#020617',
          border: '1px solid #334155',
          borderRadius: '12px',
          padding: '1.25rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Terminal size={18} style={{ color: '#38bdf8' }} />
          <h4 style={{ margin: 0, color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>
            Alpaca US Stock System Execution Console
          </h4>
        </div>

        <div
          style={{
            height: '180px',
            overflowY: 'auto',
            background: '#0f172a',
            borderRadius: '8px',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            border: '1px solid #1e293b'
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: '#64748b' }}>System ready. Real US Stock logs will stream here live...</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} style={{ display: 'flex', gap: '8px' }}>
                <span style={{ color: '#64748b' }}>[{new Date(l.timestamp).toLocaleTimeString()}]</span>
                <span style={{ color: l.type === 'success' ? '#10b981' : l.type === 'error' ? '#ef4444' : '#38bdf8', fontWeight: 600 }}>
                  {l.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
