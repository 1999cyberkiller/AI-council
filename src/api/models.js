/* ──────────────────────────────────────────────────────────────────
   MODEL ADAPTERS · 各 LLM 调用
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
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', reasoning: false, maxTokens: 1200 },
      { id: 'gemini-2.5-flash',      label: 'Gemini 2.5 Flash',      reasoning: false, maxTokens: 1400 },
      { id: 'gemini-2.5-pro',        label: 'Gemini 2.5 Pro',        reasoning: false, maxTokens: 2200 },
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
      { id: 'minimaxai/minimax-m2.7', label: 'MiniMax-M2.7 (NVIDIA)', reasoning: true, maxTokens: 6000 },
      { id: 'minimaxai/minimax-m2',   label: 'MiniMax-M2 (NVIDIA)',   reasoning: true, maxTokens: 6000 },
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

async function callModelProxy(provider, payload, signal) {
  const { apiKey, model, systemPrompt, userPrompt, maxTokens, endpoint } = payload;
  let reachedProxy = false;
  try {
    const r = await fetch(`/api/model/${provider}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey, model, systemPrompt, userPrompt, maxTokens, endpoint }),
      signal,
    });

    const isDispatchProxy = r.headers.get('x-dispatch-proxy') === '1';
    if (!isDispatchProxy) return null;
    reachedProxy = true;

    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `${provider} proxy ${r.status}`);
    if (!d.content) throw new Error(`${provider} proxy 返回结构异常`);
    return d.content;
  } catch (e) {
    if (reachedProxy) throw e;
    return null;
  }
}

async function callDeepSeek(apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('deepseek', {
    apiKey, model: variant.id, systemPrompt, userPrompt, maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variant.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: variant.maxTokens,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  if (!d.choices?.[0]) throw new Error('DeepSeek 返回结构异常');
  return d.choices[0].message.content;
}

function geminiGenerationConfig(variant) {
  const config = {
    temperature: 0.45,
    maxOutputTokens: variant.maxTokens,
    responseMimeType: 'application/json',
  };
  if (/flash/i.test(variant.id)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

async function callGemini(apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('gemini', {
    apiKey, model: variant.id, systemPrompt, userPrompt, maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${variant.id}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: geminiGenerationConfig(variant),
      }),
      signal,
    }
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  if (!d.candidates?.[0]?.content?.parts) throw new Error('Gemini 返回结构异常');
  return d.candidates[0].content.parts.map((p) => p.text).join('\n');
}

async function callGrok(apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('grok', {
    apiKey, model: variant.id, systemPrompt, userPrompt, maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variant.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: variant.maxTokens,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`Grok ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  if (!d.choices?.[0]) throw new Error('Grok 返回结构异常');
  return d.choices[0].message.content;
}

async function callMinimax(apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('minimax', {
    apiKey, model: variant.id, systemPrompt, userPrompt, maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variant.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: variant.maxTokens,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`NVIDIA NIM ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  if (!d.choices?.[0]) throw new Error(`NVIDIA NIM 返回结构异常：${JSON.stringify(d).slice(0, 200)}`);
  return d.choices[0].message.content;
}

async function callZhipu(apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('zhipu', {
    apiKey, model: variant.id, systemPrompt, userPrompt, maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variant.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.45,
      max_tokens: variant.maxTokens,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`Zhipu ${r.status}: ${(await r.text()).slice(0, 180)}`);
  const d = await r.json();
  if (!d.choices?.[0]) throw new Error('Zhipu 返回结构异常');
  return d.choices[0].message.content;
}

async function callOpenAICompat(model, apiKey, systemPrompt, userPrompt, variant, signal) {
  const proxied = await callModelProxy('openai-compatible', {
    apiKey,
    endpoint: model.endpoint,
    model: variant.id,
    systemPrompt,
    userPrompt,
    maxTokens: variant.maxTokens,
  }, signal);
  if (proxied) return proxied;

  const r = await fetch(model.endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variant.id,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: variant.maxTokens,
    }),
    signal,
  });
  if (!r.ok) throw new Error(`${model.name} ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const d = await r.json();
  if (!d.choices?.[0]) throw new Error(`${model.name} 返回结构异常`);
  return d.choices[0].message.content;
}

// 重试包装：网络/5xx/429 自动重试 1 次，4xx 不重试
async function withRetry(fn, maxAttempts = 2) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') throw e; // 主动取消不重试
      const msg = String(e.message || '');
      if (/\b(401|403|404)\b/.test(msg)) throw e;
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

  const fn = () => {
    if (model.custom) return callOpenAICompat(model, apiKey, systemPrompt, userPrompt, variant, signal);
    switch (model.id) {
      case 'deepseek': return callDeepSeek(apiKey, systemPrompt, userPrompt, variant, signal);
      case 'gemini':   return callGemini(apiKey, systemPrompt, userPrompt, variant, signal);
      case 'grok':     return callGrok(apiKey, systemPrompt, userPrompt, variant, signal);
      case 'minimax':  return callMinimax(apiKey, systemPrompt, userPrompt, variant, signal);
      case 'zhipu':    return callZhipu(apiKey, systemPrompt, userPrompt, variant, signal);
      default: throw new Error(`未知模型: ${model.id}`);
    }
  };
  return withRetry(fn, 2);
}
