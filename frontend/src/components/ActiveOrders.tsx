import { XOctagon, Clock } from 'lucide-react';

interface Order {
  id: string;
  symbol: string;
  trailValue: number;
  quantity: number | null;
  quoteOrderQty: number | null;
  orderType: string;
  dryRun: boolean;
  status: string;
  activationPrice: number | null;
  activationDirection: string | null;
  activatedAt: string | null;
  takeProfit: number | null;
  stopLoss: number | null;
  filterSmartSl?: boolean;
  slBuffer?: number;
  isSlExtended?: boolean;
  isSlProfitLocked?: boolean;
  lockedSlPrice?: number;
  mexcSellOrderId: string | null;
  sellExecutionPrice: number | null;
  sellTriggeredAt: string | null;
  filterObi: boolean;
  filterVolume: boolean;
  filterRsi: boolean;
  autoRepeat: boolean;
  startImmediately: boolean;
  activationOffset: number | null;
  reboundOffset: number | null;
  peakPrice: number | null;
  localBottom: number | null;
  tradeHistory: Array<{ cycle: number; buyPrice: number; sellPrice: number; type: string; profit: number; timestamp: string }>;
  initialPrice: number;
  bottomPrice: number | null;
  triggerPrice: number | null;
  currentPrice: number;
  createdAt: string;
  triggeredAt: string | null;
  mexcOrderId: string | null;
  executionPrice: number | null;
}

interface ActiveOrdersProps {
  orders: Order[];
  onCancel: (orderId: string) => void;
}

export function fmtPrice(val: number | string | null | undefined): string {
  if (val === null || val === undefined || val === '') return '-';
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return '-';
  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8
  });
}

