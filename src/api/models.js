/* ──────────────────────────────────────────────────────────────────
   MODEL ADAPTERS · 统一走 VPS 同源代理

   v2 修复：
   - 错误对象带 .status 字段，不再用正则匹配错误正文判断可重试性
   - 网络层错误 → status=0；200 但 content 空 → status=502（视为可重试）
   - withRetry 只看 status，行为对所有 provider 一致
   ────────────────────────────────────────────────────────────────── */

export const DEFAULT_MODELS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    color: '#1976D2',
    custom: false,
    placeholder: 'sk-...',
    docsUrl: 'platform.deepseek.com',
    variants: [
      { id: 'deepseek-chat',     label: 'DeepSeek-Chat (V3)',     reasoning: false, maxTokens: 2000 },
      { id: 'deepseek-reasoner', label: 'DeepSeek-Reasoner (R1)', reasoning: true,  maxTokens: 6000 },
    ],
    defaultVariant: 'deepseek-chat',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    color: '#4285F4',
    custom: false,
    placeholder: 'AIza...',
    docsUrl: 'aistudio.google.com',
    variants: [
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', reasoning: false, maxTokens: 1600 },
      { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      reasoning: false, maxTokens: 2000 },
      { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        reasoning: false, maxTokens: 4000 },
    ],
    defaultVariant: 'gemini-2.5-flash-lite',
  },
  {
    id: 'grok',
    name: 'Grok',
    color: '#000000',
    custom: false,
    placeholder: 'xai-...',
    docsUrl: 'console.x.ai',
    variants: [
      { id: 'grok-3',      label: 'Grok-3',      reasoning: false, maxTokens: 2000 },
      { id: 'grok-3-mini', label: 'Grok-3 Mini', reasoning: false, maxTokens: 2000 },
      { id: 'grok-4',      label: 'Grok-4',      reasoning: false, maxTokens: 2000 },
    ],
    defaultVariant: 'grok-3',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    color: '#FF6B35',
    custom: false,
    placeholder: 'nvapi-...',
    docsUrl: 'build.nvidia.com',
    variants: [
      { id: 'minimaxai/minimax-m2.7', label: 'MiniMax-M2.7 (NVIDIA)', reasoning: true, maxTokens: 2200 },
      { id: 'minimaxai/minimax-m2',   label: 'MiniMax-M2 (NVIDIA)',   reasoning: true, maxTokens: 2200 },
    ],
    defaultVariant: 'minimaxai/minimax-m2.7',
  },
  {
    id: 'zhipu',
    name: 'Zhipu',
    color: '#4B6CB7',
    custom: false,
    placeholder: '智谱 API Key',
    docsUrl: 'open.bigmodel.cn',
    variants: [
      { id: 'glm-4-flash-250414', label: 'GLM-4-Flash', reasoning: false, maxTokens: 1600 },
      { id: 'glm-4-air-250414',   label: 'GLM-4-Air',   reasoning: false, maxTokens: 2000 },
    ],
    defaultVariant: 'glm-4-flash-250414',
  },
];

export function resolveVariant(model, selectedVariantId) {
  if (model.custom) {
    return {
      id: model.modelName,
      label: model.modelName,
      reasoning: false,
      maxTokens: model.maxTokens || 2000,
    };
  }
  const variants = model.variants || [];
  const found = variants.find((v) => v.id === selectedVariantId);
  return found || variants.find((v) => v.id === model.defaultVariant) || variants[0];
}

function providerForModel(model) {
  if (model.custom) return 'openai-compatible';
  if (['deepseek', 'gemini', 'grok', 'minimax', 'zhipu'].includes(model.id)) return model.id;
  return null;
}

async function readProxyPayload(response) {
  const text = await response.text();
  try {
    return { payload: JSON.parse(text), text };
  } catch {
    return { payload: null, text };
  }
}

/**
 * 构造带 .status 字段的错误对象，便于重试逻辑判断是否可重试。
 * 约定的 status 取值：
 *   0       网络层错误（DNS / 连接失败 / fetch reject）→ 可重试
 *   401/403 鉴权问题 → 不可重试
 *   400/404 参数/路由问题 → 不可重试
 *   408/429 超时/限流 → 可重试
 *   5xx     服务端错误 → 可重试
 *   502     代理返回了 200 但 content 为空 → 视作可重试（语义同 5xx）
 */
export function makeProxyError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function callProxy(model, apiKey, systemPrompt, userPrompt, variant, signal) {
  const provider = providerForModel(model);
  if (!provider) throw makeProxyError(`未知模型: ${model.id}`, 0);

  let response;
  try {
    response = await fetch(`/api/model/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        model: variant.id,
        endpoint: model.custom ? model.endpoint : undefined,
        systemPrompt,
        userPrompt,
        maxTokens: variant.maxTokens,
      }),
      signal,
    });
  } catch (networkErr) {
    if (networkErr?.name === 'AbortError') throw networkErr;
    throw makeProxyError(
      `${model.name} 网络错误: ${networkErr?.message || networkErr}`,
      0
    );
  }

  const { payload, text } = await readProxyPayload(response);
  if (!response.ok) {
    const msg = payload?.error || `${model.name} ${response.status}: ${text.slice(0, 180)}`;
    throw makeProxyError(msg, response.status);
  }
  if (!payload?.content) {
    throw makeProxyError(
      payload?.error || `${model.name} 代理返回正文为空`,
      502
    );
  }
  return payload.content;
}

/**
 * 严格基于 status code 判定是否可重试，不再依赖错误文本正则。
 * 这样 "got 400 results back" 之类的错误文本不会被误判成 HTTP 400。
 */
export function isRetryable(error) {
  if (error?.name === 'AbortError') return false;
  const status = error?.status;
  if (typeof status !== 'number') return false;  // 未知错误，保守不重试
  if (status === 0) return true;                  // 网络层
  if (status === 408) return true;                // request timeout
  if (status === 429) return true;                // rate limited
  if (status >= 500 && status < 600) return true; // 服务端错误（含 502 空响应）
  return false;
}

export async function withRetry(fn, maxAttempts = 2) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e?.name === 'AbortError') throw e;
      if (!isRetryable(e)) throw e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

export async function callModel(model, apiKey, systemPrompt, userPrompt, selectedVariantId, signal) {
  if (!apiKey || !apiKey.trim()) {
    throw makeProxyError(`未配置 ${model.name} 的 API Key`, 401);
  }
  const variant = resolveVariant(model, selectedVariantId);
  if (!variant) {
    throw makeProxyError(`未找到 ${model.name} 的可用变体`, 0);
  }
  return withRetry(
    () => callProxy(model, apiKey, systemPrompt, userPrompt, variant, signal),
    2
  );
}
