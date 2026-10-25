#!/bin/bash
# VM の上の Forkline を GitHub の main に合わせて組み立て直し、再起動する。root で走らせる
set -euo pipefail
cd /opt/forkline
git fetch --depth 1 origin main
git reset --hard origin/main
npm ci
npm run build:node
install -m 644 deploy/forkline.service /etc/systemd/system/forkline.service
systemctl daemon-reload
systemctl restart forkline
systemctl --no-pager --lines 5 status forkline
