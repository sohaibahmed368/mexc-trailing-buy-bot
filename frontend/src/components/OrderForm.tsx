import React, { useState } from 'react';
import { Play } from 'lucide-react';
import SearchableSymbolSelect from './SearchableSymbolSelect';

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
    customObiThreshold?: string;
    customRsiThreshold?: string;
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
  const [filterObi, setFilterObi] = useState(false);
  const [customObiThreshold, setCustomObiThreshold] = useState('55.0');
  const [customRsiThreshold, setCustomRsiThreshold] = useState('40.0');
  const [dryRun, setDryRun] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
        filterObi,
        customObiThreshold,
        customRsiThreshold,
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
        {/* 1. Instant Searchable Symbol Selection Component */}
        <div className="form-group">
          <label htmlFor="symbol" style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.4rem', display: 'block' }}>Select Coin / Pair</label>
          <SearchableSymbolSelect
            value={symbol}
            onChange={(selectedSym) => setSymbol(selectedSym)}
            availableSymbols={availableSymbols}
            disabled={loading}
          />
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

        {/* 5. Custom Dual Gate System Container */}
        <div style={{ background: filterObi ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255, 255, 255, 0.02)', border: `1px solid ${filterObi ? '#10b981' : '#334155'}`, padding: '0.85rem 1rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.75rem', transition: 'all 0.2s ease' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterObi}
              onChange={(e) => setFilterObi(e.target.checked)}
              disabled={loading}
              style={{ width: '18px', height: '18px', accentColor: '#10b981', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 800, color: filterObi ? '#10b981' : '#cbd5e1', fontSize: '0.9rem' }}>
              🎯 Dual Gate System Active (Custom OBI % & 4h 15m RSI)
            </span>
          </label>

          {/* Conditional Input Textboxes when filterObi is checked */}
          {filterObi && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(16, 185, 129, 0.2)' }}>
              <div>
                <label htmlFor="customObiThreshold" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#10b981', display: 'block', marginBottom: '0.3rem' }}>
                  Target Min OBI Index (%)
                </label>
                <input
                  id="customObiThreshold"
                  type="number"
                  step="any"
                  placeholder="e.g. 55.0"
                  value={customObiThreshold}
                  onChange={(e) => setCustomObiThreshold(e.target.value)}
                  disabled={loading}
                  style={{ width: '100%', padding: '0.5rem', background: '#020617', color: '#f8fafc', border: '1px solid #10b981', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700 }}
                  required
                />
              </div>

              <div>
                <label htmlFor="customRsiThreshold" style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', display: 'block', marginBottom: '0.3rem' }}>
                  Target Max 4h RSI (≤)
                </label>
                <input
                  id="customRsiThreshold"
                  type="number"
                  step="any"
                  placeholder="e.g. 40.0"
                  value={customRsiThreshold}
                  onChange={(e) => setCustomRsiThreshold(e.target.value)}
                  disabled={loading}
                  style={{ width: '100%', padding: '0.5rem', background: '#020617', color: '#f8fafc', border: '1px solid #0284c7', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 700 }}
                  required
                />
              </div>
            </div>
          )}
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
