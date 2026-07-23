import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, Save } from 'lucide-react';

const BACKEND_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin;

interface AlpacaCredentialFormProps {
  onSaveSuccess?: () => void;
}

export const AlpacaCredentialForm: React.FC<AlpacaCredentialFormProps> = ({ onSaveSuccess }) => {
  const [apiKey, setApiKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [isPaper, setIsPaper] = useState(true);
  const [saveToDisk, setSaveToDisk] = useState(true);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/alpaca/config`)
      .then(res => res.json())
      .then(data => {
        setHasCredentials(data.hasCredentials);
        setIsPaper(data.isPaper !== false);
        setSaveToDisk(data.saveToDisk !== false);
        if (data.hasCredentials) {
          setApiKey(data.apiKey || '');
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey || !secretKey) {
      setStatusMsg({ text: 'Please enter both Alpaca API Key ID and Secret Key', type: 'error' });
      return;
    }

    setLoading(true);
    setStatusMsg(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/alpaca/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, secretKey, isPaper, saveToDisk })
      });
      const data = await res.json();
      if (res.ok) {
        setHasCredentials(true);
        setSecretKey('');
        setStatusMsg({ text: '✅ Alpaca API credentials configured successfully!', type: 'success' });
        if (onSaveSuccess) onSaveSuccess();
      } else {
        setStatusMsg({ text: data.error || 'Failed to save Alpaca credentials', type: 'error' });
      }
    } catch (err: any) {
      setStatusMsg({ text: err.message || 'Connection error', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              Alpaca Markets API Credentials
              {hasCredentials && (
                <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 font-normal">
                  <ShieldCheck className="w-3.5 h-3.5" /> Connected
                </span>
              )}
            </h3>
            <p className="text-xs text-slate-400">Configure your independent Alpaca API Keys for Stock Algorithmic Trading</p>
          </div>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-lg text-xs font-semibold mb-4 ${statusMsg.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
          {statusMsg.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Alpaca API Key ID</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="PK... or AK..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Alpaca Secret Key</label>
            <input
              type="password"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={hasCredentials ? '••••••••••••••••' : 'Enter Secret Key'}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              required={!hasCredentials}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isPaper}
                onChange={(e) => setIsPaper(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-300 font-medium">Use Free Paper Trading Sandbox</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={saveToDisk}
                onChange={(e) => setSaveToDisk(e.target.checked)}
                className="w-4 h-4 rounded bg-slate-950 border-slate-800 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-300 font-medium">Save to Disk</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-4 py-2 rounded-lg transition-all shadow-md"
          >
            <Save className="w-4 h-4" />
            {loading ? 'Saving...' : 'Save Alpaca Credentials'}
          </button>
        </div>
      </form>
    </div>
  );
};
