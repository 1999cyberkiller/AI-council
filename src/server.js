import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeWithCouncil } from "./council-engine.js";
import { publicCouncilConfig } from "./council-config.js";
import { loadEnv } from "./env.js";
import { tools } from "./finance-tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

loadEnv(root);

const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "127.0.0.1";

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, {
        ok: true,
        service: "MAGI SYSTEM",
        uptime_seconds: Math.round(process.uptime()),
        generated_at: new Date().toISOString()
      });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      return sendJson(res, {
        council: publicCouncilConfig(),
        tools
      });
    }

    if (req.method === "POST" && url.pathname === "/api/analyze") {
      const body = await readBody(req);
      const result = await analyzeWithCouncil(body);
      return sendJson(res, result);
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, { error: "未找到请求的资源。" }, 404);
  } catch (error) {
    sendJson(res, { error: error.message || "服务端错误。" }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`MAGI SYSTEM 已启动：http://${host}:${port}`);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  server.close(() => {
    console.log("MAGI SYSTEM 已停止。");
    process.exit(0);
  });
}

async function serveStatic(requestPath, res) {
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath === "/" ? "index.html" : safePath);

  if (!filePath.startsWith(publicDir)) {
    return sendText(res, "禁止访问。", 403);
  }

  try {
    const data = await fs.readFile(filePath);
    sendBuffer(res, data, contentType(filePath));
  } catch {
    const index = await fs.readFile(path.join(publicDir, "index.html"));
    sendBuffer(res, index, "text/html; charset=utf-8");
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  return JSON.parse(text);
}

function sendJson(res, payload, status = 200) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, text, status = 200) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendBuffer(res, buffer, type) {
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store"
  });
  res.end(buffer);
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}
