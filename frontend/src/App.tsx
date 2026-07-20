import { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { Wifi, WifiOff } from 'lucide-react';
import CredentialForm from './components/CredentialForm';
import Balances from './components/Balances';
import OrderForm from './components/OrderForm';
import ActiveOrders from './components/ActiveOrders';
import OrderHistory from './components/OrderHistory';
import LogsConsole from './components/LogsConsole';
import OrderBookAnalysis from './components/OrderBookAnalysis';
import ScalpRadar from './components/ScalpRadar';

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

interface Config {
  hasCredentials: boolean;
  apiKey: string;
  saveToDisk: boolean;
  pollInterval: number;
}

interface Balance {
  asset: string;
  free: number;
  locked: number;
  price?: number;
  estUsdtValue?: number;
}

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

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: string;
  symbol: string | null;
}

export default function App() {
  const [config, setConfig] = useState<Config>({
    hasCredentials: false,
    apiKey: '',
    saveToDisk: false,
    pollInterval: 1000
  });
  const [balances, setBalances] = useState<Balance[]>([]);
  const [totalUsdt, setTotalUsdt] = useState<number>(0);
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<'tracking' | 'orderbook' | 'history'>('tracking');

  // Load config on mount
  const fetchConfig = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/config`);
      const data = await res.json();
      setConfig({
        hasCredentials: data.hasCredentials,
        apiKey: data.apiKey,
        saveToDisk: data.saveToDisk,
        pollInterval: data.pollInterval || 1000
      });
      return data.hasCredentials;
    } catch (e) {
      console.error('Failed to load backend config', e);
      return false;
    }
  };

  // Load balances from REST API
  const fetchBalances = async () => {
    setBalancesLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/balances`);
      if (res.ok) {
        const data = await res.json();
        setBalances(data.balances || []);
        setTotalUsdt(data.totalUsdt || 0);
      } else {
        setBalances([]);
        setTotalUsdt(0);
      }
    } catch (e) {
      console.error('Failed to fetch balances', e);
      setBalances([]);
      setTotalUsdt(0);
    } finally {
      setBalancesLoading(false);
    }
  };

  // Setup WS connection
  useEffect(() => {
    const socket = io(BACKEND_URL);

    socket.on('connect', () => {
      setWsConnected(true);
    });

    socket.on('disconnect', () => {
      setWsConnected(false);
    });

    socket.on('orders_update', (updatedOrders: Order[]) => {
      setOrders(updatedOrders);
    });

    socket.on('logs_init', (initialLogs: LogEntry[]) => {
      setLogs(initialLogs);
    });

    socket.on('log_entry', (newLog: LogEntry) => {
      setLogs((prevLogs) => {
        const next = [newLog, ...prevLogs];
        return next.slice(0, 500); // limit to 500 logs in React state
      });
    });

    // Check configuration and fetch initial balances
    fetchConfig().then((hasCreds) => {
      if (hasCreds) {
        fetchBalances();
      }
    });

    // Fetch available MEXC symbols
    fetch(`${BACKEND_URL}/api/symbols`)
      .then(res => res.json())
      .then(data => setAvailableSymbols(data))
      .catch(e => console.error('Failed to fetch MEXC symbol pairs', e));

    return () => {
      socket.disconnect();
    };
  }, []);

  // Update credentials
  const handleSaveCredentials = async (apiKey: string, secretKey: string, saveToDisk: boolean) => {
    const res = await fetch(`${BACKEND_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, secretKey, saveToDisk })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to authenticate API credentials.');
    }

    await fetchConfig();
    fetchBalances();
  };

  // Clear credentials
  const handleClearCredentials = async () => {
    const res = await fetch(`${BACKEND_URL}/api/config`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      throw new Error('Failed to remove API credentials.');
    }
    
    await fetchConfig();
    setBalances([]);
    setTotalUsdt(0);
  };

  // Submit new order
  const handleCreateOrder = async (orderData: {
    symbol: string;
    trailValue: string;
    quantity: string;
    quoteOrderQty: string;
    orderType: string;
    dryRun: boolean;
    activationPrice?: string;
    takeProfit?: string;
    stopLoss?: string;
    filterSmartSl?: boolean;
    slBuffer?: string;
    filterObi: boolean;
    filterVolume: boolean;
    filterRsi: boolean;
    autoRepeat: boolean;
    activationOffset: string;
    startImmediately?: boolean;
  }) => {
    const res = await fetch(`${BACKEND_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create order.');
    }
    
    // Trigger balance refresh in background since they might have placed a real order or to refresh USDT
    if (config.hasCredentials && !orderData.dryRun) {
      setTimeout(fetchBalances, 1500);
    }
  };

  // Cancel order
  const handleCancelOrder = async (orderId: string) => {
    const res = await fetch(`${BACKEND_URL}/api/orders/${orderId}`, {
      method: 'DELETE'
    });
    
    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Failed to cancel order.');
    }
  };

  // Clear orders history
  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to clear historical logs of triggered/cancelled orders?')) {
      const res = await fetch(`${BACKEND_URL}/api/orders`, {
        method: 'DELETE'
      });
      
      if (!res.ok) {
        alert('Failed to clear order history.');
      }
    }
  };

  // Update polling interval
  const handleUpdateInterval = async (interval: number) => {
    const res = await fetch(`${BACKEND_URL}/api/settings/interval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval })
    });
    
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update interval.');
    }

    await fetchConfig();
  };

  const activeOrdersCount = orders.filter(
    (o) => o.status === 'RUNNING' || o.status === 'PENDING_EXECUTION'
  ).length;

  return (
    <div className="app-container">
      {/* Header */}
      <header>
        <div className="brand-section">
          <div className="brand-logo">M</div>
          <div className="brand-title">
            <h1>MEXC Trailing Stop Buy Bot</h1>
            <p>Spot Trading Bot with Absolute Price Offset Triggers</p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <div className="connection-status">
            {wsConnected ? (
              <>
                <Wifi size={14} className="text-green" style={{ color: 'var(--color-green)' }} />
                <span>Backend Connected</span>
                <span className="status-dot connected" />
              </>
            ) : (
              <>
                <WifiOff size={14} className="text-red" style={{ color: 'var(--color-red)' }} />
                <span>Offline</span>
                <span className="status-dot disconnected" />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: API & Balances */}
        <div className="sidebar">
          <CredentialForm 
            config={config} 
            onSave={handleSaveCredentials} 
            onClear={handleClearCredentials} 
          />
          <Balances 
            balances={balances} 
            totalUsdt={totalUsdt}
            loading={balancesLoading} 
            onRefresh={fetchBalances} 
            hasCredentials={config.hasCredentials}
          />
        </div>

        {/* Right Column: Trading & Logs */}
        <div className="main-content">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem' }}>
            {/* Top Independent Scalp Radar */}
            <ScalpRadar availableSymbols={availableSymbols} />

            {/* Set Trailing Buy order form */}
            <OrderForm 
              onSubmit={handleCreateOrder} 
              hasCredentials={config.hasCredentials} 
              availableSymbols={availableSymbols}
            />

            {/* Trading Console tabs */}
            <div className="card">
              <div className="tabs-header">
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'tracking' ? 'active' : ''}`}
                  onClick={() => setActiveTab('tracking')}
                >
                  Active Tracking ({activeOrdersCount})
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'orderbook' ? 'active' : ''}`}
                  onClick={() => setActiveTab('orderbook')}
                >
                  Order Book Range Scanner
                </button>
                <button
                  type="button"
                  className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  Order Audit History
                </button>
              </div>

              {activeTab === 'tracking' ? (
                <ActiveOrders orders={orders} onCancel={handleCancelOrder} />
              ) : activeTab === 'orderbook' ? (
                <OrderBookAnalysis availableSymbols={availableSymbols} />
              ) : (
                <OrderHistory orders={orders} onClear={handleClearHistory} />
              )}
            </div>

            {/* Operations Console */}
            <LogsConsole 
              logs={logs} 
              pollInterval={config.pollInterval} 
              onUpdateInterval={handleUpdateInterval} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}
