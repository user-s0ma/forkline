#!/bin/bash
# VM の上の Forkline を GitHub の main に合わせて組み立て直し、再起動する。root で走らせる
set -euo pipefail
cd /opt/forkline
git fetch --depth 1 origin main
git reset --hard origin/main
npm ci
npm run build
install -m 644 deploy/forkline.service /etc/systemd/system/forkline.service
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl restart forkline
systemctl reload caddy
systemctl --no-pager --lines 5 status forkline
