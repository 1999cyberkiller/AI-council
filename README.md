# 分析师公报 · The Analyst's Dispatch

四模型并行投资分析平台 · 集成 A 股 + 美股行情 · 主编综评 · K 线图 · 历史档案

## 功能

- **四位分析师并行撰稿**：价值派 / 技术派 / 宏观派 / 风险派，各由不同 LLM 担任
- **主编综评**：第五个 LLM 综合四篇专栏，给出共识 / 分歧 / 最终裁决
- **行情数据**：A 股（东方财富，无 key）+ 美股（Alpha Vantage）
- **K 线图**：技术派栏目内嵌 90 日蜡烛图 + MA20/MA60，鼠标悬停查看 OHLC
- **历史档案**：自动归档每次分析，可回看任意一次（最多 50 条）
- **自动重试**：API 失败自动重试 + 手动重试按钮
- **模型变体**：每个内置模型可在多个具体型号间切换（DeepSeek-Chat/Reasoner、Gemini Flash/Pro 等）
- **持久化配置**：API key、模型选择、变体、分配自动保存到浏览器 localStorage
- **Basic Auth**：默认开启，避免公网随便访问

## 项目结构

```
analysts-dispatch/
├── deploy.sh              # VPS 一键部署（含 Basic Auth）
├── index.html             # 入口
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── vite.config.js
├── src/
│   ├── App.jsx            # 主应用
│   ├── index.css          # Tailwind 入口
│   └── main.jsx           # React 挂载
└── README.md
```

---

## 一、上传到 GitHub（私有仓库）

### 1.1 在 GitHub 网页端创建空仓库

1. 打开 https://github.com/new
2. **Repository name**: `analysts-dispatch`
3. 选择 **Private**
4. **不要**勾选任何 "Add ..." 选项（仓库要保持空）
5. 点 **Create repository**

### 1.2 在本地把项目推上去

```bash
cd /path/to/analysts-dispatch
git init
git add .
git commit -m "Initial commit: 分析师公报 v1.0"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/analysts-dispatch.git
git push -u origin main
```

### 1.3 生成 GitHub Personal Access Token

部署到 VPS 时需要 PAT 才能 clone 私有仓库。

1. 打开 https://github.com/settings/tokens?type=beta （Fine-grained tokens）
2. **Generate new token**
3. **Token name**: `analysts-dispatch-deploy`
4. **Expiration**: 90 天（到期再生成）
5. **Repository access** → **Only select repositories** → 选 `analysts-dispatch`
6. **Permissions** → **Contents** = **Read-only**
7. **Generate token** → **立即复制**

形如 `github_pat_xxxxxxxxxx...`

---

## 二、部署到 VPS

### 2.1 上传 deploy.sh 到 VPS

```bash
# 在本地电脑执行
scp deploy.sh root@YOUR_VPS_IP:/root/
```

或者直接复制粘贴：
```bash
ssh root@YOUR_VPS_IP
nano /root/deploy.sh   # 粘贴 → Ctrl+O 保存 → Ctrl+X 退出
chmod +x /root/deploy.sh
```

### 2.2 SSH 登录 + 一键部署

```bash
ssh root@YOUR_VPS_IP
cd /root

# 必填：GitHub 凭据
export GH_USER="your-github-username"
export GH_TOKEN="github_pat_xxx..."
export REPO_NAME="analysts-dispatch"

# 可选：Basic Auth（强烈建议保留默认 yes）
export BASIC_AUTH=yes
export BASIC_AUTH_USER="admin"
# export BASIC_AUTH_PASS="自己设密码"   # 不设则脚本随机生成 16 位

# 可选：自定义端口（默认 8080）
# export PORT=8080

bash deploy.sh
```

### 2.3 部署完成后

脚本最后会输出：
```
✓ 部署完成

  访问地址: http://1.2.3.4:8080

  ▸ Basic Auth 已启用
    用户名: admin
    密码: K3mP9aW2xN8vZqRb   ← 立即记下
```

浏览器打开访问地址 → 弹出登录框 → 输入用户名密码 → 进入应用。

### 2.4 后续更新

代码改动后：

```bash
ssh root@YOUR_VPS_IP
cd /var/www/analysts-dispatch
git pull && npm install && npm run build && systemctl reload nginx
```

