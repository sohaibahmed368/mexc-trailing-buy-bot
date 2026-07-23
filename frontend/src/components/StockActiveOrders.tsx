import React from 'react';
import { XOctagon, Trash2 } from 'lucide-react';

interface StockOrder {
  id: string;
  symbol: string;
  trailValue: number;
  quantity: number | null;
  quoteOrderQty: number | null;
  orderType?: string;
  dryRun: boolean;
  status: string;
  activationPrice: number | null;
  takeProfit: number | null;
  stopLoss: number | null;
  maxSlippagePct?: number;
  filterSmartSl?: boolean;
  slBuffer?: number;
  isSlExtended?: boolean;
  isSlProfitLocked?: boolean;
  lockedSlPrice?: number;
  executionPrice: number | null;
  filterObi?: boolean;
  filterVolumeSpike?: boolean;
  filterRsi?: boolean;
  autoRepeat?: boolean;
  startImmediately?: boolean;
  activationOffset: number | null;
  peakPrice: number | null;
  bottomPrice: number | null;
  triggerPrice: number | null;
  currentPrice: number;
  tradeHistory?: Array<{ cycle: number; buyPrice: number; sellPrice: number; type: string; profit: number; timestamp: string }>;
}

interface StockActiveOrdersProps {
  orders: StockOrder[];
  onCancelOrder: (id: string) => void;
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

export const StockActiveOrders: React.FC<StockActiveOrdersProps> = ({ orders, onCancelOrder }) => {
  const activeOrders = orders.filter(
    (o) => o.status === 'RUNNING' || o.status === 'PENDING_EXECUTION' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE' || o.status === 'MAKER_SELLING'
  );

  if (activeOrders.length === 0) {
    return (
      <div className="empty-state">
        <XOctagon size={48} className="empty-state-icon" style={{ color: 'var(--text-muted)' }} />
        <h3>No Active Stock Bot Orders</h3>
        <p>Use the form above to set up a new low-liquidity stock trailing order.</p>
      </div>
    );
  }

  return (
    <div className="active-orders-grid">
      {activeOrders.map((order) => {
        const priceDiff = order.currentPrice - (order.bottomPrice || 0);
        const triggerDiff = order.trailValue;
        const progressPercent = Math.max(
          0,
          Math.min(100, (priceDiff / triggerDiff) * 100)
        );

        const cumulativeProfit = (order.tradeHistory && order.tradeHistory.length > 0)
          ? order.tradeHistory.reduce((acc: number, t: any) => {
              if (typeof t.profitUsdt === 'number') return acc + t.profitUsdt;
              const buyP = t.buyPrice || 1;
              const qty = order.quantity || (order.quoteOrderQty ? order.quoteOrderQty / buyP : 1);
              return acc + ((t.sellPrice - t.buyPrice) * qty);
            }, 0)
          : ((order as any).totalNetProfit || 0);

        return (
          <div
            className="order-card"
            key={order.id}
            style={{
              borderColor: order.status === 'PENDING_ACTIVATION'
                ? 'rgba(0, 242, 254, 0.4)'
                : order.status === 'TP_SL_ACTIVE'
                ? 'rgba(155, 93, 229, 0.5)'
                : progressPercent > 80
                ? 'rgba(255, 179, 0, 0.5)'
                : 'var(--border-color)'
            }}
          >
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
                {order.filterObi && (
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.15)', color: 'var(--color-cyan)', fontWeight: 600, border: '1px solid rgba(0, 242, 254, 0.3)' }}>
                    OBI 📊
                  </span>
                )}
                {order.filterVolumeSpike && (
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(255, 179, 0, 0.15)', color: 'var(--color-gold)', fontWeight: 600, border: '1px solid rgba(255, 179, 0, 0.3)' }}>
                    VOL 📈
                  </span>
                )}
                {order.filterRsi && (
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(155, 93, 229, 0.15)', color: '#b388ff', fontWeight: 600, border: '1px solid rgba(155, 93, 229, 0.3)' }}>
                    RSI 📉
                  </span>
                )}
                {order.filterSmartSl && (
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: '4px', background: 'rgba(0, 230, 118, 0.15)', color: 'var(--color-green)', fontWeight: 600, border: '1px solid rgba(0, 230, 118, 0.3)' }}>
                    Smart SL 🛡️
                  </span>
                )}
              </div>
              <span className={`status-badge ${order.status === 'PENDING_ACTIVATION' ? 'cancelled' : 'running'}`} style={
                order.status === 'PENDING_ACTIVATION' 
                  ? { backgroundColor: 'rgba(69, 104, 220, 0.15)', color: '#a5b4fc', border: '1px solid rgba(69, 104, 220, 0.3)' }
                  : order.status === 'TP_SL_ACTIVE'
                    ? { backgroundColor: 'rgba(155, 93, 229, 0.15)', color: '#b388ff', border: '1px solid rgba(155, 93, 229, 0.3)' }
                    : order.status === 'MAKER_SELLING'
                      ? { backgroundColor: 'rgba(255, 171, 0, 0.15)', color: '#ffab00', border: '1px solid rgba(255, 171, 0, 0.3)' }
                      : undefined
              }>
                {order.status === 'PENDING_ACTIVATION' ? 'Waiting' : order.status === 'PENDING_EXECUTION' ? 'Executing' : order.status === 'TP_SL_ACTIVE' ? 'Holding (TP/SL)' : order.status === 'MAKER_SELLING' ? 'Pegging (0% Fee)' : 'Trailing'}
              </span>
            </div>

            {/* Config & Profit details */}
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span>Buy Condition: </span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {order.quoteOrderQty
                    ? `Spend ${order.quoteOrderQty} USDT`
                    : `Buy ${order.quantity} Tokens`}
                </strong>
              </div>
              <div style={{ textAlign: 'right', background: 'rgba(255, 255, 255, 0.03)', padding: '0.2rem 0.6rem', borderRadius: '6px', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Profit</span>
                <strong style={{
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  color: cumulativeProfit > 0 ? 'var(--color-green)' : cumulativeProfit < 0 ? 'var(--color-red)' : 'var(--color-cyan)'
                }}>
                  {cumulativeProfit > 0 ? `+${cumulativeProfit.toFixed(4)} USDT` : `${cumulativeProfit.toFixed(4)} USDT`}
                </strong>
              </div>
            </div>

            {/* Trailing Buy activation status details (rendered ONLY when tracking dip to buy) */}
            {(order.status === 'PENDING_ACTIVATION' || order.status === 'RUNNING') && order.activationPrice !== null && (
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

            {/* Position Holding summary (rendered ONLY when bought & holding TP/SL) */}
            {order.status === 'TP_SL_ACTIVE' && order.executionPrice && (
              <div style={{ 
                fontSize: '0.85rem', 
                display: 'flex', 
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '0.25rem',
                padding: '0.3rem 0.5rem',
                background: 'rgba(0, 230, 118, 0.06)',
                borderRadius: '6px',
                border: '1px solid rgba(0, 230, 118, 0.15)'
              }}>
                <span>Bought At: <strong style={{ color: 'var(--color-green)' }}>${fmtPrice(order.executionPrice)}</strong></span>
                <span>
                  Current: <strong style={{ color: 'var(--text-primary)' }}>${fmtPrice(order.currentPrice || order.executionPrice)}</strong>
                  {order.currentPrice && (
                    <span style={{ 
                      marginLeft: '0.35rem', 
                      fontSize: '0.75rem', 
                      fontWeight: 700,
                      color: order.currentPrice >= order.executionPrice ? 'var(--color-green)' : 'var(--color-red)'
                    }}>
                      ({((order.currentPrice - order.executionPrice) / order.executionPrice * 100) >= 0 ? '+' : ''}
                      {((order.currentPrice - order.executionPrice) / order.executionPrice * 100).toFixed(2)}%)
                    </span>
                  )}
                </span>
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
                        ? `$${fmtPrice(order.executionPrice * (1 + order.takeProfit / 100))} (+${order.takeProfit}%)` 
                        : `Buy Price + ${order.takeProfit}%`}
                    </strong>
                  </div>
                )}
                {order.stopLoss !== null && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>{order.isSlExtended ? 'Extended Stop Loss Target:' : 'Stop Loss Target:'}</span>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ color: order.isSlProfitLocked ? 'var(--color-green)' : 'var(--color-red)' }}>
                        {order.executionPrice 
                          ? `$${fmtPrice(
                              (order.isSlProfitLocked && order.lockedSlPrice
                                ? order.lockedSlPrice
                                : (order.executionPrice * (1 - order.stopLoss / 100))) - (order.isSlExtended && order.slBuffer ? ((order.slBuffer / 100) * order.executionPrice) : 0)
                            )} (-${(Number(order.stopLoss) + (order.isSlExtended && order.slBuffer ? Number(order.slBuffer) : 0)).toFixed(3)}%)` 
                          : `Buy Price - ${order.stopLoss}%`}
                      </strong>
                      {order.isSlProfitLocked && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-cyan)', fontWeight: 600 }}>
                          🔒 Profit Lock Active (+${fmtPrice((order.trailValue * 2 / 100) * (order.executionPrice || 100))} | +{(order.trailValue * 2).toFixed(2)}%)
                        </div>
                      )}
                      {order.filterSmartSl && (
                        <div style={{ fontSize: '0.7rem', color: order.isSlExtended ? '#00e676' : 'var(--color-green)', fontWeight: order.isSlExtended ? 600 : 500 }}>
                          {order.isSlExtended 
                            ? `🛡️ Smart SL Extended (+${fmtPrice(((order.slBuffer || 0.15) / 100) * (order.executionPrice || order.currentPrice))} | +${order.slBuffer || 0.15}% Buffer)` 
                            : `🛡️ Smart Guard Active (+${fmtPrice(((order.slBuffer || 0.15) / 100) * (order.executionPrice || order.currentPrice))} | +${order.slBuffer || 0.15}% Buffer)`}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Price levels info */}
            <div className="order-prices">
              <div className="price-item">
                <span className="price-label">Current</span>
                <span className="price-value" style={{ fontSize: '1.05rem' }}>${fmtPrice(order.currentPrice)}</span>
              </div>

              {order.status === 'TP_SL_ACTIVE' ? (
                <div className="price-item highlight">
                  <span className="price-label">Bought At</span>
                  <span className="price-value" style={{ color: 'var(--color-green)' }}>${fmtPrice(order.executionPrice)}</span>
                </div>
              ) : (
                <>
                  <div className="price-item">
                    <span className="price-label">Low Dip</span>
                    <span className="price-value">${fmtPrice(order.bottomPrice)}</span>
                  </div>
                  <div className="price-item highlight">
                    <span className="price-label">Buy Trigger</span>
                    <span className="price-value">${fmtPrice(order.triggerPrice)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Trailing Buy Progress bar */}
            {order.status === 'RUNNING' && order.bottomPrice !== null && (
              <div style={{ marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>
                  <span>Trailing Rebound Progress</span>
                  <span>{progressPercent.toFixed(1)}%</span>
                </div>
                <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ width: `${progressPercent}%`, height: '100%', background: progressPercent > 80 ? 'var(--color-gold)' : 'var(--color-cyan)', transition: 'width 0.3s ease' }} />
                </div>
              </div>
            )}

            {/* Footer action button */}
            <div className="order-footer" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => onCancelOrder(order.id)}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                <Trash2 size={14} />
                Cancel Stock Order
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
