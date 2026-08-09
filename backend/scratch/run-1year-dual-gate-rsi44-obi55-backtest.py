import urllib.request
import json
import time
import math
from datetime import datetime, timedelta

def fetch_klines(symbol, interval='15m', limit=1000, end_time=None):
    base_url = "https://api.binance.com/api/v3/klines"
    url = f"{base_url}?symbol={symbol}&interval={interval}&limit={limit}"
    if end_time:
        url += f"&endTime={end_time}"
    
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return data
    except Exception as e:
        print(f"Error fetching {symbol} klines: {e}")
        return []

def get_1year_klines(symbol):
    print(f"📥 Fetching 1 Year (365 Days) 15m candles for {symbol}...")
    all_candles = []
    end_time = int(time.time() * 1000)
    target_count = 365 * 24 * 4 # ~35,040 15m candles
    
    while len(all_candles) < target_count:
        candles = fetch_klines(symbol, '15m', 1000, end_time)
        if not candles:
            break
        all_candles = candles + all_candles
        end_time = candles[0][0] - 1
        time.sleep(0.08) # Rate limit safety
        if len(candles) < 1000:
            break
            
    print(f"   Fetched {len(all_candles)} candles for {symbol} (Span: {datetime.fromtimestamp(all_candles[0][0]/1000).strftime('%Y-%m-%d')} to {datetime.fromtimestamp(all_candles[-1][0]/1000).strftime('%Y-%m-%d')})")
    return all_candles

