export function getDefaultCouncil() {
  return {
    members: [
      {
        id: "deepseek",
        name: "DeepSeek 数理风控官",
        role: "因子归因、VaR、尾部场景、仓位约束、止损条件",
        provider: "deepseek",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        allowedTools: ["market_data", "fundamentals", "valuation_sanity", "web_research"]
      },
      {
        id: "risk",
        name: "Gemini 基本面官",
        role: "商业质量、财务质量、估值锚定、技术结构验证",
        provider: "google",
        model: process.env.GOOGLE_MODEL || "gemini-3.1-flash-lite-preview",
        allowedTools: ["risk_register", "position_sizing", "market_data", "web_research"]
      },
      {
        id: "contrarian",
        name: "Grok 逆向情绪官",
        role: "共识叙事、拥挤交易、隐含假设、可证伪反向观点",
        provider: "xai",
        model: process.env.XAI_MODEL || "grok-4-fast-non-reasoning",
        allowedTools: ["scenario_matrix", "risk_register", "fundamentals", "web_research"]
      },
      {
        id: "minimax",
        name: "MINIMAX 2.7 宏观中国官",
        role: "全球周期、中国政策、资产传导、事件窗口、跨证据整合",
        provider: "minimax",
        model: process.env.MINIMAX_MODEL || "minimaxai/minimax-m2.7",
        allowedTools: ["market_data", "fundamentals", "valuation_sanity", "web_research"]
      }
    ],
    chair: {
      provider: process.env.NVIDIA_API_KEY ? "nvidia" : "deepseek",
      model: process.env.NVIDIA_API_KEY
        ? process.env.NVIDIA_CHAIR_MODEL || "nvidia/llama-3.1-nemotron-ultra-253b-v1"
        : process.env.DEEPSEEK_MODEL || "deepseek-chat"
    }
  };
}

export function publicCouncilConfig(council = getDefaultCouncil()) {
  return {
    members: council.members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      provider: member.provider,
      model: member.model,
      configured: providerConfigured(member.provider),
      allowedTools: member.allowedTools || []
    })),
    chair: {
      provider: council.chair.provider,
      model: council.chair.model,
      configured: providerConfigured(council.chair.provider)
    }
  };
}

export function providerConfigured(provider) {
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (provider === "deepseek") return Boolean(process.env.DEEPSEEK_API_KEY);
  if (provider === "google") return Boolean(process.env.GOOGLE_API_KEY);
  if (provider === "xai") return Boolean(process.env.XAI_API_KEY);
  if (provider === "nvidia") return Boolean(process.env.NVIDIA_API_KEY);
  if (provider === "minimax") return Boolean(process.env.NVIDIA_API_KEY || process.env.MINIMAX_API_KEY);
  if (provider === "custom-openai") {
    return Boolean(process.env.CUSTOM_OPENAI_API_KEY && process.env.CUSTOM_OPENAI_BASE_URL);
  }
  return false;
}
