#!/bin/bash
set -e

echo "================================================================================"
echo "🚀 1-CLICK COMPLETE SETUP FOR FRESH DEDICATED LINUX VPS"
echo "================================================================================"

# 1. Clean any stuck background apt processes & Install prerequisites
echo "📦 [1/4] Installing Git, Curl, Nginx, UFW, and essentials..."
export DEBIAN_FRONTEND=noninteractive
sudo pkill -9 -f apt || true
sudo pkill -9 -f dpkg || true
sudo fuser -k -9 /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock 2>/dev/null || true
sudo rm -rf /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/cache/apt/archives/lock
sudo dpkg --configure -a 2>/dev/null || true
sleep 1
sudo apt-get update -y
sudo apt-get install -y git curl ufw nginx

# 2. Install Node.js 20 LTS & PM2
echo "⚡ [2/4] Installing Node.js 20 LTS & PM2..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 3. Clone or update repository (Foolproof Direct Download)
echo "📂 [3/4] Downloading and setting up mexc-trailing-buy-bot..."
cd "$HOME"
mkdir -p mexc-trailing-buy-bot
curl -sSL "https://github.com/sohaibahmed368/mexc-trailing-buy-bot/archive/refs/heads/main.tar.gz" | tar -xz --strip-components=1 -C mexc-trailing-buy-bot
cd mexc-trailing-buy-bot

# Install backend dependencies
cd backend && npm install --omit=dev
cd ..

# 5. Configure Nginx Reverse Proxy for Port 80 -> 8100 with WebSocket Support
echo "⚙️ [5/5] Configuring Nginx web server on port 80..."
sudo tee /etc/nginx/sites-available/default > /dev/null << 'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

sudo nginx -t
sudo systemctl restart nginx
sudo systemctl enable nginx

# Configure Firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
echo "y" | sudo ufw enable || true

# Start PM2 Daemon
echo "🚀 Starting Trading Bot Daemon via PM2..."
pm2 delete mexc-bot 2>/dev/null || true
pm2 start backend/server.js --name "mexc-bot"
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

# Get Server Public IP
SERVER_IP=$(curl -s ifconfig.me || curl -s icanhazip.com || echo "YOUR-SERVER-IP")

echo "================================================================================"
echo "🎉 CONGRATULATIONS! YOUR MEXC TRADING BOT IS 100% LIVE 24/7/365!"
echo "================================================================================"
echo ""
echo "👉 Open your dashboard in any browser / mobile: http://$SERVER_IP"
echo ""
echo "📊 To check live bot logs anytime, run: pm2 logs mexc-bot"
echo "🔄 To restart bot anytime, run: pm2 restart mexc-bot"
echo "================================================================================"