def compute_rsi(prices, period=14):
    if len(prices) < period + 1:
        return [50.0] * len(prices)
    
    gains = []
    losses = []
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
        
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    
    rsis = [50.0] * (period)
    if avg_loss == 0:
        rsis.append(100.0)
    else:
        rs = avg_gain / avg_loss
        rsis.append(100.0 - (100.0 / (1.0 + rs)))
        
    for i in range(period + 1, len(prices)):
        change = prices[i - 1] - prices[i - 2]
        gain = max(change, 0)
        loss = max(-change, 0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            rsis.append(100.0)
        else:
            rs = avg_gain / avg_loss
            rsis.append(100.0 - (100.0 / (1.0 + rs)))
            
    return rsis

def simulate_1year_dual_gate(symbol, klines, tp_pct=0.60, rsi_max=44.0, obi_min=55.0):
    # Parse candles: timestamp, open, high, low, close, volume, quote_vol, taker_buy_vol, taker_buy_quote_vol
    parsed = []
    for c in klines:
        parsed.append({
            'timestamp': int(c[0]),
            'open': float(c[1]),
            'high': float(c[2]),
            'low': float(c[3]),
            'close': float(c[4]),
            'volume': float(c[5]),
            'quote_volume': float(c[7]),
            'taker_buy_quote_volume': float(c[10])
        })
        
    close_prices = [p['close'] for p in parsed]
    
    # 4h aggregated RSI calculated on 16-period 15m window (4h)
    rsi_values = compute_rsi(close_prices, 16)
    
    trades = []
    in_trade = False
    current_trade = None
    
    for i in range(100, len(parsed)):
        bar = parsed[i]
        rsi = rsi_values[i]
        
        # Calculate Orderbook Imbalance Proxy (Taker Buy Ratio & Volume Microstructure)
        taker_buy_q = bar['taker_buy_quote_volume']
        total_q = bar['quote_volume']
        taker_ratio = (taker_buy_q / total_q) * 100.0 if total_q > 0 else 50.0
        
        # Derived OBI proxy combining taker flow ratio and 5-bar momentum
        recent_bars = parsed[i-4:i+1]
        up_moves = sum(1 for b in recent_bars if b['close'] >= b['open'])
        obi_proxy = (taker_ratio * 0.7) + (up_moves * 6.0) + (55.0 - rsi) * 0.3
        obi_proxy = min(max(obi_proxy, 35.0), 85.0)
        
        # 🎯 Check Dual Gate Entry Condition (RSI <= 44.0 AND OBI >= 55.0%)
        if not in_trade:
            if rsi <= rsi_max and obi_proxy >= obi_min:
                in_trade = True
                buy_price = bar['close']
                tp_target = buy_price * (1.0 + (tp_pct / 100.0))
                current_trade = {
                    'symbol': symbol,
                    'entry_index': i,
                    'entry_time': bar['timestamp'],
                    'entry_price': buy_price,
                    'tp_target': tp_target,
                    'rsi': rsi,
                    'obi': obi_proxy,
                    'status': 'OPEN',
                    'exit_time': None,
                    'exit_price': None,
                    'duration_hours': 0,
                    'duration_bars': 0
                }
        else:
            # Check if Take Profit target hit on high price
            if bar['high'] >= current_trade['tp_target']:
                current_trade['status'] = 'TP_HIT'
                current_trade['exit_time'] = bar['timestamp']
                current_trade['exit_price'] = current_trade['tp_target']
                duration_ms = current_trade['exit_time'] - current_trade['entry_time']
                current_trade['duration_hours'] = duration_ms / (1000 * 3600)
                current_trade['duration_bars'] = i - current_trade['entry_index']
                trades.append(current_trade)
                in_trade = False
                current_trade = None
                
    if in_trade and current_trade:
        duration_ms = parsed[-1]['timestamp'] - current_trade['entry_time']
        current_trade['duration_hours'] = duration_ms / (1000 * 3600)
        current_trade['duration_bars'] = len(parsed) - 1 - current_trade['entry_index']
        trades.append(current_trade)
        
    return trades

def run_all_1year_backtests():
    symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'PAXGUSDT']
    results = {}
    
    for sym in symbols:
        klines = get_1year_klines(sym)
        trades = simulate_1year_dual_gate(sym, klines, tp_pct=0.60, rsi_max=44.0, obi_min=55.0)
        results[sym] = trades
        
    print("\n" + "="*90)
    print("🏆 1-YEAR DUAL GATE BACKTEST RESULTS (RSI <= 44.0 & OBI >= 55.0% | TP +0.60%)")
    print("="*90)
    
    summary_report = []
    
    for sym, trades in results.items():
        displayName = "XAUT (Gold)" if sym == 'PAXGUSDT' else sym.replace('USDT', '')
        total_trades = len(trades)
        tp_hits = [t for t in trades if t['status'] == 'TP_HIT']
        pending_trades = [t for t in trades if t['status'] == 'OPEN']
        
        tp_count = len(tp_hits)
        pending_count = len(pending_trades)
        win_rate = (tp_count / total_trades * 100.0) if total_trades > 0 else 0.0
        
        durations = [t['duration_hours'] for t in tp_hits]
        avg_dur_h = (sum(durations) / len(durations)) if durations else 0
        min_dur_h = min(durations) if durations else 0
        max_dur_h = max(durations) if durations else 0
        
        total_net_profit = tp_count * (100.0 * 0.006) # $0.60 USDT profit per $100 trade
        
        summary_report.append({
            'symbol': displayName,
            'total_entries': total_trades,
            'tp_hits': tp_count,
            'pending': pending_count,
            'win_rate': win_rate,
            'avg_duration_h': avg_dur_h,
            'min_duration_h': min_dur_h,
            'max_duration_h': max_dur_h,
            'net_profit_usdt': total_net_profit,
            'trades': trades
        })
        
        print(f"\n📌 ASSET: {displayName}")
        print(f"   Total Confirmed Entries: {total_trades}")
        print(f"   Take Profit (+0.6%) Hits: {tp_count} 🟢")
        print(f"   Currently Pending Trades: {pending_count} ⏳")
        print(f"   Win Rate: {win_rate:.1f}%")
        print(f"   Avg Time to Hit TP: {avg_dur_h:.2f} Hours ({avg_dur_h * 60:.0f} Minutes)")
        print(f"   Fastest TP Hit: {min_dur_h * 60:.1f} Minutes | Slowest TP Hit: {max_dur_h:.1f} Hours")
        print(f"   Total Net Profit ($100/trade): +${total_net_profit:.2f} USDT")
        print("-" * 80)
        
        print("   Sample Individual Trades (Chronological):")
        sample_trades = trades[:5] + (trades[-3:] if len(trades) > 5 else [])
        for idx, t in enumerate(sample_trades, 1):
            entry_pkt = (datetime.fromtimestamp(t['entry_time']/1000) + timedelta(hours=5)).strftime('%Y-%m-%d %H:%M PKT')
            exit_pkt = (datetime.fromtimestamp(t['exit_time']/1000) + timedelta(hours=5)).strftime('%Y-%m-%d %H:%M PKT') if t['exit_time'] else 'Pending'
            status_str = f"TP HIT in {t['duration_hours']:.1f}h" if t['status'] == 'TP_HIT' else "STILL OPEN"
            print(f"      [#{idx}] Entry: {entry_pkt} | Buy: ${t['entry_price']:.2f} -> TP: ${t['tp_target']:.2f} | RSI: {t['rsi']:.1f} | OBI: {t['obi']:.1f}% | Result: {status_str}")

    # Save detailed JSON report
    with open('scratch/1year_backtest_rsi44_obi55_report.json', 'w') as f:
        json.dump(summary_report, f, indent=2)
    print("\n✅ Detailed 1-Year Backtest JSON report saved to scratch/1year_backtest_rsi44_obi55_report.json")

if __name__ == '__main__':
    run_all_1year_backtests()
