const DEFAULTS = {
  maxBodyBytes: 1024 * 1024,
  modelTimeoutMs: 300000,
  marketTimeoutMs: 12000,
  rateLimitWindowMs: 60000,
  modelRateLimitMax: 120,
  marketRateLimitMax: 240,
};

const rateWindows = new Map();

function numberEnv(env, key, fallback) {
  const n = Number(env?.[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function runtime(env) {
  return {
    maxBodyBytes: numberEnv(env, 'DISPATCH_MAX_BODY_BYTES', DEFAULTS.maxBodyBytes),
    modelTimeoutMs: numberEnv(env, 'DISPATCH_MODEL_TIMEOUT_MS', DEFAULTS.modelTimeoutMs),
    marketTimeoutMs: numberEnv(env, 'DISPATCH_MARKET_TIMEOUT_MS', DEFAULTS.marketTimeoutMs),
    rateLimitWindowMs: numberEnv(env, 'DISPATCH_RATE_LIMIT_WINDOW_MS', DEFAULTS.rateLimitWindowMs),
    modelRateLimitMax: numberEnv(env, 'DISPATCH_MODEL_RATE_LIMIT_MAX', DEFAULTS.modelRateLimitMax),
    marketRateLimitMax: numberEnv(env, 'DISPATCH_MARKET_RATE_LIMIT_MAX', DEFAULTS.marketRateLimitMax),
    apiToken: env?.DISPATCH_API_TOKEN || env?.API_TOKEN || '',
  };
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

function jsonResponse(status, payload, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...proxyHeaders(extraHeaders),
    },
  });
}

function textResponse(status, text, contentType) {
  return new Response(text, {
    status,
    headers: {
      'Content-Type': contentType || 'application/json; charset=utf-8',
      ...proxyHeaders(),
    },
  });
}

function redact(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, 'AIza***')
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, 'xai-***')
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-***')
    .replace(/[a-f0-9]{32}\.[A-Za-z0-9_-]{8,}/gi, 'zhipu-***');
}

async function readJsonBody(request, cfg) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > cfg.maxBodyBytes) {
    const error = new Error(`请求体过大，限制 ${cfg.maxBodyBytes} 字节`);
    error.status = 413;
    throw error;
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    const error = new Error('请求 JSON 解析失败');
    error.status = 400;
    throw error;
  }
}

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('cf-connecting-ip') || 'unknown';
}

function checkRateLimit(request, scope, maxHits, cfg) {
  if (!Number.isFinite(maxHits) || maxHits <= 0) return { allowed: true };
  const now = Date.now();
  const key = `${scope}:${clientIp(request)}`;
  const cutoff = now - cfg.rateLimitWindowMs;
  const hits = (rateWindows.get(key) || []).filter((ts) => ts > cutoff);
  if (hits.length >= maxHits) {
    const retryAfter = Math.max(1, Math.ceil((cfg.rateLimitWindowMs - (now - hits[0])) / 1000));
    return { allowed: false, retryAfter, limit: maxHits };
  }
  hits.push(now);
  rateWindows.set(key, hits);
  return { allowed: true };
}

function enforceRateLimit(request, scope, maxHits, cfg) {
  const rate = checkRateLimit(request, scope, maxHits, cfg);
  if (rate.allowed) return null;
  return jsonResponse(429, {
    error: `请求过于频繁，${rate.retryAfter} 秒后重试。`,
    limit: rate.limit,
  }, {
    'Retry-After': String(rate.retryAfter),
  });
}

function constantTimeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function requireApiToken(request, cfg) {
  if (!cfg.apiToken) return { ok: true, enforced: false };
  const reqUrl = new URL(request.url);
  const presented = request.headers.get('x-api-token')
    || request.headers.get('x-dispatch-api-token')
    || reqUrl.searchParams.get('token')
    || '';
  if (!presented) return { ok: false, reason: '缺少 X-Api-Token' };
  return constantTimeEqual(presented, cfg.apiToken)
    ? { ok: true, enforced: true }
    : { ok: false, reason: 'token 不匹配' };
}