export default function ActiveOrders({ orders, onCancel }: ActiveOrdersProps) {
  const activeOrders = orders.filter(
    (o) => o.status === 'RUNNING' || o.status === 'PENDING_EXECUTION' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE'
  );

  if (activeOrders.length === 0) {
    return (
      <div className="empty-state">
        <XOctagon size={48} className="empty-state-icon" style={{ color: 'var(--text-muted)' }} />
        <h3>No Active Trailing Orders</h3>
        <p>Use the form on the left to set up a new trailing stop buy order.</p>
      </div>
    );
  }

  return (
    <div className="active-orders-grid">
      {activeOrders.map((order) => {
        // Calculate progress percentage from bottom price to trigger price
        const priceDiff = order.currentPrice - (order.bottomPrice || 0);
        const triggerDiff = order.trailValue;
        const progressPercent = Math.max(
          0,
          Math.min(100, (priceDiff / triggerDiff) * 100)
        );

        const currentSlOffset = order.isSlExtended ? (order.stopLoss! + (order.slBuffer || 0)) : order.stopLoss;

        return (
          <div className="order-card" key={order.id} style={{
            borderColor: order.status === 'PENDING_ACTIVATION'
              ? 'rgba(0, 242, 254, 0.4)'
              : order.status === 'TP_SL_ACTIVE'
              ? 'rgba(155, 93, 229, 0.5)'
              : progressPercent > 80
              ? 'rgba(255, 179, 0, 0.5)'
              : 'var(--border-color)'
          }}>
            {/* Header */}
            <div className="order-header">
              <div className="order-symbol-badge" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                <span className="order-symbol">{order.symbol}</span>
                {order.autoRepeat && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 230, 118, 0.15)', color: 'var(--color-green)', fontWeight: 600 }}>
                    Loop 🔄
                  </span>
                )}
                <span className={`order-mode ${order.dryRun ? 'dry' : 'real'}`}>
                  {order.dryRun ? 'Simulation' : 'Live Trade'}
                </span>
              </div>
              <span className={`status-badge ${order.status === 'PENDING_ACTIVATION' ? 'cancelled' : 'running'}`} style={
                order.status === 'PENDING_ACTIVATION' 
                  ? { backgroundColor: 'rgba(69, 104, 220, 0.15)', color: '#a5b4fc', border: '1px solid rgba(69, 104, 220, 0.3)' }
                  : order.status === 'TP_SL_ACTIVE'
                    ? { backgroundColor: 'rgba(155, 93, 229, 0.15)', color: '#b388ff', border: '1px solid rgba(155, 93, 229, 0.3)' }
                    : undefined
              }>
                {order.status === 'PENDING_ACTIVATION' ? 'Waiting' : order.status === 'PENDING_EXECUTION' ? 'Executing' : order.status === 'TP_SL_ACTIVE' ? 'Holding (TP/SL)' : 'Trailing'}
              </span>
            </div>

            {/* Config details */}
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span>Buy Condition: </span>
              <strong style={{ color: 'var(--text-primary)' }}>
                {order.quoteOrderQty
                  ? `Spend ${order.quoteOrderQty} USDT`
                  : `Buy ${order.quantity} Coin`}
              </strong>
            </div>

            {/* Activation status details */}
            {order.activationPrice !== null && (
              <div style={{ 
                fontSize: '0.85rem', 
                color: 'var(--text-secondary)', 
                display: 'flex', 
                justifyContent: 'space-between',
                marginTop: '0.25rem',
                padding: '0.25rem 0.5rem',
                background: 'rgba(255, 255, 255, 0.02)',
                borderRadius: '6px'
              }}>
                {order.autoRepeat && order.peakPrice !== null ? (
                  <>
                    <span>Peak Price: <strong style={{ color: 'var(--text-primary)' }}>${fmtPrice(order.peakPrice)}</strong></span>
                    <span>Target Dip: <strong style={{ color: 'var(--color-cyan)' }}>${fmtPrice(order.activationPrice)}</strong></span>
                  </>
                ) : (
                  <>
                    <span>Activation Target: <strong style={{ color: 'var(--text-primary)' }}>${fmtPrice(order.activationPrice)}</strong></span>
                    <span style={{ 
                      color: order.status !== 'PENDING_ACTIVATION' ? 'var(--color-green)' : 'var(--text-muted)',
                      fontWeight: 600
                    }}>
                      {order.status !== 'PENDING_ACTIVATION' ? 'Activated ✓' : 'Pending ✗'}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Take Profit & Stop Loss details */}
            {(order.takeProfit !== null || order.stopLoss !== null) && (
              <div style={{ 
                fontSize: '0.85rem', 
                color: 'var(--text-secondary)', 
                display: 'flex', 
                flexDirection: 'column',
                gap: '0.2rem',
                marginTop: '0.25rem',
                padding: '0.4rem 0.5rem',
                background: 'rgba(255, 255, 255, 0.01)',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.03)'
              }}>
                {order.takeProfit !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Take Profit Target:</span>
                    <strong style={{ color: 'var(--color-green)' }}>
                      {order.executionPrice 
                        ? `$${fmtPrice(order.executionPrice + order.takeProfit)}` 
                        : `Buy Price + ${fmtPrice(order.takeProfit)}`}
                    </strong>
                  </div>
                )}
                {order.stopLoss !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Stop Loss Target:</span>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ color: order.isSlProfitLocked ? 'var(--color-green)' : 'var(--color-red)' }}>
                        {order.executionPrice 
                          ? `$${fmtPrice(
                              order.isSlProfitLocked && order.lockedSlPrice
                                ? (order.isSlExtended && order.slBuffer ? order.lockedSlPrice - order.slBuffer : order.lockedSlPrice)
                                : (order.executionPrice - currentSlOffset!)
                            )}` 
                          : `Buy Price - ${fmtPrice(currentSlOffset!)}`}
                      </strong>
                      {order.isSlProfitLocked && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-cyan)', fontWeight: 600 }}>
                          🔒 Profit Lock Active (+${fmtPrice(order.trailValue * 2)} USDT)
                        </div>
                      )}
                      {order.filterSmartSl && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-green)', fontWeight: 500 }}>
                          🛡️ Smart Guard Active (+${fmtPrice(order.slBuffer || 2)} Buffer)
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Enabled Indicators Badges */}
            {(order.filterObi || order.filterVolume || order.filterRsi || order.filterSmartSl || order.isSlProfitLocked) && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem', padding: '0 0.1rem' }}>
                {order.isSlProfitLocked && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(0, 242, 254, 0.15)', color: 'var(--color-cyan)', border: '1px solid rgba(0, 242, 254, 0.3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    🔒 Profit Locked (+${fmtPrice(order.trailValue * 2)} Above Buy)
                  </span>
                )}
                {order.filterSmartSl && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(0, 230, 118, 0.12)', color: 'var(--color-green)', border: '1px solid rgba(0, 230, 118, 0.3)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}>
                    🛡️ Smart SL Guard Active (Buffer: +${fmtPrice(order.slBuffer || 2)} USDT)
                  </span>
                )}
                {order.filterObi && (
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.08)', color: 'var(--color-cyan)', border: '1px solid rgba(0, 242, 254, 0.15)', fontWeight: 500 }}>
                    OBI Confirm
                  </span>
                )}
                {order.filterVolume && (
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.08)', color: 'var(--color-cyan)', border: '1px solid rgba(0, 242, 254, 0.15)', fontWeight: 500 }}>
                    Volume Spike
                  </span>
                )}
                {order.filterRsi && (
                  <span style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.08)', color: 'var(--color-cyan)', border: '1px solid rgba(0, 242, 254, 0.15)', fontWeight: 500 }}>
                    RSI Oversold
                  </span>
                )}
              </div>
            )}

            {/* Price Cards Grid */}
            <div className="order-prices">
              <div className="price-card current">
                <span className="price-label">Current Price</span>
                <span className="price-value">${fmtPrice(order.currentPrice)}</span>
              </div>
              <div className="price-card bottom">
                <span className="price-label">{order.status === 'PENDING_ACTIVATION' ? 'Activation Target' : 'Lowest Bottom'}</span>
                <span className="price-value">
                  ${order.status === 'PENDING_ACTIVATION' 
                    ? fmtPrice(order.activationPrice) 
                    : fmtPrice(order.bottomPrice)}
                </span>
              </div>
              <div className="price-card trigger">
                <span className="price-label">Buy Trigger (≥)</span>
                <span className="price-value">
                  {order.triggerPrice ? `$${fmtPrice(order.triggerPrice)}` : 'Inactive'}
                </span>
              </div>
              <div className="price-card trail">
                <span className="price-label">Trail Value</span>
                <span className="price-value">+${fmtPrice(order.trailValue)}</span>
              </div>
            </div>

            {/* Tracking Progress */}
            {order.status === 'PENDING_ACTIVATION' ? (
              <div className="tracking-progress" style={{ backgroundColor: 'rgba(255, 255, 255, 0.01)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--color-cyan)', fontWeight: 500 }}>Awaiting Dip Activation...</span>
                  <span>
                    Target: {order.activationDirection === 'DOWN' ? '≤' : '≥'} ${fmtPrice(order.activationPrice)}
                  </span>
                </div>
              </div>
            ) : order.status === 'TP_SL_ACTIVE' ? (
              <div className="tracking-progress" style={{ backgroundColor: 'rgba(255, 255, 255, 0.01)', padding: '0.6rem 0.8rem', borderRadius: '8px', border: '1px dashed rgba(155, 93, 229, 0.3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#b388ff', fontWeight: 500 }}>Monitoring TP/SL Targets...</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    Bought at: ${fmtPrice(order.executionPrice)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="tracking-progress">
                <div className="progress-labels">
                  <span>Bottom (${fmtPrice(order.bottomPrice)})</span>
                  <span style={{ color: progressPercent > 80 ? 'var(--color-amber)' : 'inherit', fontWeight: progressPercent > 80 ? 600 : 'normal' }}>
                    {progressPercent.toFixed(1)}% to Trigger
                  </span>
                  <span>Trigger (${fmtPrice(order.triggerPrice)})</span>
                </div>
                <div className="progress-bar-bg" title={`${progressPercent.toFixed(1)}% completed`}>
                  <div 
                    className="progress-bar-fill" 
                    style={{ 
                      width: `${progressPercent}%`,
                      background: progressPercent > 85
                        ? 'linear-gradient(135deg, #ffb300 0%, #ff8f00 100%)' 
                        : 'var(--gradient-primary)'
                    }} 
                  />
                  <div className="progress-bar-bottom-marker" style={{ left: '0%' }} />
                </div>
              </div>
            )}

            {/* Trade History (Completed Cycles) */}
            {order.tradeHistory && order.tradeHistory.length > 0 && (
              <div style={{ 
                marginTop: '0.8rem', 
                borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                paddingTop: '0.6rem'
              }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Completed Cycles History ({order.tradeHistory.length})
                </span>
                <div style={{ 
                  maxHeight: '120px', 
                  overflowY: 'auto', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '0.3rem',
                  paddingRight: '0.2rem'
                }}>
                  {order.tradeHistory.map((trade: any) => (
                    <div key={trade.cycle} style={{ 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      fontSize: '0.75rem',
                      background: 'rgba(255, 255, 255, 0.01)',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid rgba(255, 255, 255, 0.02)'
                    }}>
                      <span>
                        Cycle #{trade.cycle} ({trade.type === 'TAKE_PROFIT' ? 'TP hit' : 'SL hit'})
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>
                        Buy: ${fmtPrice(trade.buyPrice)} &rarr; Sell: ${fmtPrice(trade.sellPrice)}
                      </span>
                      <strong style={{ color: trade.profit >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                        {trade.profit >= 0 ? '+' : ''}${fmtPrice(trade.profit)}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Time info and cancel button */}
            <div className="order-footer">
              <div className="order-time">
                <Clock size={12} />
                <span>Started: {new Date(order.createdAt).toLocaleTimeString()}</span>
              </div>
              
              <button
                type="button"
                className="btn btn-secondary btn-danger btn-sm"
                onClick={() => onCancel(order.id)}
                style={{ 
                  width: 'auto', 
                  padding: '0.35rem 0.6rem', 
                  fontSize: '0.75rem', 
                  backgroundColor: 'rgba(255, 23, 68, 0.1)', 
                  border: '1px solid rgba(255, 23, 68, 0.2)',
                  color: 'var(--color-red)'
                }}
              >
                Cancel Tracking
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
