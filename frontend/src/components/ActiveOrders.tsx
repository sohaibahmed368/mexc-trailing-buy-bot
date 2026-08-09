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
  customObiThreshold?: number;
  customRsiThreshold?: number;
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
    (o) => o.status !== 'TRIGGERED' && o.status !== 'CANCELLED' && o.status !== 'FAILED'
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
        const priceDiff = (order.currentPrice || 0) - (order.bottomPrice || 0);
        const triggerDiff = order.trailValue || 1;
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

            {/* Config & Profit details */}
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span>Buy Condition: </span>
                <strong style={{ color: 'var(--text-primary)' }}>
                  {order.quoteOrderQty
                    ? `Spend ${order.quoteOrderQty} USDT`
                    : `Buy ${order.quantity} Coin`}
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

            {/* Current Market Price & Bought Price Bar */}
            <div style={{ 
              fontSize: '0.85rem', 
              display: 'flex', 
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '0.4rem',
              padding: '0.4rem 0.6rem',
              background: '#020617',
              borderRadius: '6px',
              border: '1px solid #1e293b'
            }}>
              <span>
                Current Price: <strong style={{ color: '#38bdf8' }}>${fmtPrice(order.currentPrice)}</strong>
              </span>
              {order.status === 'TP_SL_ACTIVE' && order.executionPrice && (
                <span>
                  Bought At: <strong style={{ color: '#34d399' }}>${fmtPrice(order.executionPrice)}</strong>
                </span>
              )}
            </div>

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
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Enabled Indicators Badges */}
            {(order.filterObi || order.status === 'TP_SL_ACTIVE' || order.filterSmartSl || order.isSlProfitLocked) && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.4rem', padding: '0 0.1rem' }}>
                {order.filterObi && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid #10b981', fontWeight: 700 }}>
                    🎯 Dual Gate (OBI ≥ {order.customObiThreshold !== undefined ? order.customObiThreshold : 55}% & 4h 15m RSI ≤ {order.customRsiThreshold !== undefined ? order.customRsiThreshold : 40})
                  </span>
                )}
                {order.status === 'TP_SL_ACTIVE' && (
                  <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444', border: '1px solid #ef4444', fontWeight: 700 }}>
                    🚨 RSI ≤ 20.0 Emergency SL Active
                  </span>
                )}
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
                  {order.tradeHistory.map((trade: any) => {
                    const cycleProfitUsdt = typeof trade.profitUsdt === 'number'
                      ? trade.profitUsdt
                      : (trade.sellPrice && trade.buyPrice && order.quoteOrderQty)
                      ? ((trade.sellPrice - trade.buyPrice) / trade.buyPrice) * order.quoteOrderQty
                      : (trade.profit || 0);

                    return (
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
                        <strong style={{ color: cycleProfitUsdt >= 0 ? 'var(--color-green)' : 'var(--color-red)' }}>
                          {cycleProfitUsdt >= 0 ? '+' : ''}${cycleProfitUsdt.toFixed(4)} USDT
                        </strong>
                      </div>
                    );
                  })}
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
