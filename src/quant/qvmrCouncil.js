import { calculateQVMR } from "./qvmrScoring.js";

export const COUNCIL_ROLES = Object.freeze([
  Object.freeze({
    id: "trend_pm",
    name: "Trend PM",
    focus: "趋势、动量、市场宽度",
    voteBias: "follow_strength",
    systemInstruction: "你关注趋势延续和相对强弱。不得绕过 QVMR hardRules。",
  }),
  Object.freeze({
    id: "risk_officer",
    name: "Risk Officer",
    focus: "回撤、业绩雷、解禁、融资拥挤",
    voteBias: "capital_preservation",
    systemInstruction: "你优先保护本金。发现硬风险时必须投 EXIT 或 REDUCE。",
  }),
  Object.freeze({
    id: "fundamental_analyst",
    name: "Fundamental Analyst",
    focus: "ROE、现金流、利润质量、估值分位",
    voteBias: "quality_first",
    systemInstruction: "你关注基本面质量。不得虚构财务数据。",
  }),
  Object.freeze({
    id: "liquidity_trader",
    name: "Liquidity Trader",
    focus: "成交额、换手、VWAP、放量缩量结构",
    voteBias: "execution_quality",
    systemInstruction: "你关注交易执行质量和成交结构。不得把高位爆量滞涨解释为利好。",
  }),
]);

export function buildCouncilInput(stockInput, options = {}) {
  const qvmr = options.qvmrResult ?? calculateQVMR(stockInput);

  return {
    instruction: [
      "你是 AI-council 成员。",
      "你必须基于 QVMR 评分结果投票。",
      "不得虚构行情、财报或资金数据。",
      "不得绕过 hardRules。",
      "hardRules.mustExit 为 true 时只能投 EXIT。",
      "hardRules.allowNewPosition 为 false 时不能投 BUY 或 STRONG_BUY。",
      "只输出 JSON。",
    ].join("\n"),
    qvmr,
    allowedVotes: ["STRONG_BUY", "BUY", "WATCH", "HOLD", "REDUCE", "EXIT"],
    requiredOutputSchema: {
      vote: "STRONG_BUY | BUY | WATCH | HOLD | REDUCE | EXIT",
      confidence: "0-100",
      reason: "不超过 80 个中文字符",
      mainRisk: "不超过 50 个中文字符",
    },
  };
}

function normalizeVote(vote) {
  if (!vote || typeof vote !== "object") {
    return {
      agentId: "unknown",
      vote: "WATCH",
      confidence: 0,
      reason: "无效投票，按 WATCH 处理",
      mainRisk: "输出格式无效",
    };
  }

  const allowed = new Set(["STRONG_BUY", "BUY", "WATCH", "HOLD", "REDUCE", "EXIT"]);
  const normalizedVote = allowed.has(vote.vote) ? vote.vote : "WATCH";

  return {
    agentId: vote.agentId ?? vote.roleId ?? "unknown",
    vote: normalizedVote,
    confidence: Math.max(0, Math.min(100, Number(vote.confidence ?? 0))),
    reason: String(vote.reason ?? "").slice(0, 120),
    mainRisk: String(vote.mainRisk ?? "").slice(0, 80),
  };
}

export function aggregateCouncilVotes(qvmrResult, votes = []) {
  const normalizedVotes = votes.map(normalizeVote);

  if (qvmrResult.hardRules.mustExit) {
    return {
      finalAction: "EXIT",
      reason: "触发 QVMR 硬性退出规则",
      qvmrResult,
      votes: normalizedVotes,
      voteScore: null,
    };
  }

  if (!qvmrResult.hardRules.allowNewPosition) {
    return {
      finalAction: qvmrResult.score >= 70 ? "WATCH" : "NO_TRADE",
      reason: "未满足新开仓硬条件",
      qvmrResult,
      votes: normalizedVotes,
      voteScore: null,
    };
  }

  const scoreMap = {
    STRONG_BUY: 3,
    BUY: 2,
    WATCH: 1,
    HOLD: 1,
    REDUCE: -1,
    EXIT: -2,
  };

  const voteScore = normalizedVotes.reduce((sum, item) => {
    const weight = item.confidence / 100;
    return sum + (scoreMap[item.vote] ?? 0) * weight;
  }, 0);

  let finalAction = "WATCH";

  if (qvmrResult.score >= 90 && voteScore >= 3) finalAction = "STRONG_BUY";
  else if (qvmrResult.score >= 80 && voteScore >= 2) finalAction = "BUY";
  else if (voteScore <= -2) finalAction = "REDUCE";

  return {
    finalAction,
    reason: "QVMR 硬规则通过，AI-council 加权投票完成",
    qvmrResult,
    voteScore: Number(voteScore.toFixed(2)),
    votes: normalizedVotes,
  };
}

export function buildAgentPrompt(role, councilInput) {
  return [
    role.systemInstruction,
    "",
    "你的关注点：",
    role.focus,
    "",
    "输入：",
    JSON.stringify(councilInput, null, 2),
    "",
    "输出必须是 JSON，字段为 vote、confidence、reason、mainRisk。",
  ].join("\n");
}
