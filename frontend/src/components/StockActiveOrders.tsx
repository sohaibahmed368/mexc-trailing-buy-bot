import React from 'react';

interface StockOrder {
  id: string;
  symbol: string;
  status: string;
  trailValue: number;
  quantity?: number;
  takeProfit?: number;
  stopLoss?: number;
  maxSlippagePct?: number;
  dryRun: boolean;
  peakPrice?: number;
  activationPrice?: number;
  bottomPrice?: number;
  triggerPrice?: number;
  currentPrice?: number;
  executionPrice?: number;
  isSlProfitLocked?: boolean;
  lockedSlPrice?: number;
  isSlExtended?: boolean;
  tradeHistory?: any[];
}

interface StockActiveOrdersProps {
  orders: StockOrder[];
  onCancelOrder: (id: string) => void;
}

export const StockActiveOrders: React.FC<StockActiveOrdersProps> = ({ orders, onCancelOrder }) => {
  const activeOrders = orders.filter(o => o.status === 'RUNNING' || o.status === 'PENDING_ACTIVATION' || o.status === 'TP_SL_ACTIVE');

  if (activeOrders.length === 0) {
    return (
      <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', color: '#94a3b8', textAlign: 'center' }}>
        No active Stock Bot orders. Create a new stock order above.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
      {activeOrders.map(order => (
        <div key={order.id} style={{ background: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #0284c7', color: '#f8fafc', position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#38bdf8' }}>{order.symbol}</h3>
            <div style={{ display: 'flex', gap: '6px' }}>
              <span style={{ background: order.dryRun ? '#eab308' : '#22c55e', color: '#000', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                {order.dryRun ? 'DRY RUN' : 'REAL'}
              </span>
              <span style={{ background: '#0284c7', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>
                SLIPPAGE &le; {order.maxSlippagePct || 0.5}%
              </span>
            </div>
          </div>

          <div style={{ fontSize: '0.85rem', lineHeight: '1.6', color: '#cbd5e1' }}>
            <div>Status: <strong style={{ color: order.status === 'TP_SL_ACTIVE' ? '#22c55e' : '#38bdf8' }}>{order.status}</strong></div>
            <div>Current Price: <strong>{order.currentPrice ? `$${order.currentPrice}` : '-'}</strong></div>
            {order.executionPrice && <div>Buy Execution Price: <strong style={{ color: '#38bdf8' }}>${order.executionPrice}</strong></div>}

            {order.status === 'PENDING_ACTIVATION' && (
              <>
                <div>Peak Price: <strong>${order.peakPrice}</strong></div>
                <div>Activation Price: <strong style={{ color: '#eab308' }}>${order.activationPrice}</strong></div>
              </>
            )}

            {order.status === 'RUNNING' && (
              <>
                <div>Bottom Price: <strong>${order.bottomPrice}</strong></div>
                <div>Buy Trigger Price: <strong style={{ color: '#22c55e' }}>${order.triggerPrice}</strong></div>
              </>
            )}

            {order.status === 'TP_SL_ACTIVE' && (
              <>
                {order.takeProfit && <div>Take Profit Target: <strong style={{ color: '#22c55e' }}>${(order.executionPrice! + order.takeProfit).toFixed(4)}</strong></div>}
                {order.isSlProfitLocked ? (
                  <div style={{ color: '#06b6d4', fontWeight: 'bold' }}>🔒 Locked Profit SL: ${order.lockedSlPrice?.toFixed(4)}</div>
                ) : (
                  order.stopLoss && <div>Stop Loss Target: <strong style={{ color: '#ef4444' }}>${(order.executionPrice! - order.stopLoss).toFixed(4)}</strong></div>
                )}
                {order.isSlExtended && <div style={{ color: '#22c55e', fontSize: '0.75rem' }}>🛡️ Smart SL Extended (+Buffer)</div>}
              </>
            )}

            {order.tradeHistory && order.tradeHistory.length > 0 && (
              <div style={{ marginTop: '8px', color: '#a855f7', fontSize: '0.8rem' }}>
                Completed Cycles: {order.tradeHistory.length}
              </div>
            )}
          </div>

          <button
            onClick={() => onCancelOrder(order.id)}
            style={{ marginTop: '16px', width: '100%', padding: '8px', background: '#ef4444', border: 'none', borderRadius: '6px', color: '#fff', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Cancel Stock Order
          </button>
        </div>
      ))}
    </div>
  );
};
