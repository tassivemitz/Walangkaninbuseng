#!/usr/bin/env bash
# ==============================================================================
# Infinite Trading VPS Auto-Setup & Deployment Script (Hostinger VPS)
# Target Domain: infinitetrading.site, www.infinitetrading.site
# Target IP: 187.127.122.111
# ==============================================================================

set -e

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a

DOMAIN="infinitetrading.site"
WWW_DOMAIN="www.infinitetrading.site"
APP_DIR="/var/www/infinitetrading"
APP_PORT=3000
EMAIL="admin@infinitetrading.site"

echo "=========================================================="
echo "  Starting Infinite Trading VPS Provisioning & Deployment"
echo "  Domain: $DOMAIN ($WWW_DOMAIN)"
echo "  Directory: $APP_DIR"
echo "=========================================================="

# 1. Update system packages
echo ">>> [1/7] Updating system packages..."
apt-get update -y
apt-get install -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" curl wget git unzip ufw nginx certbot python3-certbot-nginx

# 2. Install Node.js 20 LTS & PM2
echo ">>> [2/7] Installing Node.js 20 LTS & PM2..."
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1)" != "v20" ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

npm install -g pm2
pm2 startup systemd -u root --hp /root || true

# 3. Prepare Application Directory
echo ">>> [3/7] Setting up application directory..."
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# Ensure data directory exists
mkdir -p "$APP_DIR/data"

# Install production dependencies
if [ -f "package.json" ]; then
  echo "Installing npm dependencies..."
  npm install --omit=dev
fi

# 4. Configure .env if not present
if [ ! -f "$APP_DIR/.env" ]; then
  echo "Creating default .env configuration..."
  JWT_RANDOM=$(openssl rand -hex 32)
  cat > "$APP_DIR/.env" <<EOF
PORT=$APP_PORT
JWT_SECRET=$JWT_RANDOM
ADMIN_MOBILE=Toshi
ADMIN_PASSWORD=ChangeMeAdmin1
EOF
  echo "Default .env generated. Please edit /var/www/infinitetrading/.env if needed."
fi

# 5. Configure Nginx Reverse Proxy
echo ">>> [4/7] Configuring Nginx reverse proxy..."
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN"

cat > "$NGINX_CONF" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN $WWW_DOMAIN 187.127.122.111 _;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN"
rm -f /etc/nginx/sites-enabled/default

# Test Nginx syntax
nginx -t
systemctl restart nginx

# 6. Configure UFW Firewall
echo ">>> [5/7] Configuring UFW Firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# 7. Start/Reload PM2 Application Process
echo ">>> [6/7] Launching application with PM2..."
cd "$APP_DIR"
pm2 describe infinitetrading > /dev/null 2>&1 && pm2 restart infinitetrading || pm2 start server.js --name infinitetrading
pm2 save

# 8. Setup SSL with Certbot
echo ">>> [7/7] Attempting SSL Certificate issuance via Let's Encrypt..."
if certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  echo "✓ SSL Certificate successfully installed and HTTPS redirect enabled!"
else
  echo "⚠ Note: Certbot SSL failed or DNS not yet fully propagated."
  echo "Once your DNS A records in z.com have propagated, simply run:"
  echo "  certbot --nginx -d $DOMAIN -d $WWW_DOMAIN"
fi

echo "=========================================================="
echo "  Deployment Complete!"
echo "  Status: PM2 running 'infinitetrading'"
echo "  URL: http://$DOMAIN (or https://$DOMAIN if SSL succeeded)"
echo "=========================================================="
