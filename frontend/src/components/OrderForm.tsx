import React, { useState } from 'react';
import { Play } from 'lucide-react';

interface OrderFormProps {
  onSubmit: (orderData: {
    symbol: string;
    trailValue: string;
    quantity: string;
    quoteOrderQty: string;
    orderType: string;
    dryRun: boolean;
    activationPrice: string;
    takeProfit: string;
    stopLoss: string;
    filterSmartSl: boolean;
    slBuffer: string;
    filterObi: boolean;
    filterVolume: boolean;
    filterRsi: boolean;
    autoRepeat: boolean;
    activationOffset: string;
    startImmediately: boolean;
  }) => Promise<void>;
  hasCredentials: boolean;
  availableSymbols: string[];
}

export default function OrderForm({ onSubmit, hasCredentials, availableSymbols }: OrderFormProps) {
  const [symbol, setSymbol] = useState('ETHUSDT');
  const [takeProfit, setTakeProfit] = useState('0.60');
  const [quoteOrderQty, setQuoteOrderQty] = useState('100');
  const [autoRepeat, setAutoRepeat] = useState(true);
  const [filterObi, setFilterObi] = useState(true);
  const [dryRun, setDryRun] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const predefinedSymbols = [
    'ETHUSDT',
    'BTCUSDT',
    'SOLUSDT',
    'SUIUSDT',
    'GOLD(XAUT)USDT',
    'UNIUSDT',
    'NVDAONUSDT',
    'EURUSDT'
  ];

  const combinedSymbols = Array.from(new Set([...predefinedSymbols, ...(availableSymbols || [])]));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const parsedTP = takeProfit ? parseFloat(takeProfit) : null;
    if (parsedTP !== null && (isNaN(parsedTP) || parsedTP <= 0)) {
      setError('Take Profit offset must be a positive number.');
      return;
    }

    const parsedUsdt = parseFloat(quoteOrderQty);
    if (isNaN(parsedUsdt) || parsedUsdt <= 0) {
      setError('USDT investment amount must be a positive number.');
      return;
    }

    if (!dryRun && !hasCredentials) {
      setError('You must connect your API credentials to place real orders, or enable "Simulation Mode".');
      return;
    }

    setLoading(true);

    try {
      await onSubmit({
        symbol: symbol.toUpperCase(),
        trailValue: '0.15',
        quantity: '',
        quoteOrderQty,
        orderType: 'MARKET',
        dryRun,
        activationPrice: '',
        takeProfit: takeProfit || '0.60',
        stopLoss: '0',
        filterSmartSl: false,
        slBuffer: '0.15',
        filterObi: true,
        filterVolume: false,
        filterRsi: false,
        autoRepeat,
        activationOffset: '0.15',
        startImmediately: true
      });

      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit order.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 800, fontSize: '1.1rem' }}>🚀 Launch Dual Gate Crypto Card</span>
        <button
          type="button"
          onClick={() => setDryRun(!dryRun)}
          style={{
            fontSize: '0.75rem',
            padding: '0.25rem 0.6rem',
            borderRadius: '6px',
            background: dryRun ? 'rgba(0, 242, 254, 0.15)' : 'rgba(16, 185, 129, 0.15)',
            color: dryRun ? 'var(--color-cyan)' : '#10b981',
            border: `1px solid ${dryRun ? 'var(--color-cyan)' : '#10b981'}`,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {dryRun ? '🧪 Simulation Mode' : '🟢 Live Trading Mode'}
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        {/* 1. Symbol Selection Dropdown */}
        <div className="form-group">
          <label htmlFor="symbol" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>Select Coin / Pair</label>
          <select
            id="symbol"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            disabled={loading}
            style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px', fontWeight: 700 }}
          >
            {combinedSymbols.map((sym) => (
              <option value={sym} key={sym}>{sym}</option>
            ))}
          </select>
        </div>

        {/* 2. Enable Auto-Cycle Loop Toggle */}
        <div className="form-group" style={{ background: 'rgba(255, 255, 255, 0.02)', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #334155' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={autoRepeat}
              onChange={(e) => setAutoRepeat(e.target.checked)}
              disabled={loading}
              style={{ width: '18px', height: '18px', accentColor: 'var(--color-cyan)', cursor: 'pointer' }}
            />
            <span>Enable Auto-Cycle Loop 🔄</span>
          </label>
        </div>

        {/* 3. Take Profit Target (%) */}
        <div className="form-group">
          <label htmlFor="takeProfit" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            Take Profit Target (%)
          </label>
          <input
            id="takeProfit"
            type="number"
            step="any"
            placeholder="e.g. 0.60 (%)"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            disabled={loading}
            style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px' }}
            required
          />
        </div>

        {/* 4. USDT Investment Amount */}
        <div className="form-group">
          <label htmlFor="quoteOrderQty" style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>
            Investment Amount to Spend ($ USDT)
          </label>
          <input
            id="quoteOrderQty"
            type="number"
            step="any"
            placeholder="e.g. 100 ($ USDT)"
            value={quoteOrderQty}
            onChange={(e) => setQuoteOrderQty(e.target.value)}
            disabled={loading}
            style={{ width: '100%', padding: '0.6rem', background: '#020617', color: '#f8fafc', border: '1px solid #334155', borderRadius: '8px' }}
            required
          />
        </div>

        {/* 5. Hardcoded Dual Gate System Badge */}
        <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', padding: '0.75rem 1rem', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <input
            type="checkbox"
            checked={filterObi}
            onChange={(e) => setFilterObi(e.target.checked)}
            disabled={loading}
            style={{ width: '18px', height: '18px', accentColor: '#10b981', cursor: 'pointer' }}
          />
          <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.85rem' }}>
            🎯 Dual Gate System Active (Top 10 Avg OBI ≥ 55.0% AND 4h 15m RSI ≤ 40.0)
          </span>
        </div>

        {error && (
          <div style={{ padding: '0.6rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', borderRadius: '6px', color: '#ef4444', fontSize: '0.85rem' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ padding: '0.6rem', background: 'rgba(16, 185, 129, 0.15)', border: '1px solid #10b981', borderRadius: '6px', color: '#10b981', fontSize: '0.85rem' }}>
            ✓ Trailing Card launched successfully!
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ width: '100%', padding: '0.8rem', fontWeight: 800, fontSize: '1rem', marginTop: '0.5rem', background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)' }}
        >
          <Play size={18} style={{ marginRight: '0.5rem' }} />
          {loading ? 'Launching Card...' : 'Start Tracking Card'}
        </button>
      </form>
    </div>
  );
}
