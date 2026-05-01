import { providerConfigured } from "./council-config.js";

export async function askModel({ provider, model, system, user, temperature = 0.2 }) {
  if (!providerConfigured(provider)) {
    return demoResponse({ provider, model, system, user });
  }

  if (provider === "openai") {
    return askOpenAI({
      baseUrl: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY,
      model,
      system,
      user,
      temperature
    });
  }

  if (provider === "xai") {
    return askOpenAI({
      baseUrl: "https://api.x.ai/v1",
      apiKey: process.env.XAI_API_KEY,
      model,
      system,
      user,
      temperature,
      responseFormat: false
    });
  }

  if (provider === "deepseek") {
    return askOpenAI({
      baseUrl: "https://api.deepseek.com",
      apiKey: process.env.DEEPSEEK_API_KEY,
      model,
      system,
      user,
      temperature
    });
  }

  if (provider === "minimax") {
    return askOpenAI({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY || process.env.MINIMAX_API_KEY,
      model,
      system,
      user,
      temperature,
      responseFormat: false
    });
  }

  if (provider === "nvidia") {
    return askOpenAI({
      baseUrl: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY,
      model,
      system,
      user,
      temperature,
      responseFormat: false
    });
  }

  if (provider === "custom-openai") {
    return askOpenAI({
      baseUrl: process.env.CUSTOM_OPENAI_BASE_URL,
      apiKey: process.env.CUSTOM_OPENAI_API_KEY,
      model: model || process.env.CUSTOM_OPENAI_MODEL,
      system,
      user,
      temperature
    });
  }

  if (provider === "anthropic") {
    return askAnthropic({ model, system, user, temperature });
  }

  if (provider === "google") {
    return askGemini({ model, system, user, temperature });
  }

  throw new Error(`暂不支持该 provider：${provider}`);
}

async function askOpenAI({
  baseUrl,
  apiKey,
  model,
  system,
  user,
  temperature,
  responseFormat = true
}) {
  const body = {
    model,
    temperature,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };

  if (responseFormat) {
    body.response_format = { type: "json_object" };
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  const data = await readJsonOrThrow(response);
  return data.choices?.[0]?.message?.content || "";
}

async function askAnthropic({ model, system, user, temperature }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: 1400,
      system,
      messages: [{ role: "user", content: user }]
    })
  });

  const data = await readJsonOrThrow(response);
  return data.content?.map((part) => part.text || "").join("\n") || "";
}

async function askGemini({ model, system, user, temperature }) {
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
  );
  url.searchParams.set("key", process.env.GOOGLE_API_KEY);

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature,
        responseMimeType: "application/json"
      },
      systemInstruction: {
        parts: [{ text: system }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: user }]
        }
      ]
    })
  });

  const data = await readJsonOrThrow(response);
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
}

async function readJsonOrThrow(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data.error?.message || data.message || text || response.statusText;
    throw new Error(message);
  }

  return data;
}

function demoResponse({ provider, model, system, user }) {
  const role = system.match(/角色：(.+)/)?.[1] || "议会成员";
  const question = user.match(/问题：\n([\s\S]*?)\n\n/)?.[1]?.trim() || user.slice(0, 180);
  const stanceMap = {
    openai: "agree",
    deepseek: "agree_with_conditions",
    anthropic: "agree_with_conditions",
    google: "disagree",
    xai: "agree_with_conditions",
    nvidia: "agree_with_conditions",
    minimax: "agree_with_conditions",
    "custom-openai": "agree"
  };
  const directionMap = {
    openai: "温和建设性",
    deepseek: "重视估值和证据约束",
    anthropic: "选择性配置，重视估值约束",
    google: "证据不足前保持防御",
    xai: "机会导向，但保留怀疑",
    nvidia: "中立整合，保留分歧",
    minimax: "跨证据整合后有条件执行"
  };

  const stance = stanceMap[provider] || "agree_with_conditions";
  const probability = stance === "agree" ? 0.64 : stance === "disagree" ? 0.38 : 0.53;

  return JSON.stringify({
    stance,
    probability,
    direction: directionMap[provider] || "中性",
    confidence: providerConfigured(provider) ? 0.6 : 0.32,
    time_horizon: "3 至 12 个月",
    thesis: `${role}对“${question}”的演示判断：该决策取决于估值水平、流动性环境、盈利预期修正和下行不对称风险。`,
    key_evidence: [
      "当前尚未配置 API key，因此返回演示分析。",
      "在 .env 中填入模型配置后，可切换为真实模型分析。",
      "议会并行分析、投票和综合流程已生效。"
    ],
    key_assumptions: [
      "盈利预期没有出现连续下修。",
      "流动性环境没有快速收紧。",
      "估值扩张仍能被业绩增长解释。"
    ],
    risks: [
      "多模型共识可能过度依赖同一组公开信息。",
      "当前 MVP 的市场数据工具仍为本地规则，需要接入实时数据源后才能提高证据质量。"
    ],
    what_would_change_my_mind: [
      "财报显示收入增速或利润率显著偏离预期。",
      "核心持仓拥挤度快速上升并伴随放量下跌。"
    ],
    next_checks: [
      "接入实时价格、估值和基本面数据。",
      "加入带来源引用的研究检索能力。"
    ],
    minority_signal: "如果其他席位过度关注短期动量，本席位会保留估值和尾部风险约束。",
    model: model || "演示模型"
  });
}
