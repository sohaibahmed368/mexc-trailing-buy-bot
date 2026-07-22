import React, { useState } from 'react';
import { Play, HelpCircle, ToggleLeft, ToggleRight } from 'lucide-react';

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
  const [symbol, setSymbol] = useState('MXUSDT');
  const [activationPrice, setActivationPrice] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [filterSmartSl, setFilterSmartSl] = useState(false);
  const [slBuffer, setSlBuffer] = useState('2');
  const [filterObi, setFilterObi] = useState(false);
  const [filterVolume, setFilterVolume] = useState(false);
  const [filterRsi, setFilterRsi] = useState(false);
  const [autoRepeat, setAutoRepeat] = useState(false);
  const [activationOffset, setActivationOffset] = useState('10');
  const [startImmediately, setStartImmediately] = useState(false);
  const [trailValue, setTrailValue] = useState('0.05');
  const [qtyMode, setQtyMode] = useState<'usdt' | 'coin'>('usdt');
  const [quantity, setQuantity] = useState('');
  const [quoteOrderQty, setQuoteOrderQty] = useState('10');
  const [orderType, setOrderType] = useState('MARKET');
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const parsedTrail = parseFloat(trailValue);
    if (isNaN(parsedTrail) || parsedTrail <= 0) {
      setError('Trail value must be a positive number.');
      return;
    }

    const parsedActivation = activationPrice ? parseFloat(activationPrice) : null;
    if (parsedActivation !== null && (isNaN(parsedActivation) || parsedActivation <= 0)) {
      setError('Activation price must be a positive number.');
      return;
    }

    const parsedOffset = activationOffset ? parseFloat(activationOffset) : null;
    if (autoRepeat && (parsedOffset === null || isNaN(parsedOffset) || parsedOffset <= 0)) {
      setError('Activation dip offset must be a positive number.');
      return;
    }

    const parsedTP = takeProfit ? parseFloat(takeProfit) : null;
    if (parsedTP !== null && (isNaN(parsedTP) || parsedTP <= 0)) {
      setError('Take Profit offset must be a positive number.');
      return;
    }

    const parsedSL = stopLoss ? parseFloat(stopLoss) : null;
    if (parsedSL !== null && (isNaN(parsedSL) || parsedSL <= 0)) {
      setError('Stop Loss offset must be a positive number.');
      return;
    }

    if (qtyMode === 'usdt') {
      const parsedUsdt = parseFloat(quoteOrderQty);
      if (isNaN(parsedUsdt) || parsedUsdt <= 0) {
        setError('USDT amount must be a positive number.');
        return;
      }
    } else {
      const parsedQty = parseFloat(quantity);
      if (isNaN(parsedQty) || parsedQty <= 0) {
        setError('Quantity must be a positive number.');
        return;
      }
    }

    if (!dryRun && !hasCredentials) {
      setError('You must connect your API credentials to place real orders, or enable "Dry Run (Simulation)".');
      return;
    }

    setLoading(true);

    try {
      await onSubmit({
        symbol: symbol.toUpperCase(),
        trailValue,
        quantity: qtyMode === 'coin' ? quantity : '',
        quoteOrderQty: qtyMode === 'usdt' ? quoteOrderQty : '',
        orderType,
        dryRun,
        activationPrice: autoRepeat ? '' : activationPrice,
        takeProfit,
        stopLoss,
        filterSmartSl,
        slBuffer,
        filterObi,
        filterVolume,
        filterRsi,
        autoRepeat,
        activationOffset: autoRepeat ? activationOffset : '',
        startImmediately: autoRepeat ? startImmediately : false
      });
      
      setSuccess(true);
      // Reset parts of the form
      setQuantity('');
      setActivationPrice('');
      setTakeProfit('');
      setStopLoss('');
      setFilterObi(false);
      setFilterVolume(false);
      setFilterRsi(false);
      setAutoRepeat(false);
      setActivationOffset('10');
      setStartImmediately(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to place trailing buy order.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span>Set Trailing Stop Buy</span>
        <span style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: dryRun ? 'rgba(0, 242, 254, 0.15)' : 'rgba(155, 93, 229, 0.15)', color: dryRun ? 'var(--color-cyan)' : 'var(--color-purple)' }}>
          {dryRun ? 'Simulation Mode' : 'Live Trading'}
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Symbol */}
        <div className="form-group">
          <label htmlFor="symbol">Symbol (e.g. BTCUSDT, MXUSDT)</label>
          <div className="input-wrapper">
            <input
              id="symbol"
              type="text"
              list="symbols-datalist"
              placeholder="e.g. BTCUSDT"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={loading}
              required
            />
            <datalist id="symbols-datalist">
              {availableSymbols && availableSymbols.map(sym => (
                <option value={sym} key={sym} />
              ))}
            </datalist>
          </div>
        </div>

        {/* Auto Repeat Loop Toggle */}
        <div className="form-group" style={{ 
          background: 'rgba(255, 255, 255, 0.01)', 
          padding: '0.6rem 0.8rem', 
          borderRadius: '8px', 
          border: '1px solid var(--border-color)',
          marginTop: '0.5rem',
          marginBottom: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={autoRepeat}
              onChange={(e) => setAutoRepeat(e.target.checked)}
              disabled={loading}
              style={{ width: '15px', height: '15px', accentColor: 'var(--color-cyan)', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Enable Auto-Cycle Loop 🔄
              <span title="Automatically resets and restarts the trailing buy after hitting TP/SL to repeat trading indefinitely." style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={13} />
              </span>
            </span>
          </label>

          {autoRepeat && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.8rem', paddingLeft: '1.5rem', color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                checked={startImmediately}
                onChange={(e) => setStartImmediately(e.target.checked)}
                disabled={loading}
                style={{ width: '13px', height: '13px', accentColor: 'var(--color-green)', cursor: 'pointer' }}
              />
              <span>
                Start First Trade Immediately at Market Price ⚡
                <span title="First trade executes immediately at the current price. Subsequent cycles will follow the standard trailing dip rules." style={{ cursor: 'help', color: 'var(--text-muted)', marginLeft: '0.2rem' }}>
                  <HelpCircle size={11} />
                </span>
              </span>
            </label>
          )}
        </div>

        {/* Activation Price or Activation Dip Offset */}
        {autoRepeat ? (
            <div className="form-group">
              <label htmlFor="activationOffset" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                Activation Dip Offset (- %)
                <span title="The percentage drop required from the previous peak price to activate the trailing stop buy." style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                  <HelpCircle size={13} />
                </span>
              </label>
              <div className="input-wrapper">
                <input
                  id="activationOffset"
                  type="number"
                  step="any"
                  placeholder="e.g. 1.0 % dip"
                  value={activationOffset}
                  onChange={(e) => setActivationOffset(e.target.value)}
                  disabled={loading}
                  required
                />
              </div>
            </div>
        ) : (
          <div className="form-group">
            <label htmlFor="activationPrice" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Activation Price Target
              <span title="Bot starts trailing buy tracking only when price crosses this target limit" style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <div className="input-wrapper">
              <input
                id="activationPrice"
                type="number"
                step="any"
                placeholder="e.g. 58000 (blank to activate immediately)"
                value={activationPrice}
                onChange={(e) => setActivationPrice(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        )}

        {/* Trail Value */}
        <div className="form-group">
          <label htmlFor="trailValue" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            Trail Rebound Value (%)
            <span title="If price bottoms at $100 and trail is 0.35%, buy triggers when price rebounds by 0.35% (to $100.35)" style={{ cursor: 'help', color: 'var(--text-muted)' }}>
              <HelpCircle size={13} />
            </span>
          </label>
          <div className="input-wrapper">
            <input
              id="trailValue"
              type="number"
              step="any"
              placeholder="e.g. 0.35 (%)"
              value={trailValue}
              onChange={(e) => setTrailValue(e.target.value)}
              disabled={loading}
              required
            />
          </div>
        </div>

        {/* Take Profit & Stop Loss inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* Take Profit */}
          <div className="form-group">
            <label htmlFor="takeProfit" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Take Profit Target (%)
              <span title="The percentage profit added to execution buy price for placing the Limit Sell order. e.g. 0.60%" style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <div className="input-wrapper">
              <input
                id="takeProfit"
                type="number"
                step="any"
                placeholder="e.g. 0.60 (%)"
                value={takeProfit}
                onChange={(e) => setTakeProfit(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {/* Stop Loss */}
          <div className="form-group">
            <label htmlFor="stopLoss" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Stop Loss Level (%)
              <span title="The percentage loss subtracted from execution buy price for monitoring Market Sell. e.g. 1.8%" style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={13} />
              </span>
            </label>
            <div className="input-wrapper">
              <input
                id="stopLoss"
                type="number"
                step="any"
                placeholder="e.g. 1.8 (%)"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        </div>
                <HelpCircle size={13} />
              </span>
            </label>
            <div className="input-wrapper">
              <input
                id="stopLoss"
                type="number"
                step="any"
                placeholder="e.g. 5 (value to subtract)"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>
        </div>

        {/* Smart Stop Loss Guard Toggle & Buffer */}
        <div className="form-group" style={{ 
          background: 'rgba(255, 255, 255, 0.01)', 
          padding: '0.6rem 0.8rem', 
          borderRadius: '8px', 
          border: '1px solid var(--border-color)',
          marginTop: '0.5rem',
          marginBottom: '0.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem'
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
            <input
              type="checkbox"
              checked={filterSmartSl}
              onChange={(e) => setFilterSmartSl(e.target.checked)}
              disabled={loading}
              style={{ width: '15px', height: '15px', accentColor: 'var(--color-green)', cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              Enable Smart Dynamic Stop Loss Guard 🛡️
              <span title="Checks seller pressure at Stop Loss level. If Bids support >= 45% (buyers absorbing dip), stretches Stop Loss by custom buffer to catch bounce." style={{ cursor: 'help', color: 'var(--text-muted)' }}>
                <HelpCircle size={13} />
              </span>
            </span>
          </label>

          {filterSmartSl && (
            <div style={{ paddingLeft: '1.5rem' }}>
              <label htmlFor="slBuffer" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>
                Smart SL Stretch Buffer (+ USDT)
              </label>
              <input
                id="slBuffer"
                type="number"
                step="any"
                placeholder="e.g. 2.0 (buffer to stretch SL)"
                value={slBuffer}
                onChange={(e) => setSlBuffer(e.target.value)}
                disabled={loading}
                style={{ width: '100%', padding: '0.35rem 0.6rem', fontSize: '0.85rem', borderRadius: '6px' }}
              />
            </div>
          )}
        </div>

        {/* Buy Confirmation Filters Checkboxes */}
        <div className="form-group" style={{ 
          background: 'rgba(255,255,255,0.01)', 
          padding: '0.8rem 1rem', 
          borderRadius: '8px', 
          border: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem'
        }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block' }}>
            Buy Entry Confirmation Filters (Optional)
          </span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filterObi}
                onChange={(e) => setFilterObi(e.target.checked)}
                disabled={loading}
                style={{ width: '15px', height: '15px', accentColor: 'var(--color-cyan)', cursor: 'pointer' }}
              />
              <span>Order Book Imbalance (Bids support &ge; 55% in 1.5% range)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filterVolume}
                onChange={(e) => setFilterVolume(e.target.checked)}
                disabled={loading}
                style={{ width: '15px', height: '15px', accentColor: 'var(--color-cyan)', cursor: 'pointer' }}
              />
              <span>Volume Spike (1m volume &ge; 1.5x of previous 5 avg)</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filterRsi}
                onChange={(e) => setFilterRsi(e.target.checked)}
                disabled={loading}
                style={{ width: '15px', height: '15px', accentColor: 'var(--color-cyan)', cursor: 'pointer' }}
              />
              <span>RSI Oversold (1m candle RSI &le; 35)</span>
            </label>
          </div>
        </div>

        {/* Qty Type Selector */}
        <div className="form-group">
          <label>Quantity Mode</label>
          <div style={{ display: 'flex', gap: '0.5rem', background: 'var(--bg-input)', padding: '3px', borderRadius: '8px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setQtyMode('usdt')}
              disabled={loading}
              style={{
                flex: 1,
                border: 'none',
                padding: '0.4rem',
                fontSize: '0.85rem',
                background: qtyMode === 'usdt' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: qtyMode === 'usdt' ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}
            >
              Spend USDT Amount
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setQtyMode('coin')}
              disabled={loading}
              style={{
                flex: 1,
                border: 'none',
                padding: '0.4rem',
                fontSize: '0.85rem',
                background: qtyMode === 'coin' ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                color: qtyMode === 'coin' ? 'var(--text-primary)' : 'var(--text-secondary)'
              }}
            >
              Buy Coin Quantity
            </button>
          </div>
        </div>

        {/* Qty Input */}
        {qtyMode === 'usdt' ? (
          <div className="form-group">
            <label htmlFor="quoteOrderQty">USDT Amount to Spend</label>
            <div className="input-wrapper">
              <input
                id="quoteOrderQty"
                type="number"
                step="any"
                placeholder="e.g. 50"
                value={quoteOrderQty}
                onChange={(e) => setQuoteOrderQty(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>
        ) : (
          <div className="form-group">
            <label htmlFor="quantity">Coin Quantity to Buy</label>
            <div className="input-wrapper">
              <input
                id="quantity"
                type="number"
                step="any"
                placeholder="e.g. 0.005"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>
        )}

        {/* Order execution type */}
        <div className="form-group">
          <label htmlFor="orderType">Triggered Order Type</label>
          <div className="input-wrapper">
            <select
              id="orderType"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              disabled={loading}
            >
              <option value="MARKET">MARKET BUY (Recommended)</option>
              <option value="LIMIT" disabled>LIMIT BUY (Not supported yet by bot triggers)</option>
            </select>
          </div>
        </div>

        {/* Dry Run Switch */}
        <div 
          className="checkbox-group" 
          onClick={() => setDryRun(!dryRun)}
          style={{ 
            justifyContent: 'space-between', 
            background: 'var(--bg-input)', 
            padding: '0.75rem 1rem', 
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            marginBottom: '1.5rem'
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
            <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Dry Run (Simulation)</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tracks and triggers without placing real order</span>
          </div>
          <div style={{ color: dryRun ? 'var(--color-cyan)' : 'var(--text-muted)' }}>
            {dryRun ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
          </div>
        </div>

        {error && (
          <div style={{ color: 'var(--color-red)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ color: 'var(--color-green)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Trailing order started successfully! Tracking price...
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={loading}>
          <Play size={16} /> {loading ? 'Starting Tracker...' : 'Start Trailing Buy'}
        </button>
      </form>
    </div>
  );
}
