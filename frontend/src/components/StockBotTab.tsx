import React, { useState, useEffect, useRef } from 'react';
import { Terminal, Ban } from 'lucide-react';
import { AlpacaCredentialForm } from './AlpacaCredentialForm';
import { StockOrderForm } from './StockOrderForm';
import { StockActiveOrders } from './StockActiveOrders';
import { StockOrderHistory } from './StockOrderHistory';

interface StockBotTabProps {
  apiBaseUrl: string;
  availableSymbols?: string[];
}

export const StockBotTab: React.FC<StockBotTabProps> = ({ apiBaseUrl, availableSymbols = [] }) => {
  const [orders, setOrders] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);

  const fetchStockOrders = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/alpaca/stock-orders`);
      const data = await res.json();
      if (Array.isArray(data)) setOrders(data);
    } catch (e) {
      // ignore
    }
  };

  const fetchStockLogs = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/api/alpaca/stock-logs`);
      const data = await res.json();
      if (Array.isArray(data)) setLogs(data);
    } catch (e) {
      // ignore
    }
  };

  const handleCancelOrder = async (id: string) => {
    try {
      await fetch(`${apiBaseUrl}/api/alpaca/stock-orders/${id}`, { method: 'DELETE' });
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

  // Ref to track if user is currently at the bottom of the log stream
  const isAtBottomRef = useRef<boolean>(true);

  // Auto scroll to bottom when new logs arrive (ONLY if user is at bottom)
  useEffect(() => {
    if (consoleRef.current && isAtBottomRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    isAtBottomRef.current = distanceFromBottom <= 35;
  };

  const chronologicalLogs = [...logs].reverse();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Decoupled Alpaca Credentials Config Form */}
      <AlpacaCredentialForm onSaveSuccess={() => { fetchStockOrders(); fetchStockLogs(); }} />

      <StockOrderForm 
        onOrderCreated={fetchStockOrders} 
        apiBaseUrl={apiBaseUrl} 
        availableSymbols={['NVDA', 'AAPL', 'TSLA', 'MSFT', 'SPY', 'AMZN', 'QQQ', 'AMD', ...availableSymbols]} 
        submitEndpoint={`${apiBaseUrl}/api/alpaca/stock-orders`}
      />
      
      <div>
        <h3 style={{ color: '#38bdf8', marginBottom: '12px' }}>⚡ Active Stock Bot Orders (Alpaca Engine)</h3>
        <StockActiveOrders orders={orders} onCancelOrder={handleCancelOrder} />
      </div>

      <StockOrderHistory orders={orders} />

      {/* Stock Bot Terminal Console Logs (Alpaca Engine) */}
      <div className="card">
        <div className="card-title">
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Terminal size={18} /> Alpaca Stock Bot Live Terminal Operations Logs
          </span>
          <span style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(0, 242, 254, 0.15)', color: 'var(--color-cyan)', fontWeight: 600 }}>
            Alpaca Live Stream
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="console-logs" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
            <Ban size={24} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
            No Alpaca stock logs recorded yet. Configure your Alpaca API Keys and start a stock trailing order.
          </div>
        ) : (
          <div className="console-logs" ref={consoleRef} onScroll={handleScroll} style={{ maxHeight: '280px', overflowY: 'auto' }}>
            {chronologicalLogs.map((log) => {
              const timeStr = new Date(log.timestamp).toLocaleTimeString();
              return (
                <div className={`log-line ${log.type}`} key={log.id}>
                  <span className="log-time">[{timeStr}]</span>
                  <span className="log-msg">
                    {log.symbol && <span style={{ color: 'var(--color-cyan)', fontWeight: 600 }}>{log.symbol}: </span>}
                    {log.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
