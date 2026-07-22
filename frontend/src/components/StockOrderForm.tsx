import React, { useState, useMemo } from 'react';
import { HelpCircle } from 'lucide-react';

interface StockOrderFormProps {
  onOrderCreated: () => void;
  apiBaseUrl: string;
  availableSymbols?: string[];
}

export const StockOrderForm: React.FC<StockOrderFormProps> = ({ onOrderCreated, apiBaseUrl, availableSymbols = [] }) => {
  const [symbol, setSymbol] = useState('GOLD(XAUT)USDT');
  const [trailValue, setTrailValue] = useState('2.0');
  const [qtyMode, setQtyMode] = useState<'usdt' | 'coin'>('usdt');
  const [quoteOrderQty, setQuoteOrderQty] = useState('100');
  const [quantity, setQuantity] = useState('');
  const [takeProfit, setTakeProfit] = useState('10.0');
  const [stopLoss, setStopLoss] = useState('4.0');
  
  const [activationPrice, setActivationPrice] = useState('');
  const [activationOffset, setActivationOffset] = useState('2.0');

  // Checkboxes
  const [filterSmartSl, setFilterSmartSl] = useState(false);
  const [slBuffer, setSlBuffer] = useState('2.0');
  const [filterObi, setFilterObi] = useState(false);
  const [filterVolumeSpike, setFilterVolumeSpike] = useState(false);
  const [filterRsi, setFilterRsi] = useState(false);
  const [autoRepeat, setAutoRepeat] = useState(false);
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

  const allSymbolsList = useMemo(() => {
    const set = new Set<string>([...defaultPresets, ...availableSymbols]);
    return Array.from(set);
  }, [availableSymbols]);

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
          quantity: qtyMode === 'coin' ? parseFloat(quantity) : null,
          quoteOrderQty: qtyMode === 'usdt' ? parseFloat(quoteOrderQty) : null,
          takeProfit: takeProfit ? parseFloat(takeProfit) : null,
          stopLoss: stopLoss ? parseFloat(stopLoss) : null,
          activationPrice: autoRepeat ? '' : activationPrice,
          activationOffset: activationOffset ? parseFloat(activationOffset) : '',
          filterSmartSl,
          slBuffer: parseFloat(slBuffer),
          filterObi,
          filterVolumeSpike,
          filterRsi,
          autoRepeat,
          startImmediately: autoRepeat ? startImmediately : false,
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
          {dryRun ? 'Simulation Mode' : 'Live Trading'}
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
              Symbol (e.g. NVDAONUSDT, GOLD(XAUT)USDT)
            </label>
            <input
              type="text"
              value={symbol}
              onChange={e => {
                setSymbol(e.target.value.toUpperCase());
                setIsDropdownOpen(true);
              }}
              onFocus={() => setIsDropdownOpen(true)}
              onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #0284c7', borderRadius: '6px', color: '#fff', fontSize: '0.95rem', fontWeight: 'bold' }}
              placeholder="e.g. NVDAONUSDT"
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

          {/* Investment Amount (USDT) vs Coin Quantity Switcher */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                {qtyMode === 'usdt' ? 'Investment Amount (USDT)' : 'Quantity (Tokens)'}
              </label>
              <button
                type="button"
                onClick={() => setQtyMode(qtyMode === 'usdt' ? 'coin' : 'usdt')}
                style={{ background: 'transparent', border: 'none', color: '#38bdf8', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Switch to {qtyMode === 'usdt' ? 'Token Qty' : 'USDT Amount'}
              </button>
            </div>

            {qtyMode === 'usdt' ? (
              <input
                type="number"
                step="any"
                value={quoteOrderQty}
                onChange={e => setQuoteOrderQty(e.target.value)}
                placeholder="e.g. 100 USDT investment"
                style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#38bdf8', fontSize: '0.95rem', fontWeight: 'bold' }}
                required
              />
            ) : (
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="e.g. 1.5 Tokens"
                style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', fontSize: '0.95rem' }}
                required
              />
            )}
          </div>

          {/* Trail Value */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
              Trail Rebound Value (%)
              <span title="If price bottoms at $100 and trail is 0.35%, buy triggers when price rebounds by 0.35%" style={{ cursor: 'help', color: '#94a3b8' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <input
              type="number"
              step="any"
              value={trailValue}
              onChange={e => setTrailValue(e.target.value)}
              placeholder="e.g. 0.35 (%)"
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff' }}
              required
            />
          </div>

          {/* Activation Price or Activation Dip Offset (Conditioned on Auto-Cycle like OrderForm.tsx) */}
          {autoRepeat ? (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#38bdf8', fontWeight: 'bold', marginBottom: '6px' }}>
                Activation Dip Offset (- %)
                <span title="The percentage drop required from previous peak price to activate trailing buy." style={{ cursor: 'help', color: '#94a3b8' }}>
                  <HelpCircle size={13} />
                </span>
              </label>
              <input
                type="number"
                step="any"
                value={activationOffset}
                onChange={e => setActivationOffset(e.target.value)}
                placeholder="e.g. 1.0 (% dip)"
                style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #0284c7', borderRadius: '6px', color: '#38bdf8', fontSize: '0.95rem', fontWeight: 'bold' }}
                required
              />
            </div>
          ) : (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
                Activation Price Target
                <span title="Bot starts trailing buy tracking only when price crosses this limit. Leave blank to activate immediately." style={{ cursor: 'help', color: '#94a3b8' }}>
                  <HelpCircle size={13} />
                </span>
              </label>
              <input
                type="number"
                step="any"
                value={activationPrice}
                onChange={e => setActivationPrice(e.target.value)}
                placeholder="e.g. 2400 (blank for immediate)"
                style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff' }}
              />
            </div>
          )}

          {/* Take Profit */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
              Take Profit Target (%)
              <span title="The percentage profit added to execution buy price for placing Limit Sell order. e.g. 0.60%" style={{ cursor: 'help', color: '#94a3b8' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <input
              type="number"
              step="any"
              value={takeProfit}
              onChange={e => setTakeProfit(e.target.value)}
              placeholder="e.g. 0.60 (%)"
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#22c55e' }}
            />
          </div>

          {/* Stop Loss */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>
              Stop Loss Level (%)
              <span title="The percentage loss subtracted from execution buy price for monitoring Market Sell level. e.g. 1.8%" style={{ cursor: 'help', color: '#94a3b8' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <input
              type="number"
              step="any"
              value={stopLoss}
              onChange={e => setStopLoss(e.target.value)}
              placeholder="e.g. 1.8 (%)"
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#ef4444' }}
            />
          </div>
        </div>

        {/* Auto Repeat Toggle Block */}
        <div style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '12px', borderRadius: '8px', border: '1px solid #334155', marginTop: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}>
            <input type="checkbox" checked={autoRepeat} onChange={e => setAutoRepeat(e.target.checked)} />
            Enable Auto-Cycle Loop 🔄
          </label>

          {autoRepeat && (
            <div style={{ marginTop: '10px', paddingLeft: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                <input type="checkbox" checked={startImmediately} onChange={e => setStartImmediately(e.target.checked)} />
                Start First Trade Immediately at Market Price ⚡
              </label>
            </div>
          )}
        </div>

        {/* Smart Stop Loss Guard Toggle & Buffer */}
        <div style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '12px', borderRadius: '8px', border: '1px solid #334155', marginTop: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}>
            <input type="checkbox" checked={filterSmartSl} onChange={e => setFilterSmartSl(e.target.checked)} />
            Enable Smart Dynamic Stop Loss Guard 🛡️
          </label>

          {filterSmartSl && (
            <div style={{ marginTop: '8px', paddingLeft: '24px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '4px' }}>
                Smart SL Stretch Buffer (+ %)
              </label>
              <input
                type="number"
                step="any"
                value={slBuffer}
                onChange={e => setSlBuffer(e.target.value)}
                placeholder="e.g. 0.15 (%)"
                style={{ width: '100%', padding: '8px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', fontSize: '0.85rem' }}
              />
            </div>
          )}
        </div>

        {/* Consensus Confirmation Filters Row */}
        <div style={{ background: 'rgba(255, 255, 255, 0.01)', padding: '12px', borderRadius: '8px', border: '1px solid #334155', marginTop: '12px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#cbd5e1', display: 'block', marginBottom: '8px' }}>
            Buy Entry Confirmation Filters (Optional)
          </span>

          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={filterObi} onChange={e => setFilterObi(e.target.checked)} />
              OBI Support Guard (&ge; 55%)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={filterVolumeSpike} onChange={e => setFilterVolumeSpike(e.target.checked)} />
              Volume Spike Guard (&ge; 1.5x)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={filterRsi} onChange={e => setFilterRsi(e.target.checked)} />
              RSI Oversold Guard (&le; 35)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
              Simulation Mode (Dry Run)
            </label>
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
