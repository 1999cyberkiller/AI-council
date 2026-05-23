/* ──────────────────────────────────────────────────────────────────
   MODEL ADAPTERS · 统一走 VPS 同源代理
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
    const payload = JSON.parse(text);
    return { payload, text };
  } catch {
    return { payload: null, text };
  }
}

async function callProxy(model, apiKey, systemPrompt, userPrompt, variant, signal) {
  const provider = providerForModel(model);
  if (!provider) throw new Error(`未知模型: ${model.id}`);

  const response = await fetch(`/api/model/${provider}`, {
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

  const { payload, text } = await readProxyPayload(response);
  if (!response.ok) {
    throw new Error(payload?.error || `${model.name} ${response.status}: ${text.slice(0, 180)}`);
  }
  if (!payload?.content) {
    throw new Error(payload?.error || `${model.name} 代理返回正文为空`);
  }
  return payload.content;
}

// 网络、429、5xx 自动重试一次；400/401/403/404 直接返回真实错误。
async function withRetry(fn, maxAttempts = 2) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') throw e;
      const msg = String(e.message || '');
      if (/\b(400|401|403|404)\b/.test(msg)) throw e;
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, i)));
      }
    }
  }
  throw lastErr;
}

export async function callModel(model, apiKey, systemPrompt, userPrompt, selectedVariantId, signal) {
  if (!apiKey || !apiKey.trim()) throw new Error(`未配置 ${model.name} 的 API Key`);
  const variant = resolveVariant(model, selectedVariantId);
  if (!variant) throw new Error(`未找到 ${model.name} 的可用变体`);
  return withRetry(() => callProxy(model, apiKey, systemPrompt, userPrompt, variant, signal), 2);
}