function requireText(value, name) {
  if (typeof value !== 'string' || !value.trim()) {
    const error = new Error(`缺少 ${name}`);
    error.status = 400;
    throw error;
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
    const error = new Error(`${providerName} 返回结构异常：${redact(rawText || JSON.stringify(payload)).slice(0, 240)}`);
    error.status = 502;
    throw error;
  }
  const message = choice.message || {};
  const content = normalizeMessageContent(message.content);
  if (content) return content;

  const reasoning = normalizeMessageContent(message.reasoning_content);
  if (reasoning) {
    const error = new Error(`${providerName} 只返回了推理内容，最终正文为空；请调高输出长度或重试`);
    error.status = 502;
    throw error;
  }
  const error = new Error(`${providerName} 返回正文为空：${redact(rawText || JSON.stringify(payload)).slice(0, 240)}`);
  error.status = 502;
  throw error;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULTS.modelTimeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('请求超时'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, timeoutMs = DEFAULTS.modelTimeoutMs) {
  let lastResponse = null;
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
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

function isPrivateIpv4(host) {
  return host === 'localhost'
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host.startsWith('10.')
    || host.startsWith('127.')
    || host.startsWith('169.254.')
    || host.startsWith('192.168.')
    || /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function assertPublicHttpsEndpoint(endpoint) {
  const u = new URL(requireText(endpoint, 'API 端点'));
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:') throw new Error('自定义模型端点必须使用 HTTPS');
  if (host === '::1' || host === '[::1]' || host.includes(':') || isPrivateIpv4(host)) {
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
  if (jsonMode) body.response_format = { type: 'json_object' };
  return body;
}

async function postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode, cfg }) {
  return fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(openAIStyleBody({ model, systemPrompt, userPrompt, maxTokens, jsonMode })),
  }, cfg.modelTimeoutMs);
}

async function callOpenAIStyle({ providerName, url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode = false, cfg }) {
  let response = await postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode, cfg });
  let parsed = await parseJsonOrText(response);

  if (!response.ok && jsonMode && response.status === 400 && /response_format|json/i.test(parsed.text || '')) {
    response = await postOpenAIStyle({ url, apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode: false, cfg });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok) {
    const error = new Error(`${providerName} ${response.status}: ${redact(parsed.text).slice(0, 240)}`);
    error.status = response.status;
    throw error;
  }
  return extractChatContent(providerName, parsed.json, parsed.text);
}

function geminiGenerationConfig(model, maxTokens) {
  const config = {
    temperature: 0.35,
    maxOutputTokens: maxTokens || 1400,
    responseMimeType: 'application/json',
  };
  if (/flash/i.test(model)) config.thinkingConfig = { thinkingBudget: 0 };
  return config;
}

async function postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg, useThinkingConfig = true, useJsonMime = true }) {
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
    cfg.modelTimeoutMs
  );
}

async function callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg }) {
  let response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  let parsed = await parseJsonOrText(response);
  if (!response.ok && response.status === 400 && /thinkingConfig|thinking_budget|ThinkingBudget|responseMimeType|json/i.test(parsed.text || '')) {
    response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg, useThinkingConfig: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok && response.status === 400 && /responseMimeType|json|mime/i.test(parsed.text || '')) {
    response = await postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg, useThinkingConfig: false, useJsonMime: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok && response.status === 404 && model !== 'gemini-2.5-flash') {
    response = await postGemini({ apiKey, model: 'gemini-2.5-flash', systemPrompt, userPrompt, maxTokens, cfg, useThinkingConfig: false });
    parsed = await parseJsonOrText(response);
  }
  if (!response.ok) {
    const error = new Error(`Gemini ${response.status}: ${redact(parsed.text).slice(0, 240)}`);
    error.status = response.status;
    throw error;
  }

  const parts = parsed.json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    const finishReason = parsed.json?.candidates?.[0]?.finishReason;
    const promptFeedback = parsed.json?.promptFeedback ? JSON.stringify(parsed.json.promptFeedback) : '';
    const error = new Error(`Gemini 返回结构异常${finishReason ? ` (${finishReason})` : ''}：${redact(parsed.text || promptFeedback).slice(0, 240)}`);
    error.status = 502;
    throw error;
  }
  const content = parts.map((part) => part.text || '').join('\n').trim();
  if (!content) {
    const finishReason = parsed.json?.candidates?.[0]?.finishReason;
    const error = new Error(`Gemini 返回为空${finishReason ? ` (${finishReason})` : ''}`);
    error.status = 502;
    throw error;
  }
  return content;
}

