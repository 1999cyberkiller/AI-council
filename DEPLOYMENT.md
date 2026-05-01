# VPS 部署手册

推荐部署方式是 Docker Compose。它最干净，迁移和回滚都轻。

## 服务器要求

- Ubuntu 22.04 或 24.04
- Docker 与 Docker Compose
- 开放 80 端口
- 如果使用 HTTPS，再开放 443 端口

## 方式一：Docker Compose

在服务器上创建目录：

```bash
sudo mkdir -p /opt/ai-finance-council
sudo chown -R $USER:$USER /opt/ai-finance-council
```

把项目文件上传到：

```text
/opt/ai-finance-council
```

创建生产环境变量：

```bash
cp .env.example .env
```

生产环境建议使用：

```text
HOST=0.0.0.0
PORT=4177
```

启动：

```bash
docker compose up -d --build
```

检查：

```bash
curl http://127.0.0.1:4177/health
docker compose ps
docker compose logs -f
```

## Nginx 反向代理

复制配置：

```bash
sudo cp deploy/nginx/ai-finance-council.conf /etc/nginx/sites-available/ai-finance-council.conf
sudo ln -s /etc/nginx/sites-available/ai-finance-council.conf /etc/nginx/sites-enabled/ai-finance-council.conf
sudo nginx -t
sudo systemctl reload nginx
```

有域名时，把 `server_name _;` 改成自己的域名。

HTTPS 可以用 Certbot：

```bash
sudo certbot --nginx -d your-domain.com
```

## 方式二：Node + systemd

如果不用 Docker，把项目放到：

```text
/opt/ai-finance-council
```

安装 Node.js 20 或以上版本。

复制 service：

```bash
sudo cp deploy/systemd/ai-finance-council.service /etc/systemd/system/ai-finance-council.service
sudo systemctl daemon-reload
sudo systemctl enable ai-finance-council
sudo systemctl start ai-finance-council
```

检查：

```bash
systemctl status ai-finance-council
journalctl -u ai-finance-council -f
curl http://127.0.0.1:4177/health
```

## 环境变量

至少保留：

```text
HOST=0.0.0.0
PORT=4177
SEC_USER_AGENT=AI-Finance-Council your-email@example.com
```

需要真实模型时填写。只有 ChatGPT Plus 不能调用 OpenAI API，OpenAI API 需要单独开通和计费。

```text
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
XAI_API_KEY=
```

免费数据源默认可用：

```text
DATA_MODE=free
```

需要更稳定或更高质量的数据源时，再切到 paid：

```text
DATA_MODE=paid
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
BRAVE_SEARCH_API_KEY=
TAVILY_API_KEY=
```

## 迁移注意

`.env` 不要提交到 Git。它包含模型 key 和数据源 key。

若只通过 Nginx 暴露服务，Docker Compose 里的端口映射保持 `127.0.0.1:4177:4177`。这样外部无法直接访问 Node 端口。
