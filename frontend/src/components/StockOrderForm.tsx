import React, { useState } from 'react';

interface StockOrderFormProps {
  onOrderCreated: () => void;
  apiBaseUrl: string;
}

export const StockOrderForm: React.FC<StockOrderFormProps> = ({ onOrderCreated, apiBaseUrl }) => {
  const [symbol, setSymbol] = useState('GOLD(XAUT)USDT');
  const [trailValue, setTrailValue] = useState('2.0');
  const [quantity, setQuantity] = useState('1.0');
  const [takeProfit, setTakeProfit] = useState('10.0');
  const [stopLoss, setStopLoss] = useState('4.0');
  const [maxSlippagePct, setMaxSlippagePct] = useState('0.5');
  const [filterSmartSl, setFilterSmartSl] = useState(true);
  const [slBuffer, setSlBuffer] = useState('2.0');
  const [filterObi, setFilterObi] = useState(true);
  const [filterVolumeSpike, setFilterVolumeSpike] = useState(true);
  const [filterRsi, setFilterRsi] = useState(true);
  const [autoRepeat, setAutoRepeat] = useState(true);
  const [activationOffset, setActivationOffset] = useState('10.0');
  const [startImmediately, setStartImmediately] = useState(true);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const presets = [
    { label: 'GOLD (XAUT)', value: 'GOLD(XAUT)USDT' },
    { label: 'PAX GOLD', value: 'GOLD(PAXG)USDT' },
    { label: 'NVDA Stock (Ondo)', value: 'NVDAONUSDT' },
    { label: 'USO Oil Stock', value: 'USOONUSDT' },
    { label: 'Intel Stock', value: 'INTKONUSDT' },
    { label: 'Ethereum', value: 'ETHUSDT' }
  ];

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
          MAX SLIPPAGE PROTECTED
        </span>
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', color: '#fca5a5', padding: '12px', borderRadius: '8px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
          {/* Symbol */}
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '6px' }}>Stock / Token Symbol</label>
            <input
              type="text"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #475569', borderRadius: '6px', color: '#fff', fontSize: '0.95rem' }}
              required
            />
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {presets.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setSymbol(p.value)}
                  style={{ background: '#334155', border: 'none', color: '#cbd5e1', padding: '3px 8px', borderRadius: '4px', fontSize: '0.75rem', cursor: 'pointer' }}
                >
                  {p.label}
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

        {/* Toggles Row */}
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
            Smart SL Seller Exhaustion Guard
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={filterObi} onChange={e => setFilterObi(e.target.checked)} />
            OBI Support Guard (&ge; 55%)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            Dry Run (Simulated Paper Trading)
          </label>
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
