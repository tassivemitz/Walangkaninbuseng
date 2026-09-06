#!/usr/bin/env bash
# ==============================================================================
# Auto-Sync Watcher for DNS Propagation & Instant SSL Activation
# ==============================================================================

DOMAIN="infinitetrading.site"
WWW_DOMAIN="www.infinitetrading.site"
TARGET_IP="187.127.122.111"
EMAIL="admin@infinitetrading.site"

echo "=========================================================="
echo "  DNS & SSL Auto-Sync Daemon Started"
echo "  Watching: $DOMAIN -> $TARGET_IP"
echo "=========================================================="

# Ensure dnsutils (dig) is installed
if ! command -v dig >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y dnsutils
fi

while true; do
  RESOLVED_IP=$(dig +short "$DOMAIN" @8.8.8.8 | grep -E '^[0-9.]+$' | head -n1)
  
  if [ "$RESOLVED_IP" = "$TARGET_IP" ]; then
    echo ">>> [MATCH] DNS for $DOMAIN has resolved to $TARGET_IP!"
    echo ">>> Requesting Let's Encrypt SSL Certificate..."
    
    if certbot --nginx -d "$DOMAIN" -d "$WWW_DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
      echo "✓ SSL Certificate successfully installed and active!"
      systemctl reload nginx
      echo "=========================================================="
      echo "  SUCCESS: HTTPS is now 100% active on https://$DOMAIN"
      echo "=========================================================="
      exit 0
    else
      echo "Certbot encountered a temporary issue. Retrying in 60s..."
      sleep 60
    fi
  else
    echo "[$(date '+%H:%M:%S')] Checking DNS... Waiting for propagation (Current: '$RESOLVED_IP')..."
    sleep 30
  fi
done
