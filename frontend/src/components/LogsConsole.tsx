import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Ban, Sliders } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: string; // 'info', 'success', 'warning', 'error'
  symbol: string | null;
}

interface LogsConsoleProps {
  logs: LogEntry[];
  pollInterval: number;
  onUpdateInterval: (interval: number) => Promise<void>;
}

export default function LogsConsole({ logs, pollInterval, onUpdateInterval }: LogsConsoleProps) {
  const consoleRef = useRef<HTMLDivElement>(null);
  const [intervalInput, setIntervalInput] = useState(pollInterval.toString());
  const [editingInterval, setEditingInterval] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronize input value with prop when not editing
  useEffect(() => {
    if (!editingInterval) {
      setIntervalInput(pollInterval.toString());
    }
  }, [pollInterval, editingInterval]);

  // Auto scroll to bottom when new logs arrive
  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Render logs oldest-to-newest so they read naturally like a terminal
  const chronologicalLogs = [...logs].reverse();

  const handleSaveInterval = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseInt(intervalInput);
    if (isNaN(parsed) || parsed < 200) {
      setError('Interval must be at least 200ms.');
      return;
    }
    
    try {
      await onUpdateInterval(parsed);
      setEditingInterval(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update interval.');
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Terminal size={18} /> System Operations Logs
        </span>
        
        {/* Polling Interval Config */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
          {editingInterval ? (
            <form onSubmit={handleSaveInterval} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <input
                type="number"
                value={intervalInput}
                onChange={(e) => setIntervalInput(e.target.value)}
                style={{
                  width: '70px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-focus)',
                  borderRadius: '4px',
                  padding: '0.1rem 0.3rem',
                  color: 'white',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  outline: 'none'
                }}
              />
              <span style={{ color: 'var(--text-muted)' }}>ms</span>
              <button type="submit" className="btn btn-primary btn-sm" style={{ padding: '0.1rem 0.3rem', width: 'auto', fontSize: '0.7rem' }}>
                Save
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingInterval(false)} style={{ padding: '0.1rem 0.3rem', width: 'auto', fontSize: '0.7rem' }}>
                Cancel
              </button>
            </form>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)' }}>
              <span>Polling: <strong>{pollInterval}ms</strong></span>
              <button 
                type="button" 
                onClick={() => setEditingInterval(true)}
                style={{ background: 'none', border: 'none', color: 'var(--color-cyan)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                title="Edit Price Polling Interval"
              >
                <Sliders size={12} />
              </button>
            </div>
          )}
        </div>
      </div>
      
      {error && (
        <div style={{ color: 'var(--color-red)', fontSize: '0.75rem', marginBottom: '0.5rem' }}>
          {error}
        </div>
      )}

      {logs.length === 0 ? (
        <div className="console-logs" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)' }}>
          <Ban size={24} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
          No logs recorded yet. Start a trailing stop order to begin operations.
        </div>
      ) : (
        <div className="console-logs" ref={consoleRef}>
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
  );
}
