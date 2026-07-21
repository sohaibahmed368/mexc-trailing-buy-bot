import React from 'react';

interface StockOrder {
  id: string;
  symbol: string;
  status: string;
  dryRun: boolean;
  createdAt: string;
  tradeHistory?: Array<{
    cycle: number;
    buyPrice: number;
    sellPrice: number;
    profit: number;
    type: string;
    timestamp: string;
  }>;
}

interface StockOrderHistoryProps {
  orders: StockOrder[];
}

export const StockOrderHistory: React.FC<StockOrderHistoryProps> = ({ orders }) => {
  const finishedOrders = orders.filter(o => o.status === 'TRIGGERED' || o.status === 'CANCELLED' || o.status === 'FAILED' || (o.tradeHistory && o.tradeHistory.length > 0));

  if (finishedOrders.length === 0) {
    return (
      <div style={{ background: '#1e293b', padding: '24px', borderRadius: '12px', border: '1px solid #334155', color: '#94a3b8', textAlign: 'center' }}>
        No historical Stock Bot trades yet.
      </div>
    );
  }

  return (
    <div style={{ background: '#1e293b', padding: '20px', borderRadius: '12px', border: '1px solid #334155', color: '#f8fafc' }}>
      <h3 style={{ marginTop: 0, color: '#38bdf8' }}>📜 Stock Bot Completed Trade History</h3>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ padding: '8px' }}>Symbol</th>
              <th style={{ padding: '8px' }}>Mode</th>
              <th style={{ padding: '8px' }}>Cycle #</th>
              <th style={{ padding: '8px' }}>Buy Price</th>
              <th style={{ padding: '8px' }}>Sell Price</th>
              <th style={{ padding: '8px' }}>Profit / Loss</th>
              <th style={{ padding: '8px' }}>Exit Type</th>
            </tr>
          </thead>
          <tbody>
            {finishedOrders.flatMap(o => (o.tradeHistory || []).map((t, idx) => (
              <tr key={`${o.id}-${idx}`} style={{ borderBottom: '1px solid #1e293b' }}>
                <td style={{ padding: '8px', fontWeight: 'bold' }}>{o.symbol}</td>
                <td style={{ padding: '8px' }}>
                  <span style={{ color: o.dryRun ? '#eab308' : '#22c55e', fontSize: '0.75rem', fontWeight: 'bold' }}>
                    {o.dryRun ? 'DRY RUN' : 'REAL'}
                  </span>
                </td>
                <td style={{ padding: '8px' }}>Cycle #{t.cycle}</td>
                <td style={{ padding: '8px' }}>${t.buyPrice.toFixed(4)}</td>
                <td style={{ padding: '8px' }}>${t.sellPrice.toFixed(4)}</td>
                <td style={{ padding: '8px', color: t.profit >= 0 ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                  {t.profit >= 0 ? `+${t.profit.toFixed(4)} USDT` : `${t.profit.toFixed(4)} USDT`}
                </td>
                <td style={{ padding: '8px', color: t.type === 'TAKE_PROFIT' ? '#22c55e' : '#ef4444' }}>
                  {t.type}
                </td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
