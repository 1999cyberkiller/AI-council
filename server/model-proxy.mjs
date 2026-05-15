import http from 'node:http';

const PORT = Number(process.env.DISPATCH_PROXY_PORT || 8787);
const HOST = process.env.DISPATCH_PROXY_HOST || '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const MODEL_TIMEOUT_MS = Number(process.env.DISPATCH_MODEL_TIMEOUT_MS || 180000);
const MARKET_TIMEOUT_MS = Number(process.env.DISPATCH_MARKET_TIMEOUT_MS || 12000);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Dispatch-Proxy': '1',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function redact(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    .replace(/AIza[A-Za-z0-9_-]{8,}/g, 'AIza***')
    .replace(/xai-[A-Za-z0-9_-]{8,}/g, 'xai-***')
    .replace(/nvapi-[A-Za-z0-9_-]{8,}/g, 'nvapi-***')
    .replace(/[a-f0-9]{32}\.[A-Za-z0-9_-]{8,}/gi, 'zhipu-***');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求 JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
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
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new Error('自定义模型端点不允许指向内网地址');
  }
  return u.toString();
}

async function callOpenAIStyle({ providerName, url, apiKey, model, systemPrompt, userPrompt, maxTokens }) {
  const response = await fetchWithRetry(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: maxTokens || 2000,
    }),
  }, MODEL_TIMEOUT_MS);

  const parsed = await parseJsonOrText(response);
  if (!response.ok) {
    throw new Error(`${providerName} ${response.status}: ${redact(parsed.text).slice(0, 240)}`);
  }

  const content = parsed.json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`${providerName} 返回结构异常：${redact(parsed.text).slice(0, 240)}`);
  }
  return content;
}

function geminiGenerationConfig(model, maxTokens) {
  const config = {
    temperature: 0.45,
    maxOutputTokens: maxTokens || 1400,
  };
  if (/flash/i.test(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

async function postGemini({ apiKey, model, systemPrompt, userPrompt, maxTokens, useThinkingConfig = true }) {
  const generationConfig = geminiGenerationConfig(model, maxTokens);
  if (!useThinkingConfig) delete generationConfig.thinkingConfig;

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

  throw new Error(`不支持的模型通道：${provider}`);
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
    'X-Dispatch-Proxy': '1',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/market/eastmoney')) {
      await handleEastmoney(req, res);
      return;
    }

    const match = req.url?.match(/^\/api\/model\/([a-z-]+)$/);
    if (req.method === 'POST' && match) {
      const content = await handleModel(req, res, match[1]);
      sendJson(res, 200, { content });
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    const message = redact(error.message || '模型代理失败');
    const statusMatch = message.match(/\b(400|401|403|404|429)\b/);
    const status = statusMatch ? Number(statusMatch[1]) : /超时|aborted/i.test(message) ? 504 : 500;
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`dispatch model proxy listening on http://${HOST}:${PORT}`);
});
