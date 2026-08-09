import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, Check } from 'lucide-react';

interface SearchableSymbolSelectProps {
  value: string;
  onChange: (symbol: string) => void;
  availableSymbols: string[];
  disabled?: boolean;
}

const POPULAR_PILLS = [
  'HYPEUSDT',
  'ONDOUSDT',
  'ETHUSDT',
  'BTCUSDT',
  'SOLUSDT',
  'PEPEUSDT',
  'LINKUSDT',
  'SUIUSDT',
  'UNIUSDT',
  'XAUTUSDT',
  'EURUSDT',
  'NVDAXUSDT'
];

export default function SearchableSymbolSelect({ value, onChange, availableSymbols, disabled }: SearchableSymbolSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Combine predefined popular coins with all available MEXC pairs
  const allSymbols = Array.from(
    new Set([
      ...POPULAR_PILLS,
      ...(availableSymbols || []).map(s => s.toUpperCase().trim())
    ])
  );

  // Filter symbols based on search query
  const filteredSymbols = allSymbols.filter(sym =>
    sym.toLowerCase().includes(searchQuery.toLowerCase().trim())
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (sym: string) => {
    onChange(sym);
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* Quick Access Pills for Super Fast Selection */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.6rem' }}>
        {POPULAR_PILLS.slice(0, 8).map(pill => (
          <button
            key={pill}
            type="button"
            onClick={() => handleSelect(pill)}
            style={{
              fontSize: '0.72rem',
              padding: '0.2rem 0.5rem',
              borderRadius: '6px',
              border: value === pill ? '1px solid var(--color-cyan)' : '1px solid #334155',
              background: value === pill ? 'rgba(0, 242, 254, 0.15)' : '#0f172a',
              color: value === pill ? 'var(--color-cyan)' : '#94a3b8',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            {pill.replace('USDT', '')}
          </button>
        ))}
      </div>

      {/* Main Select Button */}
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.65rem 0.85rem',
          background: '#020617',
          color: '#f8fafc',
          border: isOpen ? '1px solid var(--color-cyan)' : '1px solid #334155',
          borderRadius: '8px',
          fontWeight: 700,
          fontSize: '0.95rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          boxShadow: isOpen ? '0 0 10px rgba(0, 242, 254, 0.2)' : 'none'
        }}
      >
        <span>{value || 'Select Coin / Pair'}</span>
        <ChevronDown size={18} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease', color: '#94a3b8' }} />
      </button>

      {/* Searchable Dropdown Popup Menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 999,
            background: '#090d16',
            border: '1px solid #334155',
            borderRadius: '8px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.8)',
            padding: '0.5rem',
            maxHeight: '300px',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem'
          }}
        >
          {/* Search Input Field */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', color: '#64748b' }} />
            <input
              type="text"
              placeholder="Type to search (e.g. PEPE, HYPE, BTC, SOL, ONDO)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '0.5rem 0.5rem 0.5rem 2.2rem',
                background: '#020617',
                border: '1px solid var(--border-focus)',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '0.85rem',
                fontWeight: 600,
                outline: 'none'
              }}
            />
          </div>

          {/* Filtered Symbols Scrollable List */}
          <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filteredSymbols.length > 0 ? (
              filteredSymbols.map(sym => (
                <div
                  key={sym}
                  onClick={() => handleSelect(sym)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    background: value === sym ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                    color: value === sym ? 'var(--color-cyan)' : '#cbd5e1',
                    fontWeight: value === sym ? 700 : 500,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (value !== sym) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }}
                  onMouseLeave={(e) => {
                    if (value !== sym) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span>{sym}</span>
                  {value === sym && <Check size={16} style={{ color: 'var(--color-cyan)' }} />}
                </div>
              ))
            ) : (
              // Custom Symbol Option if not found in list
              <div
                onClick={() => handleSelect(searchQuery.toUpperCase().trim() + (searchQuery.toUpperCase().includes('USDT') ? '' : 'USDT'))}
                style={{
                  padding: '0.6rem 0.75rem',
                  color: 'var(--color-cyan)',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '6px',
                  background: 'rgba(0, 242, 254, 0.1)'
                }}
              >
                ➕ Add Custom Pair: "{searchQuery.toUpperCase()}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
