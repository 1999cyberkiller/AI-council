#!/usr/bin/env bash
# ========================================================================
# AI 议会 · VPS 部署脚本 (with Basic Auth)
# 用法: bash deploy.sh
# 环境: Linux (Ubuntu/Debian/CentOS) · 需要 root 或 sudo
# ========================================================================
set -e

# ── 配置区 ──────────────────────────────────────────────────────────
PORT="${PORT:-8080}"
APP_NAME="analysts-dispatch"
APP_DIR="/var/www/${APP_NAME}"
NGINX_CONF="/etc/nginx/conf.d/${APP_NAME}.conf"
HTPASSWD_FILE="/etc/nginx/.htpasswd-${APP_NAME}"
NODE_MAJOR=20

# 私有仓库需要在执行前先 export 这些变量（详见 README）:
# export GH_USER="your-github-username"
# export GH_TOKEN="ghp_xxxxxxxxxxxx"
# export REPO_NAME="analysts-dispatch"
#
# 启用 Basic Auth (强烈建议, 默认 yes):
# export BASIC_AUTH=yes              # 设为 no 关闭
# export BASIC_AUTH_USER="admin"     # 用户名
# export BASIC_AUTH_PASS="..."       # 密码（不设置则随机生成 16 位）
# ────────────────────────────────────────────────────────────────────

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
log()  { echo -e "${G}▸${N} $1"; }
warn() { echo -e "${Y}!${N} $1"; }
err()  { echo -e "${R}✗${N} $1"; exit 1; }

[[ $EUID -eq 0 ]] || err "此脚本需要 root 权限，请使用 sudo bash deploy.sh"

[[ -n "${GH_USER:-}" ]]    || err "未设置 GH_USER（GitHub 用户名）"
[[ -n "${GH_TOKEN:-}" ]]   || err "未设置 GH_TOKEN（Personal Access Token）"
[[ -n "${REPO_NAME:-}" ]]  || err "未设置 REPO_NAME（仓库名）"

BASIC_AUTH="${BASIC_AUTH:-yes}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"

# 1. 检测包管理器
if   command -v apt-get >/dev/null; then PM="apt"
elif command -v dnf     >/dev/null; then PM="dnf"
elif command -v yum     >/dev/null; then PM="yum"
else err "未检测到 apt / dnf / yum"
fi
log "包管理器: $PM"

# 2. Node.js
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 18 ]]; then
  log "安装 Node.js ${NODE_MAJOR}.x..."
  if [[ "$PM" == "apt" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    $PM install -y nodejs
  fi
fi
log "Node 版本: $(node -v)"

# 3. nginx + git + htpasswd 工具
log "安装 nginx / git / htpasswd ..."
if [[ "$PM" == "apt" ]]; then
  apt-get update -qq
  apt-get install -y nginx git apache2-utils
else
  $PM install -y nginx git httpd-tools
fi

# 4. 克隆 / 拉取
REPO_URL="https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO_NAME}.git"
if [[ -d "$APP_DIR/.git" ]]; then
  log "更新已有代码: $APP_DIR"
  cd "$APP_DIR"
  git remote set-url origin "$REPO_URL"
  git pull --rebase
else
  log "克隆仓库到 $APP_DIR..."
  rm -rf "$APP_DIR"
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# 5. 构建
log "安装 npm 依赖..."
npm install --no-audit --no-fund
log "构建生产版本..."
npm run build
[[ -d "$APP_DIR/dist" ]] || err "构建失败：未找到 dist 目录"

# 6. Basic Auth
AUTH_BLOCK=""
GENERATED_PASS=0
if [[ "$BASIC_AUTH" == "yes" ]]; then
  if [[ -z "${BASIC_AUTH_PASS:-}" ]]; then
    BASIC_AUTH_PASS=$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 16)
    GENERATED_PASS=1
  fi
  log "配置 Basic Auth: 用户=${BASIC_AUTH_USER}"
  htpasswd -bc "$HTPASSWD_FILE" "$BASIC_AUTH_USER" "$BASIC_AUTH_PASS" >/dev/null
  chmod 640 "$HTPASSWD_FILE"
  AUTH_BLOCK="    auth_basic \"Restricted Access\";
    auth_basic_user_file ${HTPASSWD_FILE};"
fi

# 7. nginx 配置
log "写入 nginx 配置: $NGINX_CONF"
cat > "$NGINX_CONF" <<EOF
server {
    listen $PORT;
    listen [::]:$PORT;
    server_name _;

    root $APP_DIR/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml font/woff2;
    gzip_min_length 1024;

${AUTH_BLOCK}

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
EOF

# 8. 重载 nginx
log "测试 nginx 配置..."
nginx -t
log "重载 nginx..."
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx

# 9. 防火墙
if command -v ufw >/dev/null; then
  log "ufw 放行端口 $PORT..."
  ufw allow ${PORT}/tcp >/dev/null 2>&1 || true
elif command -v firewall-cmd >/dev/null && systemctl is-active firewalld >/dev/null 2>&1; then
  log "firewalld 放行端口 $PORT..."
  firewall-cmd --permanent --add-port=${PORT}/tcp >/dev/null
  firewall-cmd --reload >/dev/null
fi

# 10. 完成
SERVER_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null \
  || curl -s --max-time 3 ipinfo.io/ip 2>/dev/null \
  || hostname -I | awk '{print $1}')

echo ""
log "✓ 部署完成"
echo ""
echo "  访问地址: http://${SERVER_IP}:${PORT}"
echo "  应用目录: $APP_DIR"
echo "  nginx 配置: $NGINX_CONF"
if [[ "$BASIC_AUTH" == "yes" ]]; then
  echo ""
  echo -e "  ${G}▸ Basic Auth 已启用${N}"
  echo "    用户名: ${BASIC_AUTH_USER}"
  if [[ "$GENERATED_PASS" == "1" ]]; then
    echo -e "    ${Y}密码: ${BASIC_AUTH_PASS}${N}  ← 自动生成，请立即记下！"
  else
    echo "    密码: (你已设置的密码)"
  fi
  echo "    htpasswd 文件: $HTPASSWD_FILE"
  echo ""
  echo "  改密码: htpasswd -b ${HTPASSWD_FILE} ${BASIC_AUTH_USER} 新密码"
  echo "  加用户: htpasswd ${HTPASSWD_FILE} 新用户名"
else
  echo ""
  warn "Basic Auth 未启用，任何能访问 IP:端口 的人都能用你的服务"
fi
echo ""
echo "  更新代码: cd $APP_DIR && git pull && npm install && npm run build && systemctl reload nginx"
