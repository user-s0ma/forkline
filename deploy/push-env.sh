#!/bin/bash
# 本番の設定 (.env.production.local) を VM に送り、Forkline を起動し直す。
#   bash deploy/push-env.sh <SSH の鍵> [ホスト]
# .env.production.local は deploy/forkline.env.example を写して埋めたもの (git に入らない)
set -euo pipefail
ENV_FILE=.env.production.local
KEY=${1:?SSH の鍵を指定してください}
HOST=${2:-forkops@66.201.5.247}
SSH_OPTS=(-i "$KEY" -o StrictHostKeyChecking=accept-new)

scp "${SSH_OPTS[@]}" "$ENV_FILE" "$HOST:/tmp/forkline.env"
ssh "${SSH_OPTS[@]}" "$HOST" '
  set -e
  sudo install -m 640 -o root -g forkline /tmp/forkline.env /etc/forkline/forkline.env
  rm -f /tmp/forkline.env
  sudo sed -i "s/\r$//" /etc/forkline/forkline.env
  sudo systemctl restart forkline
  sleep 3
  systemctl --no-pager --lines 5 status forkline
'
