#!/usr/bin/env bash
# Root, on the VPS: installs cloudflare-realip.conf into nginx's http context,
# keeping the previous state if `nginx -t` fails.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }
SRC="$(dirname "$0")/cloudflare-realip.conf"
DST=/etc/nginx/conf.d/cloudflare-realip.conf
grep -q "include /etc/nginx/conf.d/\*.conf" /etc/nginx/nginx.conf || { echo "nginx.conf doesn't include conf.d/*.conf" >&2; exit 1; }
BAK=""
if [[ -f "$DST" ]]; then BAK="$DST.bak-$(date +%F-%H%M)"; cp "$DST" "$BAK"; fi
cp "$SRC" "$DST"
if nginx -t; then
  systemctl reload nginx && echo "RELOADED: nginx now trusts CF-Connecting-IP from Cloudflare"
else
  if [[ -n "$BAK" ]]; then cp "$BAK" "$DST"; else rm -f "$DST"; fi
  echo "FAILED - previous state restored" >&2
  exit 1
fi
