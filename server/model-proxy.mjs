import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.DISPATCH_PROXY_PORT || 8787);
const HOST = process.env.DISPATCH_PROXY_HOST || '127.0.0.1';
const MAX_BODY_BYTES = Number(process.env.DISPATCH_MAX_BODY_BYTES || 1024 * 1024);
const MODEL_TIMEOUT_MS = Number(process.env.DISPATCH_MODEL_TIMEOUT_MS || 300000);
const MARKET_TIMEOUT_MS = Number(process.env.DISPATCH_MARKET_TIMEOUT_MS || 12000);
const API_TOKEN = process.env.DISPATCH_API_TOKEN || process.env.API_TOKEN || '';
const RATE_LIMIT_WINDOW_MS = Number(process.env.DISPATCH_RATE_LIMIT_WINDOW_MS || 60_000);
const MODEL_RATE_LIMIT_MAX = Number(process.env.DISPATCH_MODEL_RATE_LIMIT_MAX || 120);
const MARKET_RATE_LIMIT_MAX = Number(process.env.DISPATCH_MARKET_RATE_LIMIT_MAX || 240);
const rateWindows = new Map();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...proxyHeaders(),
  });
  res.end(body);
}

function proxyHeaders(extra = {}) {
  return {
    'X-Dispatch-Proxy': '1',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    ...extra,
  };
}

function redact(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, 'AIza***')
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, 'xai-***')
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-***')
    .replace(/[a-f0-9]{32}\.[A-Za-z0-9_-]{8,}/gi, 'zhipu-***');
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error(`请求体过大，限制 ${MAX_BODY_BYTES} 字节`);
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    const raw = Buffer.concat(chunks).toString('utf8') || '{}';
    return JSON.parse(raw);
  } catch {
    const error = new Error('请求 JSON 解析失败');
    error.code = 'BAD_JSON';
    throw error;
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkRateLimit(req, scope, maxHits) {
  if (!Number.isFinite(maxHits) || maxHits <= 0) return { allowed: true };
  const now = Date.now();
  const key = `${scope}:${clientIp(req)}`;
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (rateWindows.get(key) || []).filter((ts) => ts > cutoff);
  if (hits.length >= maxHits) {
    const retryAfter = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - hits[0])) / 1000));
    return { allowed: false, retryAfter, limit: maxHits };
  }
  hits.push(now);
  rateWindows.set(key, hits);
  return { allowed: true, hits: hits.length, limit: maxHits };
}

function enforceRateLimit(req, res, scope, maxHits) {
  const rate = checkRateLimit(req, scope, maxHits);
  if (rate.allowed) return true;
  res.writeHead(429, proxyHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(rate.retryAfter),
  }));
  res.end(JSON.stringify({
    error: `请求过于频繁，${rate.retryAfter} 秒后重试。`,
    limit: rate.limit,
  }));
  return false;
}

