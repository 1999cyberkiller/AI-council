import { providerConfigured } from "./council-config.js";

const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 45000);

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

  const response = await fetchWithTimeout(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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

  const response = await fetchWithTimeout(url, {
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

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`模型请求超时：${Math.round(MODEL_TIMEOUT_MS / 1000)} 秒未返回。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function demoResponse({ provider, model, system, user }) {
  if (system.includes("最终备忘录整理员")) {
    return JSON.stringify({
      final_decision: "反对",
      analysis_summary: "四模型均完成独立判断。当前演示环境显示流程可用，但真实投资结论仍需接入完整实时数据和用户画像。",
      shared_views: [
        "需要把行情、财报和外部研究证据放在同一框架内核验。",
        "不能只依据单一模型或单一数据源做决定。"
      ],
      disagreements: [
        "四个模型对证据强度和执行时点的权重不同。",
        "部分模型更重视估值和回撤，部分模型更重视趋势和政策窗口。"
      ],
      operation_suggestions: [
        "先补齐关键证据，再决定是否执行。",
        "如果执行，应采用分阶段方式，并设置明确的风险触发条件。"
      ],
      investment_advice: "用户画像和实时证据不完整时，投资意向应收敛为反对或观察。",
      speculative_intent: "反对",
      investment_intent: "反对",
      risk_constraints: ["演示模式不应直接形成真实操作建议。"]
    });
  }

  const role = system.match(/角色：(.+)/)?.[1] || "分析模型";
  const question = user.match(/问题：\n([\s\S]*?)\n\n/)?.[1]?.trim() || user.slice(0, 180);
  const stanceMap = {
    openai: "agree",
    deepseek: "agree",
    anthropic: "disagree",
    google: "disagree",
    xai: "agree",
    nvidia: "disagree",
    minimax: "agree",
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

  const stance = stanceMap[provider] || "disagree";
  const probability = stance === "agree" ? 0.64 : 0.38;
  const decisionLabel = stance === "agree" ? "同意" : "不同意";
  const score = stance === "agree" ? 66 : 42;

  return JSON.stringify({
    stance,
    decision_label: decisionLabel,
    direction: stance === "agree" ? "bullish" : "bearish",
    probability,
    confidence: providerConfigured(provider) ? 60 : 32,
    score,
    time_horizon: "medium_term",
    investment_type: "allocation",
    suggested_action: stance === "agree" ? "watch" : "analysis_only",
    suggested_position_sizing: "watch_only",
    detailed_analysis: `${role}对“${question}”的演示判断：该决策取决于估值水平、流动性环境、盈利预期修正和下行不对称风险。当前尚未配置 API key，因此只能展示 MAGI SYSTEM 的分析结构。真实模型接入后，本段会变成该模型在 500 字以内的完整分析摘要。`,
    main_conclusions: [
      "当前尚未配置 API key，因此返回演示分析。",
      "在 .env 中填入模型配置后，可切换为真实模型分析。",
      "MAGI SYSTEM 的并行分析、投票和综合流程已生效。"
    ],
    thesis: `${role}对“${question}”的演示判断：该决策取决于估值水平、流动性环境、盈利预期修正和下行不对称风险。`,
    core_evidence: [
      "当前尚未配置 API key，因此返回演示分析。",
      "MAGI SYSTEM 的并行分析、投票和综合流程已生效。"
    ],
    opposing_evidence: [
      "演示分析不能替代真实行情和财报证据。",
      "用户画像缺失时不应直接给出强操作建议。"
    ],
    key_variables: [
      "估值是否被盈利修正支撑。",
      "流动性和风险偏好是否继续改善。"
    ],
    invalidation_conditions: [
      "财报质量低于预期或价格跌破关键风险边界。"
    ],
    key_evidence: [
      "当前尚未配置 API key，因此返回演示分析。",
      "在 .env 中填入模型配置后，可切换为真实模型分析。",
      "MAGI SYSTEM 的并行分析、投票和综合流程已生效。"
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
    risk_notes: [
      "用户画像不完整时，最终建议应保持观察或分析。",
      "真实仓位建议需要最大回撤、已有持仓和流动性约束。"
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
