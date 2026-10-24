# Migration Guide: GitHub + VPS

## Overview
This guide helps you migrate your Infinite Trading project from old accounts to new ones.

---

## Part 1: GitHub Migration

### Step 1: Create New Repository
1. Go to https://github.com/new (login with your NEW GitHub account)
2. Repository name: `infinitetrading` (or your preferred name)
3. Make it **Private** (recommended for trading platform)
4. Don't initialize with README, .gitignore, or license (we'll push existing code)
5. Click "Create repository"

### Step 2: Update Remote URL
Open your terminal in the project folder and run:

```bash
# Remove old remote
git remote remove origin

# Add new remote (replace YOUR_NEW_USERNAME)
git remote add origin https://github.com/YOUR_NEW_USERNAME/infinitetrading.git

# Verify
git remote -v
```

### Step 3: Push to New Repo
```bash
# Push all branches
git push -u origin --all

# Push all tags
git push -u origin --tags
```

### Step 4: Verify
- Go to your new GitHub repo
- Confirm all files are there
- Check commit history is preserved

### Optional: Delete Old Repo
Once verified:
1. Go to old repo: https://github.com/cgstunna/infinitetrading/settings
2. Scroll to "Danger Zone"
3. Click "Delete this repository"
4. Type repo name to confirm

---

## Part 2: VPS Migration (Hetzner)

### Step 1: Create New Hetzner VPS
1. Login to new Hetzner account
2. Create new Cloud Server:
   - Location: Choose near your users (e.g., Singapore or US)
   - Image: Ubuntu 22.04 LTS or 24.04 LTS
   - Type: CX22 (recommended minimum) or higher
   - SSH Key: Add your SSH key (recommended) or use password
3. Note the **IP address** and **SSH credentials**

### Step 2: SSH into New VPS
```bash
ssh root@YOUR_NEW_VPS_IP
```

### Step 3: Initial Server Setup
Run these commands one by one:

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs git nginx

# Verify installation
node --version
npm --version
```

### Step 4: Deploy Application
```bash
# Create app directory
mkdir -p /var/www/infinite-trading
cd /var/www/infinite-trading

# Clone from NEW GitHub repo
git clone https://github.com/YOUR_NEW_USERNAME/infinitetrading.git .

# Install dependencies
npm install --production

# Create .env file
nano .env
```

Add these to `.env` (replace with your values):
```env
PORT=3000
JWT_SECRET=your-secret-key-here-change-this
```

Save and exit (Ctrl+X, Y, Enter)

### Step 5: Upload Database
**Option A: Upload from local computer**
```bash
# On your local machine (Windows PowerShell or Git Bash)
scp "F:\Infinite Trading\data\store.json" root@YOUR_NEW_VPS_IP:/var/www/infinite-trading/data/
```

**Option B: Copy-paste directly on VPS**
- Open `data/store.json` on your local machine
- Copy contents
- On VPS: `nano /var/www/infinite-trading/data/store.json`
- Paste contents, save (Ctrl+X, Y, Enter)

### Step 6: Test the App
```bash
# On VPS
cd /var/www/infinite-trading
npm start
```

Test in browser: `http://YOUR_NEW_VPS_IP:3000`

Press Ctrl+C to stop after testing.

### Step 7: Set Up PM2 (Keep App Running)
```bash
# Install PM2 globally
npm install -g pm2

# Start app with PM2
pm2 start server.js --name infinite-trading

# Set up PM2 to start on boot
pm2 startup
pm2 save
```

### Step 8: Configure Nginx (Reverse Proxy)
```bash
# Create Nginx config
nano /etc/nginx/sites-available/infinite-trading
```

Add this config:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your z.com domain

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Save and exit.

```bash
# Enable site
ln -s /etc/nginx/sites-available/infinite-trading /etc/nginx/sites-enabled/

# Test Nginx config
nginx -t

# Restart Nginx
systemctl restart nginx
```

### Step 9: Set Up SSL (HTTPS)
```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate
certbot --nginx -d your-domain.com

# Follow prompts (enter email, agree to TOS)
```

---

## Part 3: Domain Migration (z.com)

### Step 1: Update DNS Records
1. Login to z.com control panel
2. Go to DNS settings for your domain
3. Update A record:
   - **Name**: @ (or leave blank)
   - **Type**: A
   - **Value**: YOUR_NEW_VPS_IP
   - **TTL**: 3600 (or lowest available)

### Step 2: Wait for DNS Propagation
- Usually takes 24-48 hours
- Check with: `nslookup your-domain.com`
- Or use: https://dnschecker.org/

### Step 3: Verify
- Visit `https://your-domain.com`
- Should show your new VPS
- Check SSL certificate is valid

---

## Part 4: Post-Migration Checklist

- [ ] GitHub repo migrated to new account
- [ ] Old GitHub repo deleted (optional)
- [ ] New VPS created and accessible via SSH
- [ ] Application deployed and running on new VPS
- [ ] Database uploaded to new VPS
- [ ] PM2 configured (app auto-restarts)
- [ ] Nginx configured as reverse proxy
- [ ] SSL certificate installed (HTTPS working)
- [ ] Domain DNS updated to new VPS IP
- [ ] Site accessible via domain
- [ ] All features tested (login, trading, admin, etc.)
- [ ] Old VPS access verified (if possible, to cancel)

---

## Quick Commands Reference

### On VPS
```bash
# Check app status
pm2 status

# View app logs
pm2 logs infinite-trading

# Restart app
pm2 restart infinite-trading

# Restart Nginx
systemctl restart nginx

# Check Nginx error logs
tail -f /var/log/nginx/error.log
```

### On Local Machine
```bash
# Update GitHub remote
git remote set-url origin https://github.com/NEW_USERNAME/infinitetrading.git

# Push changes
git push origin main
```

---

## Troubleshooting

### App won't start
```bash
pm2 logs infinite-trading
# Check for errors in logs
```

### Database not loading
```bash
# Verify file exists
ls -la /var/www/infinite-trading/data/store.json

# Check permissions
chmod 644 /var/www/infinite-trading/data/store.json
```

### Nginx 502 Bad Gateway
```bash
# Check if app is running
pm2 status

# Check if port 3000 is accessible
curl http://localhost:3000
```

### SSL not working
```bash
# Check certificate status
certbot certificates

# Renew manually
certbot renew
```

---

## Security Tips

1. **Disable root SSH login** (create a user with sudo access first)
2. **Configure firewall** (UFW):
   ```bash
   ufw allow 22
   ufw allow 80
   ufw allow 443
   ufw enable
   ```
3. **Use strong JWT_SECRET** in .env
4. **Keep dependencies updated**: `npm update`
5. **Regular backups**: Set up automated database backups

---

## Notes

- Keep the old VPS running until DNS propagation completes
- During migration, users might see old or new server
- Test thoroughly before canceling old VPS
- If old VPS auto-renews, cancel it ASAP after migration

Need help? Refer to:
- Hetzner docs: https://docs.hetzner.com
- z.com DNS: https://www.z.com/domain/dns
- PM2 docs: https://pm2.keymetrics.io
