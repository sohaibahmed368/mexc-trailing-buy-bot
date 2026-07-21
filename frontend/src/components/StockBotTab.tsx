import React, { useState, useEffect } from 'react';
import { StockOrderForm } from './StockOrderForm';
import { StockActiveOrders } from './StockActiveOrders';
import { StockOrderHistory } from './StockOrderHistory';

interface StockBotTabProps {
  apiBaseUrl: string;
}

export const StockBotTab: React.FC<StockBotTabProps> = ({ apiBaseUrl }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);

  const fetchStockOrders = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/stock-orders`);
      const data = await res.json();
      if (Array.isArray(data)) setOrders(data);
    } catch (e) {
      // ignore
    }
  };

  const fetchStockLogs = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/stock-logs`);
      const data = await res.json();
      if (Array.isArray(data)) setLogs(data);
    } catch (e) {
      // ignore
    }
  };

  const handleCancelOrder = async (id: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/stock-orders/${id}`, { method: 'DELETE' });
      fetchStockOrders();
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    fetchStockOrders();
    fetchStockLogs();

    const interval = setInterval(() => {
      fetchStockOrders();
      fetchStockLogs();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <StockOrderForm onOrderCreated={fetchStockOrders} apiBaseUrl={apiBaseUrl} />
      
      <div>
        <h3 style={{ color: '#38bdf8', marginBottom: '12px' }}>⚡ Active Stock Bot Orders</h3>
        <StockActiveOrders orders={orders} onCancelOrder={handleCancelOrder} />
      </div>

      <StockOrderHistory orders={orders} />

      {/* Stock Logs Console */}
      <div style={{ background: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #334155', maxHeight: '250px', overflowY: 'auto' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#38bdf8', fontSize: '0.9rem' }}>📟 Stock Bot Live Console Logs</h4>
        <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: '1.5' }}>
          {logs.slice(0, 50).map((log, idx) => (
            <div key={log.id || idx} style={{ color: log.type === 'error' ? '#ef4444' : log.type === 'warning' ? '#eab308' : log.type === 'success' ? '#22c55e' : '#94a3b8' }}>
              [{new Date(log.timestamp).toLocaleTimeString()}] {log.symbol ? `[${log.symbol}] ` : ''}{log.message}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
