#!/usr/bin/env bash
set -euo pipefail

SERVER_HOST="${SERVER_HOST:-104.194.70.96}"
SERVER_USER="${SERVER_USER:-root}"
SERVER_PORT="${SERVER_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/ai-finance-council}"
ARCHIVE="/tmp/ai-finance-council-deploy.tar.gz"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "打包项目..."
tar --exclude='.git' --exclude='node_modules' --exclude='.env' -czf "$ARCHIVE" .

echo "上传到 VPS..."
ssh -p "$SERVER_PORT" -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_HOST" "mkdir -p /tmp/ai-finance-council"
scp -P "$SERVER_PORT" "$ARCHIVE" "$SERVER_USER@$SERVER_HOST:/tmp/ai-finance-council/app.tar.gz"

echo "远程部署..."
ssh -p "$SERVER_PORT" "$SERVER_USER@$SERVER_HOST" "APP_DIR='$APP_DIR' bash -s" <<'REMOTE'
set -euo pipefail

rm -f /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y ca-certificates curl nginx

if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  . /etc/os-release
  case "$ID" in
    debian)
      DOCKER_REPO="https://download.docker.com/linux/debian"
      ;;
    ubuntu)
      DOCKER_REPO="https://download.docker.com/linux/ubuntu"
      ;;
    *)
      DOCKER_REPO=""
      ;;
  esac

  if [ -n "$DOCKER_REPO" ]; then
    curl -fsSL "$DOCKER_REPO/gpg" -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] $DOCKER_REPO ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  else
    apt-get install -y docker.io docker-compose-plugin
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin
fi

systemctl enable docker
systemctl start docker

mkdir -p "$APP_DIR"
tar -xzf /tmp/ai-finance-council/app.tar.gz -C "$APP_DIR"
cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  sed -i 's/^HOST=.*/HOST=0.0.0.0/' .env
  sed -i 's/^PORT=.*/PORT=4177/' .env
fi

docker compose up -d --build

cp deploy/nginx/ai-finance-council.conf /etc/nginx/sites-available/ai-finance-council.conf
ln -sf /etc/nginx/sites-available/ai-finance-council.conf /etc/nginx/sites-enabled/ai-finance-council.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx

curl -fsS http://127.0.0.1:4177/health
REMOTE

echo
echo "部署完成："
echo "http://$SERVER_HOST"
