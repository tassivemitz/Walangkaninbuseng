#!/bin/bash

# Infinite Trading VPS Deployment Script
# Run this on your NEW Hetzner VPS

set -e  # Exit on error

echo "=========================================="
echo "Infinite Trading VPS Deployment"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}→ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    print_error "Please run as root (use sudo)"
    exit 1
fi

# Configuration
APP_DIR="/var/www/infinite-trading"
REPO_URL=""  # Will be set by user
DOMAIN=""    # Will be set by user

# Prompt for configuration
print_info "Enter your new GitHub repository URL:"
print_info "Example: https://github.com/yourusername/infinitetrading.git"
read -p "Repo URL: " REPO_URL

if [ -z "$REPO_URL" ]; then
    print_error "Repository URL is required"
    exit 1
fi

print_info "Enter your domain (e.g., yourdomain.com):"
read -p "Domain: " DOMAIN

if [ -z "$DOMAIN" ]; then
    print_error "Domain is required"
    exit 1
fi

print_info "Enter your JWT_SECRET (generate a random string):"
read -p "JWT_SECRET: " JWT_SECRET

if [ -z "$JWT_SECRET" ]; then
    print_error "JWT_SECRET is required"
    exit 1
fi

# Step 1: Update system
print_info "Updating system packages..."
apt update && apt upgrade -y
print_success "System updated"

# Step 2: Install Node.js
print_info "Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs
print_success "Node.js installed"

# Verify Node.js version
NODE_VERSION=$(node --version)
print_success "Node.js version: $NODE_VERSION"

# Step 3: Install other dependencies
print_info "Installing git, nginx, and certbot..."
apt install -y git nginx certbot python3-certbot-nginx
print_success "Dependencies installed"

# Step 4: Create app directory
print_info "Creating application directory..."
mkdir -p $APP_DIR
print_success "Directory created: $APP_DIR"

# Step 5: Clone repository
print_info "Cloning repository from GitHub..."
if [ -d "$APP_DIR/.git" ]; then
    print_info "Repository already exists, pulling latest changes..."
    cd $APP_DIR
    git pull origin main
else
    git clone $REPO_URL $APP_DIR
fi
print_success "Repository cloned"

# Step 6: Install dependencies
print_info "Installing Node.js dependencies..."
cd $APP_DIR
npm install --production
print_success "Dependencies installed"

# Step 7: Create .env file
print_info "Creating .env file..."
cat > $APP_DIR/.env <<EOF
PORT=3000
JWT_SECRET=$JWT_SECRET
EOF
print_success ".env file created"

# Step 8: Create data directory
print_info "Creating data directory..."
mkdir -p $APP_DIR/data
print_success "Data directory created"

# Step 9: Prompt for database upload
print_info "=========================================="
print_info "DATABASE UPLOAD REQUIRED"
print_info "=========================================="
print_info "You need to upload your store.json file to:"
print_info "$APP_DIR/data/store.json"
print_info ""
print_info "On your local machine, run:"
print_info "scp \"F:\\Infinite Trading\\data\\store.json\" root@$(hostname -I | awk '{print $1}'):$APP_DIR/data/"
print_info ""
read -p "Press Enter after uploading the database file..."

# Verify database file exists
if [ ! -f "$APP_DIR/data/store.json" ]; then
    print_error "Database file not found at $APP_DIR/data/store.json"
    print_info "Please upload the file and run this script again"
    exit 1
fi
print_success "Database file verified"

# Step 10: Test the application
print_info "Testing application..."
cd $APP_DIR
npm start &
APP_PID=$!

# Wait for app to start
sleep 5

# Check if app is running
if ps -p $APP_PID > /dev/null; then
    print_success "Application started successfully"
    kill $APP_PID
else
    print_error "Application failed to start"
    exit 1
fi

# Step 11: Install PM2
print_info "Installing PM2..."
npm install -g pm2
print_success "PM2 installed"

# Step 12: Start application with PM2
print_info "Starting application with PM2..."
cd $APP_DIR
pm2 start server.js --name infinite-trading
pm2 save
pm2 startup
print_success "Application started with PM2"

# Step 13: Configure Nginx
print_info "Configuring Nginx..."
cat > /etc/nginx/sites-available/infinite-trading <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/infinite-trading /etc/nginx/sites-enabled/

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test Nginx config
nginx -t
print_success "Nginx configured"

# Restart Nginx
systemctl restart nginx
print_success "Nginx restarted"

# Step 14: Set up SSL
print_info "Setting up SSL certificate..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN
print_success "SSL certificate installed"

# Step 15: Configure firewall
print_info "Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
print_success "Firewall configured"

# Step 16: Set file permissions
print_info "Setting file permissions..."
chown -R root:root $APP_DIR
chmod -R 755 $APP_DIR
chmod 644 $APP_DIR/.env
chmod 644 $APP_DIR/data/store.json
print_success "Permissions set"

# Final summary
echo ""
echo "=========================================="
print_success "DEPLOYMENT COMPLETED SUCCESSFULLY"
echo "=========================================="
echo ""
print_info "Application URL: https://$DOMAIN"
print_info "App directory: $APP_DIR"
print_info "PM2 status: pm2 status"
print_info "PM2 logs: pm2 logs infinite-trading"
echo ""
print_info "Next steps:"
echo "1. Update your z.com DNS A record to point to: $(hostname -I | awk '{print $1}')"
echo "2. Wait for DNS propagation (24-48 hours)"
echo "3. Test your site at https://$DOMAIN"
echo "4. Cancel your old VPS after verification"
echo ""
print_success "Done!"
