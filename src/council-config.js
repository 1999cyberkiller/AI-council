export function getDefaultCouncil() {
  return {
    members: [
      {
        id: "deepseek",
        name: "DeepSeek",
        role: "因子归因、VaR、尾部场景、仓位约束、止损条件",
        provider: "deepseek",
        model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
        avatarUrl: "https://www.deepseek.com/favicon.ico",
        allowedTools: ["market_data", "fundamentals", "valuation_sanity", "web_research"]
      },
      {
        id: "risk",
        name: "Gemini",
        role: "商业质量、财务质量、估值锚定、技术结构验证",
        provider: "google",
        model: process.env.GOOGLE_MODEL || "gemini-3.1-flash-lite-preview",
        avatarUrl: "https://www.google.com/s2/favicons?domain=gemini.google.com&sz=128",
        allowedTools: ["risk_register", "position_sizing", "market_data", "web_research"]
      },
      {
        id: "contrarian",
        name: "Grok",
        role: "共识叙事、拥挤交易、隐含假设、可证伪反向观点",
        provider: "xai",
        model: process.env.XAI_MODEL || "grok-4-fast-non-reasoning",
        avatarUrl: "https://grok.com/images/favicon-light.png",
        allowedTools: ["scenario_matrix", "risk_register", "fundamentals", "web_research"]
      },
      {
        id: "minimax",
        name: "MINIMAX 2.7",
        role: "全球周期、中国政策、资产传导、事件窗口、跨证据整合",
        provider: "minimax",
        model: process.env.MINIMAX_MODEL || "minimaxai/minimax-m2.7",
        avatarUrl: "https://www.minimaxi.com/favicon.ico",
        allowedTools: ["market_data", "fundamentals", "valuation_sanity", "web_research"]
      }
    ]
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
      avatarUrl: member.avatarUrl,
      configured: providerConfigured(member.provider),
      allowedTools: member.allowedTools || []
    }))
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
