import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, ShieldCheck, ShieldAlert, Trash2, CheckCircle2 } from 'lucide-react';

interface CredentialFormProps {
  config: {
    hasCredentials: boolean;
    apiKey: string;
    saveToDisk: boolean;
  };
  onSave: (apiKey: string, secretKey: string, saveToDisk: boolean) => Promise<void>;
  onClear: () => Promise<void>;
}

export default function CredentialForm({ config, onSave, onClear }: CredentialFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (config.hasCredentials && config.apiKey) {
      setApiKey(config.apiKey);
      setSaveToDisk(config.saveToDisk);
    } else {
      setApiKey('');
      setSecretKey('');
    }
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config.hasCredentials && (!apiKey || !secretKey)) {
      setError('Both API Key and Secret Key are required.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      await onSave(apiKey, secretKey, saveToDisk);
      setSuccess(true);
      setSecretKey(''); // clear secret input after success
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Verification failed. Double check your keys.');
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (window.confirm('Are you sure you want to remove your API keys? This will halt any active real trades (dry runs are unaffected).')) {
      setLoading(true);
      try {
        await onClear();
        setApiKey('');
        setSecretKey('');
      } catch (err: any) {
        setError(err.message || 'Failed to clear keys.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span>MEXC API Credentials</span>
        {config.hasCredentials ? (
          <ShieldCheck className="text-green" size={20} style={{ color: 'var(--color-green)' }} />
        ) : (
          <ShieldAlert className="text-red" size={20} style={{ color: 'var(--color-red)' }} />
        )}
      </div>
      
      {config.hasCredentials ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ background: 'var(--bg-input)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.9rem' }}>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Active API Key:</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{config.apiKey || apiKey}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
              Storage Mode: {config.saveToDisk ? 'Persistent (Local Disk)' : 'Session (In-Memory Only)'}
            </p>
          </div>
          
          <button 
            type="button" 
            className="btn btn-secondary btn-danger" 
            onClick={handleClear} 
            disabled={loading}
            style={{ width: '100%', gap: '0.5rem', backgroundColor: 'transparent', border: '1px solid var(--color-red)', color: 'var(--color-red)' }}
          >
            <Trash2 size={16} /> Disconnect API Keys
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="apiKey">Access/API Key</label>
            <div className="input-wrapper has-icon">
              <Key className="input-icon" size={16} />
              <input
                id="apiKey"
                type="text"
                placeholder="Enter MEXC API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="secretKey">Secret Key</label>
            <div className="input-wrapper has-icon">
              <Key className="input-icon" size={16} />
              <input
                id="secretKey"
                type={showSecret ? 'text' : 'password'}
                placeholder="Enter MEXC Secret Key"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                disabled={loading}
                required
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="checkbox-group" onClick={() => setSaveToDisk(!saveToDisk)}>
            <input
              type="checkbox"
              id="saveToDisk"
              checked={saveToDisk}
              onChange={() => {}} // handled by click on outer container
              disabled={loading}
            />
            <label htmlFor="saveToDisk">Save credentials locally to credentials.json</label>
          </div>

          {error && (
            <div style={{ color: 'var(--color-red)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <ShieldAlert size={14} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div style={{ color: 'var(--color-green)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <CheckCircle2 size={14} />
              <span>Connected & Authenticated!</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Authenticating...' : 'Connect to MEXC'}
          </button>
        </form>
      )}
    </div>
  );
}