或本地 push 到 GitHub 后，VPS 上重跑 `bash deploy.sh`（脚本幂等）。

---

## 三、使用步骤

### 3.1 首次配置

打开页面后点右上角 ⚙ 按钮，配置三件事：

1. **模型 API Key** — 至少填一个
   - DeepSeek: https://platform.deepseek.com
   - Gemini: https://aistudio.google.com
   - Grok: https://console.x.ai
   - MiniMax (via NVIDIA NIM): https://build.nvidia.com

2. **专栏模型分配** — 把 4 位分析师 + 主编 各自分配到一个模型

3. **Alpha Vantage Key**（美股需要）— https://alphavantage.co/support/#api-key 免费申请

A 股不需要任何 key，东方财富接口直接可用。

### 3.2 日常使用

- 输入框中可输入：A 股代码（`600519`）、A 股名称（`贵州茅台`）、美股代码（`AAPL`）
- 点 **召集议会** → 系统自动获取行情 + K 线 + 4 篇专栏 + 主编综评
- 点右上角 **⌘** 进入历史档案，回看任何一次分析（最多保留 50 条）
- 任何专栏失败时点 **↻ 重新撰稿** 单独重试

---

## 四、Basic Auth 管理

```bash
# 改密码
htpasswd -b /etc/nginx/.htpasswd-analysts-dispatch admin 新密码

# 加用户
htpasswd /etc/nginx/.htpasswd-analysts-dispatch 新用户名

# 删用户
htpasswd -D /etc/nginx/.htpasswd-analysts-dispatch 用户名

# 改完不用 reload，nginx 会自动读取
```

---

## 五、关闭 Basic Auth（不建议）

如果你确定不需要密码保护：

```bash
ssh root@YOUR_VPS_IP
nano /etc/nginx/conf.d/analysts-dispatch.conf
# 删掉 auth_basic 和 auth_basic_user_file 两行
nginx -t && systemctl reload nginx
```

或者：
```bash
export BASIC_AUTH=no
bash deploy.sh
```

---

## 六、修改端口

```bash
export PORT=80
bash deploy.sh
```

如果 80 端口被默认 nginx 站点占用：
```bash
rm /etc/nginx/sites-enabled/default   # Debian/Ubuntu
# 或
mv /etc/nginx/conf.d/default.conf /etc/nginx/conf.d/default.conf.bak  # CentOS
nginx -t && systemctl reload nginx
```

---

## 七、安全提醒

⚠️ 即使开了 Basic Auth，仍要注意：

- **API key 存浏览器 localStorage** — 同一台电脑同一个浏览器，所有进入应用的人都能看到对方的 key
- **建议每个使用者用自己的 Basic Auth 账号** + 自己的 API key
- **不要在公共电脑（网吧/共享办公位）上输入生产环境 key**
- **API key 价值低的优先**（NVIDIA NIM 免费，DeepSeek 几分钱一次）

如果想彻底隔离 key（让 key 永不出 VPS），需要改造成后端代理模式 — 这是个比较大的改动，需要的话可以单独提需求。

---

## 八、本地开发

```bash
npm install
npm run dev    # http://localhost:5173
```

修改 `src/App.jsx` 后浏览器自动刷新。

---

## 九、故障排查

| 现象 | 排查 |
|---|---|
| `git push` 鉴权失败 | 用 PAT 而不是密码 |
| Node 版本太低 | 脚本会自动装 20.x，失败的话手动 `curl -fsSL https://deb.nodesource.com/setup_20.x \| bash -` |
| nginx 启动失败 | `nginx -t` / `journalctl -u nginx -n 50` |
| 浏览器打不开 | 检查 VPS 防火墙 + 云厂商安全组都放行了端口 |
| Basic Auth 弹窗后输错密码 | 重新生成：`htpasswd -b /etc/nginx/.htpasswd-analysts-dispatch admin 新密码` |
| 模型 API 失败 | 配置面板检查 key；F12 Network 看具体错误 |
| Alpha Vantage 报频率限制 | 免费层 25/日，等到第二天 |
| A 股名称搜索失败 | 改输 6 位代码（如 002448）；东方财富搜索接口偶尔不稳定 |
| MiniMax 返回乱码 | 推理模型 `<think>` 标签没剥干净；通常重试一次就好 |

---

## 许可

私有项目。
