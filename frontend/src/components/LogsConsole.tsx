import React, { useEffect, useRef, useState } from 'react';
import { Terminal, Ban, Sliders, ArrowDown, PauseCircle, PlayCircle } from 'lucide-react';

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
  const [isAutoScrollPaused, setIsAutoScrollPaused] = useState(false);
  const [newLogCountWhilePaused, setNewLogCountWhilePaused] = useState(0);

  const prevLogsLengthRef = useRef(logs.length);

  // Synchronize input value with prop when not editing
  useEffect(() => {
    if (!editingInterval) {
      setIntervalInput(pollInterval.toString());
    }
  }, [pollInterval, editingInterval]);

  // Track new log count while paused
  useEffect(() => {
    if (isAutoScrollPaused) {
      const added = logs.length - prevLogsLengthRef.current;
      if (added > 0) {
        setNewLogCountWhilePaused(prev => prev + added);
      }
    } else {
      setNewLogCountWhilePaused(0);
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs, isAutoScrollPaused]);

  // Smart Auto scroll to bottom when new logs arrive (ONLY if auto scroll is not paused!)
  useEffect(() => {
    if (consoleRef.current && !isAutoScrollPaused) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, isAutoScrollPaused]);

  // Handle user scroll detection
  const handleScroll = () => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    // If user scrolled up by more than 40px, auto-pause scroll lock so user can read old logs
    if (distanceFromBottom > 40) {
      if (!isAutoScrollPaused) {
        setIsAutoScrollPaused(true);
      }
    } else {
      // If user scrolled back to bottom, resume auto scroll automatically
      if (isAutoScrollPaused) {
        setIsAutoScrollPaused(false);
        setNewLogCountWhilePaused(0);
      }
    }
  };

  const scrollToBottom = () => {
    setIsAutoScrollPaused(false);
    setNewLogCountWhilePaused(0);
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  };

  const toggleAutoScroll = () => {
    if (isAutoScrollPaused) {
      scrollToBottom();
    } else {
      setIsAutoScrollPaused(true);
    }
  };

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
    <div className="card" style={{ position: 'relative' }}>
      <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Terminal size={18} /> System Operations Logs
        </span>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Auto-Scroll Toggle Button */}
          <button
            type="button"
            onClick={toggleAutoScroll}
            style={{
              background: isAutoScrollPaused ? 'rgba(255, 171, 0, 0.15)' : 'rgba(0, 230, 118, 0.12)',
              border: isAutoScrollPaused ? '1px solid rgba(255, 171, 0, 0.4)' : '1px solid rgba(0, 230, 118, 0.3)',
              borderRadius: '6px',
              padding: '0.2rem 0.6rem',
              color: isAutoScrollPaused ? '#ffab00' : 'var(--color-green)',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              transition: 'all 0.2s ease'
            }}
            title={isAutoScrollPaused ? "Click to Resume Auto-Scroll" : "Click to Pause Auto-Scroll"}
          >
            {isAutoScrollPaused ? (
              <>
                <PauseCircle size={14} /> Auto-Scroll Paused
              </>
            ) : (
              <>
                <PlayCircle size={14} /> Auto-Scroll Live
              </>
            )}
          </button>

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
        <div style={{ position: 'relative' }}>
          <div 
            className="console-logs" 
            ref={consoleRef}
            onScroll={handleScroll}
          >
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

          {/* Floating Jump-to-Bottom / Resume Auto-Scroll Button */}
          {isAutoScrollPaused && (
            <button
              type="button"
              onClick={scrollToBottom}
              style={{
                position: 'absolute',
                bottom: '12px',
                right: '20px',
                background: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                color: '#0b0e14',
                border: 'none',
                borderRadius: '20px',
                padding: '0.4rem 0.9rem',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 12px rgba(0, 242, 254, 0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                zIndex: 10,
                transition: 'transform 0.15s ease'
              }}
            >
              <ArrowDown size={14} /> 
              {newLogCountWhilePaused > 0 ? `${newLogCountWhilePaused} New Logs Below (Resume)` : 'Jump to Bottom'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
