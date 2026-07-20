import { Wallet, RefreshCw } from 'lucide-react';

interface Balance {
  asset: string;
  free: number;
  locked: number;
  price?: number;
  estUsdtValue?: number;
}

interface BalancesProps {
  balances: Balance[];
  totalUsdt: number;
  loading: boolean;
  onRefresh: () => void;
  hasCredentials: boolean;
}

export default function Balances({ balances, totalUsdt, loading, onRefresh, hasCredentials }: BalancesProps) {
  return (
    <div className="card">
      <div className="card-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Wallet size={18} /> Spot Wallet
        </span>
        {hasCredentials && (
          <button 
            type="button" 
            className="btn btn-secondary btn-sm" 
            onClick={onRefresh} 
            disabled={loading}
            style={{ width: 'auto', padding: '0.25rem 0.5rem' }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        )}
      </div>

      {hasCredentials && !loading && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.05) 0%, rgba(155, 93, 229, 0.05) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Net Portfolio Value</span>
          <span style={{ 
            fontSize: '1.25rem', 
            fontWeight: 700, 
            background: 'linear-gradient(to right, var(--color-cyan), var(--color-purple))', 
            WebkitBackgroundClip: 'text', 
            WebkitTextFillColor: 'transparent',
            fontFamily: 'var(--font-sans)' 
          }}>
            ${totalUsdt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
          </span>
        </div>
      )}

      {!hasCredentials ? (
        <div className="empty-state" style={{ padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '0.85rem' }}>Connect your API Keys to load Spot Wallet balances.</p>
        </div>
      ) : loading && balances.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Loading balances...
        </div>
      ) : balances.length === 0 ? (
        <div className="empty-state" style={{ padding: '1.5rem 1rem' }}>
          <p style={{ fontSize: '0.85rem' }}>No asset balances found (only non-zero balances are shown).</p>
        </div>
      ) : (
        <div className="balance-list">
          {balances.map((bal) => (
            <div className="balance-item" key={bal.asset}>
              <div className="balance-symbol">{bal.asset}</div>
              <div className="balance-value-group">
                <div className="balance-amount">{bal.free.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}</div>
                
                {bal.estUsdtValue !== undefined && bal.asset !== 'USDT' && bal.asset !== 'USD' && bal.estUsdtValue > 0.0001 && (
                  <div className="balance-label" style={{ color: 'var(--text-secondary)' }}>
                    ≈ ${bal.estUsdtValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                  </div>
                )}

                {bal.locked > 0 && (
                  <div className="balance-label" style={{ color: 'var(--color-amber)' }}>
                    Locked: {bal.locked.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
