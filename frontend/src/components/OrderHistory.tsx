import { History, Trash2 } from 'lucide-react';

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
  error: string | null;
}

interface OrderHistoryProps {
  orders: Order[];
  onClear: () => void;
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

export default function OrderHistory({ orders, onClear }: OrderHistoryProps) {
  const historyOrders = orders.filter(
    (o) => o.status !== 'RUNNING' && o.status !== 'PENDING_EXECUTION' && o.status !== 'PENDING_ACTIVATION' && o.status !== 'TP_SL_ACTIVE'
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'TRIGGERED':
        return <span className="status-badge triggered">Triggered</span>;
      case 'CANCELLED':
        return <span className="status-badge cancelled">Cancelled</span>;
      case 'FAILED':
        return <span className="status-badge failed">Failed</span>;
      default:
        return <span className="status-badge">{status}</span>;
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <History size={18} /> Order History
        </span>
        {historyOrders.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onClear}
            style={{ width: 'auto', gap: '0.25rem', border: '1px solid rgba(255, 23, 68, 0.2)', color: 'var(--color-red)' }}
          >
            <Trash2 size={12} /> Clear History
          </button>
        )}
      </div>

      {historyOrders.length === 0 ? (
        <div className="empty-state">
          <History size={48} className="empty-state-icon" />
          <h3>No History Found</h3>
          <p>Completed, cancelled, or failed trailing stop orders will appear here.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Symbol</th>
                <th>Mode</th>
                <th>Buy Condition</th>
                <th>Target Trail</th>
                <th>Trigger Price</th>
                <th>Exec Price</th>
                <th>Status / Info</th>
              </tr>
            </thead>
            <tbody>
              {historyOrders.map((order) => (
                <tr key={order.id}>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {order.triggeredAt 
                      ? new Date(order.triggeredAt).toLocaleTimeString() 
                      : new Date(order.createdAt).toLocaleTimeString()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{order.symbol}</td>
                  <td>
                    <span style={{ 
                      fontSize: '0.75rem', 
                      color: order.dryRun ? 'var(--color-cyan)' : 'var(--color-purple)' 
                    }}>
                      {order.dryRun ? 'Simulated' : 'Live'}
                    </span>
                  </td>
                  <td>
                    {order.quoteOrderQty 
                      ? `${order.quoteOrderQty} USDT` 
                      : `${order.quantity} base`}
                  </td>
                  <td className="mono-cell">+{order.trailValue}</td>
                  <td className="mono-cell">{order.triggerPrice ? fmtPrice(order.triggerPrice) : '-'}</td>
                  <td className="mono-cell" style={{ fontWeight: 600, color: order.status === 'TRIGGERED' ? 'var(--color-green)' : 'inherit' }}>
                    {order.executionPrice ? fmtPrice(order.executionPrice) : '-'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {getStatusBadge(order.status)}
                      {order.sellExecutionPrice && (
                        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-green)', background: 'rgba(0, 230, 118, 0.08)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>
                          Sold @ ${fmtPrice(order.sellExecutionPrice)}
                        </span>
                      )}
                    </div>
                      
                      {order.mexcOrderId && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }} title={`Order ID: ${order.mexcOrderId}`}>
                          MEXC ID: {order.mexcOrderId.substring(0, 10)}...
                        </span>
                      )}
                      
                      {order.error && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-red)' }} title={order.error}>
                          Err: {order.error.substring(0, 25)}{order.error.length > 25 ? '...' : ''}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