async function handleModel(request, provider, cfg) {
  const body = await readJsonBody(request, cfg);
  const apiKey = requireText(body.apiKey, 'API Key');
  const model = requireText(body.model, '模型名称');
  const systemPrompt = requireText(body.systemPrompt, 'system prompt');
  const userPrompt = requireText(body.userPrompt, 'user prompt');
  const maxTokens = Number(body.maxTokens || 2000);

  if (provider === 'deepseek') {
    return callOpenAIStyle({ providerName: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  }
  if (provider === 'gemini') {
    return callGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  }
  if (provider === 'grok') {
    return callOpenAIStyle({ providerName: 'Grok', url: 'https://api.x.ai/v1/chat/completions', apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  }
  if (provider === 'minimax') {
    return callOpenAIStyle({ providerName: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1/chat/completions', apiKey, model, systemPrompt, userPrompt, maxTokens, jsonMode: true, cfg });
  }
  if (provider === 'zhipu') {
    return callOpenAIStyle({ providerName: 'Zhipu', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  }
  if (provider === 'openai-compatible') {
    return callOpenAIStyle({ providerName: 'OpenAI-compatible', url: assertPublicHttpsEndpoint(body.endpoint), apiKey, model, systemPrompt, userPrompt, maxTokens, cfg });
  }

  const error = new Error(`不支持的模型通道：${provider}`);
  error.status = 404;
  throw error;
}

async function handleEastmoney(request, cfg) {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get('url') || '';
  const u = new URL(target);
  if (u.protocol !== 'https:' || !u.hostname.endsWith('eastmoney.com')) {
    const error = new Error('仅支持东方财富 HTTPS 接口');
    error.status = 400;
    throw error;
  }
  const response = await fetchWithRetry(u.toString(), {
    headers: {
      Accept: 'application/json,text/plain,*/*',
      Referer: 'https://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 AI-Council/1.0',
    },
  }, cfg.marketTimeoutMs);
  return textResponse(
    response.ok ? 200 : response.status,
    await response.text(),
    response.headers.get('content-type')
  );
}

function normalizeYahooSymbol(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.^-]{1,16}$/.test(s)) {
    throw new Error(`非法 Yahoo symbol: ${symbol}`);
  }
  return s;
}

function normalizeYahooRows(payload) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const adjClose = result?.indicators?.adjclose?.[0]?.adjclose || [];
  return timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: Number(quote.open?.[i]),
      high: Number(quote.high?.[i]),
      low: Number(quote.low?.[i]),
      close: Number.isFinite(Number(adjClose[i])) ? Number(adjClose[i]) : Number(quote.close?.[i]),
      volume: Number(quote.volume?.[i]),
    }))
    .filter((row) => Number.isFinite(row.close) && Number.isFinite(row.volume));
}

async function handleYahooChart(request, cfg) {
  const reqUrl = new URL(request.url);
  const symbols = String(reqUrl.searchParams.get('symbols') || '')
    .split(',')
    .map(normalizeYahooSymbol)
    .filter(Boolean)
    .slice(0, 40);
  if (!symbols.length) {
    const error = new Error('缺少 symbols');
    error.status = 400;
    throw error;
  }
  const range = reqUrl.searchParams.get('range') || '1y';
  const interval = reqUrl.searchParams.get('interval') || '1d';
  if (!/^(6mo|8mo|1y|2y)$/.test(range)) throw new Error('Yahoo range 不支持');
  if (!/^(1d)$/.test(interval)) throw new Error('Yahoo interval 不支持');

  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=history&includeAdjustedClose=true`;
      const response = await fetchWithRetry(url, {
        headers: {
          Accept: 'application/json,text/plain,*/*',
          Referer: 'https://finance.yahoo.com/',
          'User-Agent': 'Mozilla/5.0 AI-Council/1.0',
        },
      }, cfg.marketTimeoutMs);
      const parsed = await parseJsonOrText(response);
      if (!response.ok) {
        return [symbol, { ok: false, error: `Yahoo ${response.status}: ${redact(parsed.text).slice(0, 120)}`, rows: [] }];
      }
      return [symbol, { ok: true, rows: normalizeYahooRows(parsed.json) }];
    } catch (error) {
      return [symbol, { ok: false, error: redact(error.message).slice(0, 160), rows: [] }];
    }
  }));

  return jsonResponse(200, {
    ok: true,
    provider: 'Yahoo Finance chart',
    symbols: Object.fromEntries(entries),
    generated_at: new Date().toISOString(),
  });
}

async function handleApi(request, env) {
  const cfg = runtime(env);
  const reqUrl = new URL(request.url);

  if (request.method === 'GET' && reqUrl.pathname === '/api/health') {
    return jsonResponse(200, {
      ok: true,
      service: 'AI Council Sites worker',
      auth: { token_required: Boolean(cfg.apiToken) },
      limits: {
        max_body_bytes: cfg.maxBodyBytes,
        model_rate_limit_per_window: cfg.modelRateLimitMax,
        market_rate_limit_per_window: cfg.marketRateLimitMax,
        window_ms: cfg.rateLimitWindowMs,
        model_timeout_ms: cfg.modelTimeoutMs,
        market_timeout_ms: cfg.marketTimeoutMs,
      },
      generated_at: new Date().toISOString(),
    });
  }

  if (request.method === 'GET' && reqUrl.pathname === '/api/market/eastmoney') {
    const limited = enforceRateLimit(request, 'market', cfg.marketRateLimitMax, cfg);
    if (limited) return limited;
    return handleEastmoney(request, cfg);
  }

  if (request.method === 'GET' && reqUrl.pathname === '/api/market/yahoo-chart') {
    const limited = enforceRateLimit(request, 'market', cfg.marketRateLimitMax, cfg);
    if (limited) return limited;
    return handleYahooChart(request, cfg);
  }

  const match = reqUrl.pathname.match(/^\/api\/model\/([a-z-]+)$/);
  if (request.method === 'POST' && match) {
    const auth = requireApiToken(request, cfg);
    if (!auth.ok) return jsonResponse(401, { error: auth.reason || '鉴权失败' });
    const limited = enforceRateLimit(request, 'model', cfg.modelRateLimitMax, cfg);
    if (limited) return limited;
    const content = await handleModel(request, match[1], cfg);
    return jsonResponse(200, { content });
  }

  return jsonResponse(404, { error: 'Not found' });
}

async function fetchStatic(request, env) {
  if (env?.ASSETS?.fetch) {
    return env.ASSETS.fetch(request);
  }
  return jsonResponse(404, { error: 'Static assets binding is unavailable' });
}

export default {
  async fetch(request, env) {
    try {
      const reqUrl = new URL(request.url);
      if (reqUrl.pathname.startsWith('/api/')) {
        return await handleApi(request, env);
      }
      return await fetchStatic(request, env);
    } catch (error) {
      const message = redact(error?.message || '请求失败');
      const status = Number.isInteger(error?.status)
        ? error.status
        : /超时|aborted/i.test(message)
          ? 504
          : 500;
      return jsonResponse(status, { error: message });
    }
  },
};