function requireApiToken(req) {
  if (!API_TOKEN) return { ok: true, enforced: false };
  const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const presented = req.headers['x-api-token'] || req.headers['x-dispatch-api-token'] || reqUrl.searchParams.get('token') || '';
  if (!presented) return { ok: false, reason: '缺少 X-Api-Token' };
  const actual = Buffer.from(String(presented));
  const expected = Buffer.from(String(API_TOKEN));
  if (actual.length !== expected.length) return { ok: false, reason: 'token 不匹配' };
  return crypto.timingSafeEqual(actual, expected)
    ? { ok: true, enforced: true }
    : { ok: false, reason: 'token 不匹配' };
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少 ${name}`);
  }
  return value.trim();
}

async function parseJsonOrText(response) {
  const text = await response.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        if (typeof part?.content === 'string') return part.content;
        return '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function extractChatContent(providerName, payload, rawText = '') {
  const choice = payload?.choices?.[0];
  if (!choice) {
    throw new Error(`${providerName} 返回结构异常：${redact(rawText || JSON.stringify(payload)).slice(0, 240)}`);
  }
  const message = choice.message || {};
  const content = normalizeMessageContent(message.content);
  if (content) return content;

  const reasoning = normalizeMessageContent(message.reasoning_content);
  if (reasoning) {
    throw new Error(`${providerName} 只返回了推理内容，最终正文为空；请调高输出长度或重试`);
  }
  throw new Error(`${providerName} 返回正文为空：${redact(rawText || JSON.stringify(payload)).slice(0, 240)}`);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('请求超时')), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.status === 429 || response.status >= 500) {
        lastResponse = response;
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        continue;
      }
    }
  }
  if (lastResponse) return lastResponse;
  throw lastError || new Error('请求失败');
}

function assertPublicHttpsEndpoint(endpoint) {
  const u = new URL(requireText(endpoint, 'API 端点'));
  if (u.protocol !== 'https:') throw new Error('自定义模型端点必须使用 HTTPS');
  const host = u.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]' ||
    host.startsWith('10.') ||
    host.startsWith('127.') ||
    host.startsWith('169.254.') ||
    host.startsWith('192.168.') ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('自定义模型端点不允许指向内网地址');
  }
  return u.toString();
}

function openAIStyleBody({ model, systemPrompt, userPrompt, maxTokens, jsonMode = false }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: jsonMode ? 0.35 : 0.7,
    max_tokens: maxTokens || 2000,
  };
  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

async function postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode }) {
  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openAIStyleBody({ model, systemPrompt, userPrompt, maxTokens, jsonMode })),
  }, MODEL_TIMEOUT_MS);
}

async function callOpenAIStyle({ providerName, url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode = false }) {
  let response = await postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode });
  let parsed = await parseJsonOrText(response);

  if (!response.ok && jsonMode && response.status === 400 && /response_format|json/i.test(parsed.text || '')) {
    response = await postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode: false });
    parsed = await parseJsonOrText(response);
  }

  if (!response.ok) {
    throw new Error(`${providerName} ${response.status}: ${redact(parsed.text).slice(0, 240)}`);
  }

  return extractChatContent(providerName, parsed.json, parsed.text);
}

function geminiGenerationConfig(model, maxTokens) {
  const config = {
    temperature: 0.35,
    maxOutputTokens: maxTokens || 1400,
    responseMimeType: 'application/json',
  };
  if (/flash/i.test(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

async function postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, useThinkingConfig = true, useJsonMime = true }) {
  const generationConfig = geminiGenerationConfig(model, maxTokens);
  if (!useThinkingConfig) delete generationConfig.thinkingConfig;
  if (!useJsonMime) delete generationConfig.responseMimeType;

  return fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig,
      }),
    },
    MODEL_TIMEOUT_MS
  );
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  let response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens });

  let parsed = await parseJsonOrText(response);
  if (!response.ok && response.status === 400 && /thinkingConfig|thinking_budget|ThinkingBudget|responseMimeType|json/i.test(parsed.text || '')) {
    response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, useThinkingConfig: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok && response.status === 400 && /responseMimeType|json|mime/i.test(parsed.text || '')) {
    response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, useThinkingConfig: false, useJsonMime: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok && response.status === 404 && model !== 'gemini-2.5-flash') {
    response = await postGemini({ apiKey, model: 'gemini-2.5-flash', systemPrompt, userPrompt, maxTokens, useThinkingConfig: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok) {
    throw new Error(`Gemini ${response.status}: ${redact(parsed.text).slice(0, 240)}`);
  }

  const parts = parsed.json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const finishReason = parsed.json?.candidates?.[0]?.finishReason;
    const promptFeedback = parsed.json?.promptFeedback ? JSON.stringify(parsed.json.promptFeedback) : '';
    throw new Error(`Gemini 返回结构异常${finishReason ? ` (${finishReason})` : ''}：${redact(parsed.text || promptFeedback).slice(0, 240)}`);
  }
  const content = parts.map((part) => part.text || '').join('\n').trim();
  if (!content) {
    const finishReason = parsed.json?.candidates?.[0]?.finishReason;
    throw new Error(`Gemini 返回为空${finishReason ? ` (${finishReason})` : ''}`);
  }
  return content;
}

async function handleModel(req, res, provider) {
  const body = await readBody(req);
  const apiKey = requireText(body.apiKey, 'API Key');
  const model = requireText(body.model, '模型名称');
  const systemPrompt = requireText(body.systemPrompt, 'system prompt');
  const userPrompt = requireText(body.userPrompt, 'user prompt');
  const maxTokens = Number(body.maxTokens || 2000);

  if (provider === 'deepseek') {
    return callOpenAIStyle({
      providerName: 'DeepSeek',
      url: 'https://api.deepseek.com/chat/completions',
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
    });
  }

  if (provider === 'gemini') {
    return callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens });
  }

  if (provider === 'grok') {
    return callOpenAIStyle({
      providerName: 'Grok',
      url: 'https://api.x.ai/v1/chat/completions',
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
    });
  }

  if (provider === 'minimax') {
    return callOpenAIStyle({
      providerName: 'NVIDIA NIM',
      url: 'https://integrate.api.nvidia.com/v1/chat/completions',
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
      jsonMode: true,
    });
  }

  if (provider === 'zhipu') {
    return callOpenAIStyle({
      providerName: 'Zhipu',
      url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
    });
  }

  if (provider === 'openai-compatible') {
    return callOpenAIStyle({
      providerName: 'OpenAI-compatible',
      url: assertPublicHttpsEndpoint(body.endpoint),
      apiKey,
      model,
      systemPrompt,
      userPrompt,
      maxTokens,
    });
  }

  const error = new Error(`不支持的模型通道：${provider}`);
  error.status = 404;
  throw error;
}

async function handleEastmoney(req, res) {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const target = reqUrl.searchParams.get('url') || '';
  const u = new URL(target);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('eastmoney.com')) {
    throw new Error('仅支持东方财富 HTTPS 接口');
  }
  const response = await fetchWithRetry(u.toString(), {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 AnalystsDispatch/1.0',
    },
  }, MARKET_TIMEOUT_MS);
  const text = await response.text();
  res.writeHead(response.ok ? 200 : response.status, {
    'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    ...proxyHeaders(),
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
      sendJson(res, 200, {
        ok: true,
        service: 'AI Council model proxy',
        uptime_seconds: Math.round(process.uptime()),
        auth: { token_required: Boolean(API_TOKEN) },
        limits: {
          max_body_bytes: MAX_BODY_BYTES,
          model_rate_limit_per_window: MODEL_RATE_LIMIT_MAX,
          market_rate_limit_per_window: MARKET_RATE_LIMIT_MAX,
          window_ms: RATE_LIMIT_WINDOW_MS,
          model_timeout_ms: MODEL_TIMEOUT_MS,
          market_timeout_ms: MARKET_TIMEOUT_MS,
        },
        generated_at: new Date().toISOString(),
      });
      return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/market/eastmoney') {
      if (!enforceRateLimit(req, res, 'market', MARKET_RATE_LIMIT_MAX)) return;
      await handleEastmoney(req, res);
      return;
    }

    const match = reqUrl.pathname.match(/^\/api\/model\/([a-z-]+)$/);
    if (req.method === 'POST' && match) {
      const auth = requireApiToken(req);
      if (!auth.ok) {
        sendJson(res, 401, { error: auth.reason || '鉴权失败' });
        return;
      }
      if (!enforceRateLimit(req, res, 'model', MODEL_RATE_LIMIT_MAX)) return;
      const content = await handleModel(req, res, match[1]);
      sendJson(res, 200, { content });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = redact(error.message || '模型代理失败');
    const statusMatch = message.match(/\b(400|401|403|404|429)\b/);
    const status = error.status
      ? error.status
      : error.code === 'PAYLOAD_TOO_LARGE'
      ? 413
      : error.code === 'BAD_JSON'
        ? 400
        : statusMatch
          ? Number(statusMatch[1])
          : /超时|aborted/i.test(message)
            ? 504
            : 500;
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`dispatch model proxy listening on http://${HOST}:${PORT}`);
  if (API_TOKEN) {
    console.log('dispatch model proxy API token enabled');
  }
});

setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [key, hits] of rateWindows) {
    const fresh = hits.filter((ts) => ts > cutoff);
    if (fresh.length) rateWindows.set(key, fresh);
    else rateWindows.delete(key);
  }
}, 5 * 60_000).unref?.();
