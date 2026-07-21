import React, { useState, useMemo } from 'react';

interface StockOrderFormProps {
  onOrderCreated: () => void;
  apiBaseUrl: string;
  availableSymbols?: string[];
}

export const StockOrderForm: React.FC<StockOrderFormProps> = ({ onOrderCreated, apiBaseUrl, availableSymbols = [] }) => {
  const [symbol, setSymbol] = useState('GOLD(XAUT)USDT');
  const [trailValue, setTrailValue] = useState('2.0');
  const [quantity, setQuantity] = useState('1.0');
  const [takeProfit, setTakeProfit] = useState('10.0');
  const [stopLoss, setStopLoss] = useState('4.0');
  const [maxSlippagePct, setMaxSlippagePct] = useState('0.5');
  
  // All checkboxes default to UNCHECKED (false) as requested by user
  const [filterSmartSl, setFilterSmartSl] = useState(false);
  const [slBuffer, setSlBuffer] = useState('2.0');
  const [filterObi, setFilterObi] = useState(false);
  const [filterVolumeSpike, setFilterVolumeSpike] = useState(false);
  const [filterRsi, setFilterRsi] = useState(false);
  const [autoRepeat, setAutoRepeat] = useState(false);
  const [activationOffset, setActivationOffset] = useState('10.0');
  const [startImmediately, setStartImmediately] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const defaultPresets = [
    'GOLD(XAUT)USDT',
    'GOLD(PAXG)USDT',
    'NVDAONUSDT',
    'USOONUSDT',
    'INTKONUSDT',
    'ETHUSDT',
    'BTCUSDT',
    'SOLUSDT'
  ];

  // Merge MEXC live availableSymbols with stock presets
  const allSymbolsList = useMemo(() => {
    const set = new Set<string>([...defaultPresets, ...availableSymbols]);
    return Array.from(set);
  }, [availableSymbols]);

  // Filtered dropdown suggestions
  const filteredSymbols = useMemo(() => {
    if (!symbol) return allSymbolsList.slice(0, 15);
    const query = symbol.toUpperCase().trim();
    return allSymbolsList.filter(s => s.includes(query)).slice(0, 20);
  }, [symbol, allSymbolsList]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/stock-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: symbol.trim().toUpperCase(),
          trailValue: parseFloat(trailValue),
          quantity: parseFloat(quantity),
          takeProfit: takeProfit ? parseFloat(takeProfit) : null,
          stopLoss: stopLoss ? parseFloat(stopLoss) : null,
          maxSlippagePct: parseFloat(maxSlippagePct),
          filterSmartSl,
          slBuffer: parseFloat(slBuffer),
          filterObi,
          filterVolumeSpike,
          filterRsi,
          autoRepeat,
          activationOffset: parseFloat(activationOffset),
          startImmediately,
          dryRun
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create Stock Bot order');
      }

      onOrderCreated();
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#38bdf8' }}>📈 Stock Bot (Low Liquidity Tokenized Engine)</h2>
        <span style={{ background: '#0284c7', color: '#ffffff', padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 'bold' }}>
          LIVE MEXC SYNCED & MAX SLIPPAGE PROTECTED
        </span>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          
          {/* Symbol Autocomplete Dropdown */}
          <div style={{ position: 'relative' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
              Stock / Token Symbol (MEXC Synced)
            </label>
            <input
              type="text"
              value={symbol}
              onChange={e => {
                setSymbol(e.target.value);
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #0284c7', borderRadius: '6px', color: '#fff', fontSize: '0.95rem', fontWeight: 'bold' }}
              placeholder="Search MEXC symbol e.g. NVDA, USO, GOLD..."
              required
            />
            
            {isDropdownOpen && filteredSymbols.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#0f172a', border: '1px solid #0284c7', borderRadius: '0 0 6px 6px', maxHeight: '180px', overflowY: 'auto', zIndex: 100, boxShadow: '0 8px 16px rgba(0,0,0,0.5)' }}>
                {filteredSymbols.map(s => (
                  <div
                    key={s}
                    onMouseDown={() => {
                      setSymbol(s);
                      setIsDropdownOpen(false);
                    }}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #1e293b', fontSize: '0.85rem', color: '#38bdf8' }}
                  >
                    {s}
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {defaultPresets.slice(0, 5).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSymbol(p)}
                  style={{ background: '#334155', border: 'none', color: '#cbd5e1', padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Max Allowed Slippage % */}
          <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid #0284c7' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#38bdf8', fontWeight: 'bold', marginBottom: '6px' }}>
              🛡️ Max Allowed Slippage (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              max="5.0"
              value={maxSlippagePct}
              onChange={e => setMaxSlippagePct(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #0284c7', borderRadius: '6px', color: '#38bdf8', fontSize: '1.05rem', fontWeight: 'bold' }}
              required
            />
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px', display: 'block' }}>
              Blocks market dump if depth slippage &gt; {maxSlippagePct}%. Converts to pegged limit order.
            </span>
          </div>

          {/* Trail Value */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>Trailing Buy Gap (USDT)</label>
            <input
              type="number"
              step="0.0001"
              value={trailValue}
              onChange={e => setTrailValue(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff' }}
              required
            />
          </div>

          {/* Quantity */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>Quantity (Tokens)</label>
            <input
              type="number"
              step="0.0001"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff' }}
              required
            />
          </div>

          {/* Take Profit */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>Take Profit Target (+USDT)</label>
            <input
              type="number"
              step="0.0001"
              value={takeProfit}
              onChange={e => setTakeProfit(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#22c55e' }}
            />
          </div>

          {/* Stop Loss */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>Stop Loss Distance (-USDT)</label>
            <input
              type="number"
              step="0.0001"
              value={stopLoss}
              onChange={e => setStopLoss(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#ef4444' }}
            />
          </div>
        </div>

        {/* Toggles Row - ALL UNCHECKED (DEFAULT FALSE) */}
        <div style={{ marginTop: '20px', display: 'flex', gap: '16px', flexWrap: 'wrap', background: '#0f172a', padding: '16px', borderRadius: '8px', border: '1px solid #334155' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={startImmediately} onChange={e => setStartImmediately(e.target.checked)} />
            Start Immediately (Bypass Activation Dip)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={autoRepeat} onChange={e => setAutoRepeat(e.target.checked)} />
            Auto-Repeat (Autonomous Multi-Cycle)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={filterSmartSl} onChange={e => setFilterSmartSl(e.target.checked)} />
            Smart SL Guard
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={filterObi} onChange={e => setFilterObi(e.target.checked)} />
            OBI Support Guard
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={filterVolumeSpike} onChange={e => setFilterVolumeSpike(e.target.checked)} />
            Volume Spike Guard
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={filterRsi} onChange={e => setFilterRsi(e.target.checked)} />
            RSI Oversold Guard
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            Dry Run
          </label>
        </div>

        {/* Extra Settings Row */}
        <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>SL Buffer Gap (+USDT)</label>
            <input
              type="number"
              step="0.0001"
              value={slBuffer}
              onChange={e => setSlBuffer(e.target.value)}
              style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>Activation Offset (-USDT)</label>
            <input
              type="number"
              step="0.0001"
              value={activationOffset}
              onChange={e => setActivationOffset(e.target.value)}
              style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: '20px',
            width: '100%',
            padding: '14px',
            background: loading ? '#475569' : 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Creating Stock Order...' : '🚀 Start Stock Bot Order'}
        </button>
      </form>
    </div>
  );
};
