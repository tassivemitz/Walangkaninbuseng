# Migration Checklist

## Pre-Migration
- [ ] Create new GitHub account (if not already done)
- [ ] Create new Hetzner account (if not already done)
- [ ] Backup local database (data/store.json)
- [ ] Note down current domain DNS settings

## GitHub Migration
- [ ] Create new repository on new GitHub account
- [ ] Run `migrate-local.bat` option 1 (or manually update remote)
- [ ] Verify all files are in new repository
- [ ] Verify commit history is preserved
- [ ] Delete old repository (optional, after verification)

## VPS Setup
- [ ] Create new Hetzner VPS (Ubuntu 22.04/24.04)
- [ ] Note VPS IP address
- [ ] SSH into new VPS
- [ ] Run `deploy.sh` script on VPS
- [ ] Upload database file (via `migrate-local.bat` option 2 or manually)
- [ ] Verify application is running (pm2 status)
- [ ] Test application at http://VPS_IP:3000

## Domain Migration
- [ ] Login to z.com control panel
- [ ] Update DNS A record to new VPS IP
- [ ] Wait for DNS propagation (24-48 hours)
- [ ] Verify with nslookup or dnschecker.org
- [ ] Test site at https://your-domain.com

## Post-Migration
- [ ] Test all features (login, trading, admin panel)
- [ ] Verify SSL certificate is valid
- [ ] Check application logs (pm2 logs)
- [ ] Cancel old VPS (after successful verification)
- [ ] Remove old GitHub repository (optional)

## Security Setup (Recommended)
- [ ] Create non-root user with sudo access
- [ ] Disable root SSH login
- [ ] Configure SSH key authentication
- [ ] Set up UFW firewall
- [ ] Regular backup schedule for database

## Notes
- Keep old VPS running until DNS propagates
- During migration, users may see old or new server
- Test thoroughly before canceling old services
- Save this checklist for reference

---

## Quick Command Reference

### Local (Windows)
```batch
# Migrate GitHub
migrate-local.bat
# Choose option 1

# Upload database
migrate-local.bat
# Choose option 2
```

### VPS
```bash
# Check app status
pm2 status

# View logs
pm2 logs infinite-trading

# Restart app
pm2 restart infinite-trading

# Restart Nginx
systemctl restart nginx

# Renew SSL
certbot renew
```

### DNS Check
```bash
# On Windows
nslookup your-domain.com

# On Mac/Linux
dig your-domain.com
```

---

## Contact Info
- Hetzner Support: https://www.hetzner.com/support
- z.com Support: https://www.z.com/support
- GitHub Help: https://docs.github.com
