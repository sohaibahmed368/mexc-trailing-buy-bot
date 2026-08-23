#!/bin/bash
set -e

echo "================================================================================"
echo "🚀 MEXC TRAILING BUY BOT — MASTER VPS AUTO-DEPLOY & VERIFICATION SCRIPT"
echo "================================================================================"

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📂 Working directory: $BOT_DIR"

# 1. Update repo cleanly
echo "⬇️ [1/6] Pulling latest code from GitHub main..."
git reset --hard origin/main
git pull origin main

# 2. Ensure data directory & seed orders exist
echo "📦 [2/6] Populating active trading cards..."
mkdir -p "$BOT_DIR/backend/data" "$BOT_DIR/backend/config"
cp -f "$BOT_DIR/backend/seed-orders.json" "$BOT_DIR/backend/data/orders.json"
echo "   ✅ orders.json physically populated ($(wc -c < "$BOT_DIR/backend/data/orders.json") bytes)"

# 3. Synchronize with ~/www if present
if [ -d "$HOME/www" ] && [ "$BOT_DIR" != "$HOME/www" ]; then
  echo "🔄 [3/6] Synchronizing with ~/www..."
  mkdir -p "$HOME/www/backend/data" "$HOME/www/backend/public"
  cp -rf "$BOT_DIR/backend/public/"* "$HOME/www/backend/public/" 2>/dev/null || true
  cp -f "$BOT_DIR/backend/seed-orders.json" "$HOME/www/backend/data/orders.json" 2>/dev/null || true
  [ -f "$BOT_DIR/backend/config/credentials.json" ] && cp -f "$BOT_DIR/backend/config/credentials.json" "$HOME/www/backend/config/" 2>/dev/null || true
  [ -f "$HOME/www/backend/config/credentials.json" ] && cp -f "$HOME/www/backend/config/credentials.json" "$BOT_DIR/backend/config/" 2>/dev/null || true
fi

# 4. Restart PM2 Process cleanly
echo "⚡ [4/6] Restarting Node Backend via PM2..."
npx pm2 delete all 2>/dev/null || true
sleep 1
npx pm2 start "$BOT_DIR/backend/server.js" --name "mexc-bot"
npx pm2 save
sleep 2

# 5. Live HTTP REST API Self-Test
echo "🧪 [5/6] Performing Live HTTP REST Self-Test on port 8100..."
API_RESPONSE=$(curl -s http://127.0.0.1:8100/api/orders || echo "[]")
ORDER_COUNT=$(node -e "try { const d = JSON.parse(process.argv[1]); console.log(Array.isArray(d) ? d.length : 0); } catch(e){ console.log(0); }" "$API_RESPONSE")

echo "   📡 /api/orders responded with $ORDER_COUNT active cards!"

if [ "$ORDER_COUNT" -gt 0 ]; then
  echo "   ✅ SUCCESS: Server is actively serving $ORDER_COUNT cards over HTTP!"
  node -e "try { const d = JSON.parse(process.argv[1]); d.forEach((o, i) => console.log('      Card ' + (i+1) + ': ' + o.symbol + ' | Status: ' + o.status + ' | TP: +' + o.takeProfit + '% | Price: $' + o.currentPrice)); } catch(e){}" "$API_RESPONSE"
else
  echo "   ⚠️ WARNING: /api/orders returned 0 orders. Checking server logs..."
fi

# 6. Stream PM2 live logs
echo "================================================================================"
echo "📋 [6/6] STREAMING LIVE PM2 BOT LOGS:"
echo "================================================================================"
npx pm2 logs mexc-bot --lines 20
