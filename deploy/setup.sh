#!/bin/bash
# Nebius の VM (Ubuntu 24.04) に Forkline を入れる。VM を作るときの cloud-init から root で1回走らせる。
# 入れるもの: Node 22、Caddy、/opt/forkline (GitHub から取得して組み立て)、systemd の forkline.service
# 秘密の設定 (/etc/forkline/forkline.env) は入れない。入れてから `systemctl start forkline` する
set -euo pipefail
REPO=https://github.com/user-s0ma/forkline.git
APP=/opt/forkline

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg git debian-keyring debian-archive-keyring apt-transport-https

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Caddy
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy

id forkline >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin forkline

if [ ! -d "$APP/.git" ]; then git clone --depth 1 "$REPO" "$APP"; fi
cd "$APP"
npm ci
npm run build

install -d -m 750 -o root -g forkline /etc/forkline
[ -f /etc/forkline/forkline.env ] || install -m 640 -o root -g forkline /dev/null /etc/forkline/forkline.env
install -m 644 deploy/forkline.service /etc/systemd/system/forkline.service

# Caddy が受けるホスト名。DNS を切り替えるまでは、IP から作る sslip.io の名前で HTTPS を確かめる
IP=$(curl -fsS https://api.ipify.org)
SITE="${SITE_ADDRESS:-${IP//./-}.sslip.io}"
install -m 644 deploy/Caddyfile /etc/caddy/Caddyfile
install -d /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment="SITE_ADDRESS=%s"\n' "$SITE" > /etc/systemd/system/caddy.service.d/site.conf

systemctl daemon-reload
systemctl enable forkline
systemctl restart caddy
echo "forkline: setup done (site: $SITE)"
