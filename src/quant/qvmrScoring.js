import { QVMR_CONFIG } from "./qvmrConfig.js";

function asBoolean(value) {
  return value === true;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSignals(signals = {}) {
  const normalized = {};

  for (const section of ["market", "industry", "momentum", "volume", "quality"]) {
    for (const rule of QVMR_CONFIG[section].rules) {
      normalized[rule.key] = asBoolean(signals[rule.key]);
    }
  }

  for (const rule of QVMR_CONFIG.riskPenalty) {
    normalized[rule.key] = asBoolean(signals[rule.key]);
  }

  return normalized;
}

function scoreRules(rules, signals) {
  const matched = [];
  const missed = [];
  let score = 0;

  for (const rule of rules) {
    if (signals[rule.key]) {
      score += rule.points;
      matched.push(rule);
    } else {
      missed.push(rule);
    }
  }

  return { score, matched, missed };
}

function scorePenalty(rules, signals) {
  const triggered = [];
  let score = 0;

  for (const rule of rules) {
    if (signals[rule.key]) {
      score += rule.points;
      triggered.push(rule);
    }
  }

  return { score, triggered };
}

function getAction(score, signals) {
  if (signals.earningsWarningOrGuidanceCut) return "EXIT";
  if (signals.priceBelowMA60) return "EXIT";
  if (score >= QVMR_CONFIG.thresholds.strongBuy) return "STRONG_BUY";
  if (score >= QVMR_CONFIG.thresholds.buy) return "BUY";
  if (score >= QVMR_CONFIG.thresholds.watch) return "WATCH";
  if (score >= QVMR_CONFIG.thresholds.exit) return "HOLD_OR_REDUCE";
  return "EXIT";
}

function getPosition(score, marketScore) {
  if (marketScore < 10) return 0;
  if (score >= 90) return 0.1;
  if (score >= 85) return 0.08;
  if (score >= 80) return 0.05;
  return 0;
}

function getPortfolioExposure(marketScore) {
  if (marketScore < 10) return { min: 0, max: 0.2 };
  if (marketScore < 15) return { min: 0.3, max: 0.5 };
  if (marketScore < 18) return { min: 0.5, max: 0.7 };
  return { min: 0.7, max: 0.9 };
}

function buildSection(name, rules, signals) {
  const result = scoreRules(rules, signals);
  return {
    name,
    score: result.score,
    matched: result.matched.map((rule) => ({
      key: rule.key,
      label: rule.label,
      points: rule.points,
    })),
    missed: result.missed.map((rule) => ({
      key: rule.key,
      label: rule.label,
      points: rule.points,
    })),
  };
}

export function calculateQVMR(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("calculateQVMR(input) requires an object input.");
  }

  const signals = normalizeSignals(input.signals);
  const market = buildSection("market", QVMR_CONFIG.market.rules, signals);
  const industry = buildSection("industry", QVMR_CONFIG.industry.rules, signals);
  const momentum = buildSection("momentum", QVMR_CONFIG.momentum.rules, signals);
  const volume = buildSection("volume", QVMR_CONFIG.volume.rules, signals);
  const quality = buildSection("quality", QVMR_CONFIG.quality.rules, signals);
  const penaltyResult = scorePenalty(QVMR_CONFIG.riskPenalty, signals);

  const rawScore =
    market.score +
    industry.score +
    momentum.score +
    volume.score +
    quality.score -
    penaltyResult.score;

  const score = clamp(rawScore, 0, 100);
  const action = getAction(score, signals);

  const hardRules = {
    allowNewPosition: market.score >= 10 && score >= 80 && !signals.priceBelowMA60 && !signals.earningsWarningOrGuidanceCut,
    mustExit: score < 60 || signals.priceBelowMA60 || signals.earningsWarningOrGuidanceCut,
    blockReason: [],
  };

  if (market.score < 10) hardRules.blockReason.push("市场环境低于 10 分");
  if (score < 80) hardRules.blockReason.push("总分低于新开仓阈值");
  if (signals.priceBelowMA60) hardRules.blockReason.push("股价跌破 MA60");
  if (signals.earningsWarningOrGuidanceCut) hardRules.blockReason.push("业绩预警或盈利下修");

  return {
    stockCode: input.stockCode ?? null,
    stockName: input.stockName ?? null,
    tradeDate: input.tradeDate ?? null,
    score,
    rawScore,
    action,
    suggestedPosition: getPosition(score, market.score),
    suggestedPortfolioExposure: getPortfolioExposure(market.score),
    breakdown: {
      marketScore: market.score,
      industryScore: industry.score,
      momentumScore: momentum.score,
      volumeScore: volume.score,
      qualityScore: quality.score,
      penalty: penaltyResult.score,
    },
    sections: {
      market,
      industry,
      momentum,
      volume,
      quality,
      riskPenalty: {
        name: "riskPenalty",
        score: penaltyResult.score,
        triggered: penaltyResult.triggered.map((rule) => ({
          key: rule.key,
          label: rule.label,
          points: rule.points,
        })),
      },
    },
    hardRules,
    normalizedSignals: signals,
  };
}

export function explainQVMR(qvmrResult) {
  const activeRisks = qvmrResult.sections.riskPenalty.triggered
    .map((risk) => risk.label)
    .join("、");

  return {
    summary: `${qvmrResult.stockName ?? qvmrResult.stockCode ?? "标的"} QVMR 得分 ${qvmrResult.score}，动作 ${qvmrResult.action}`,
    strengths: [
      ...qvmrResult.sections.market.matched,
      ...qvmrResult.sections.industry.matched,
      ...qvmrResult.sections.momentum.matched,
      ...qvmrResult.sections.volume.matched,
      ...qvmrResult.sections.quality.matched,
    ].map((item) => item.label),
    risks: activeRisks ? activeRisks.split("、") : [],
    hardRules: qvmrResult.hardRules,
  };
}
