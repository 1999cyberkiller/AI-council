import { getDefaultCouncil } from "./council-config.js";
import {
  binaryVoteFromAction,
  buildMemberSystemPrompt,
  buildSynthesisSystemPrompt,
  committeePolicy,
  getCommitteeMemberPolicy
} from "./committee-policy.js";
import { runFinanceTools } from "./finance-tools.js";
import { askModel } from "./model-adapters.js";

export async function analyzeWithCouncil({ question, context = "", selectedMembers = [] }) {
  const council = getDefaultCouncil();
  const members = selectedMembers.length
    ? council.members.filter((member) => selectedMembers.includes(member.id))
    : council.members;

  if (!question || !question.trim()) {
    throw new Error("请输入分析问题。");
  }

  const enabledTools = unique(members.flatMap((member) => member.allowedTools || []));
  const toolOutputs = await collectToolOutputs({ question, context, enabledTools });

  const memberResults = await Promise.all(
    members.map(async (member) => {
      const startedAt = Date.now();
      const visibleToolOutputs = memberToolOutputs(member, toolOutputs);
      const toolText = JSON.stringify(visibleToolOutputs, null, 2);
      try {
        const raw = await askModel({
          provider: member.provider,
          model: member.model,
          system: buildMemberSystemPrompt(member),
          user: buildMemberPrompt({ question, context, toolText, member })
        });

        const parsed = parseModelJson(raw);
        return {
          id: member.id,
          name: member.name,
          provider: member.provider,
          model: member.model,
          elapsed_ms: Date.now() - startedAt,
          ok: true,
          tools_used: summarizeTools(visibleToolOutputs),
          ...normalizeVote(parsed, member.model)
        };
      } catch (error) {
        return {
          id: member.id,
          name: member.name,
          provider: member.provider,
          model: member.model,
          elapsed_ms: Date.now() - startedAt,
          ok: false,
          tools_used: summarizeTools(visibleToolOutputs),
          stance: "disagree",
          decision_label: "不同意",
          probability: 0.5,
          confidence: 0,
          direction: "无法形成判断",
          score: 0,
          suggested_action: "analysis_only",
          suggested_position_sizing: "none",
          detailed_analysis: limitText(error.message, 500),
          thesis: limitText(error.message, 500),
          main_conclusions: ["模型调用失败。"],
          key_evidence: [],
          core_evidence: [],
          opposing_evidence: [],
          key_assumptions: [],
          risks: ["模型调用失败。"],
          risk_notes: ["模型调用失败。"],
          what_would_change_my_mind: [],
          invalidation_conditions: ["模型恢复前不应依赖该席位结论。"],
          next_checks: ["检查 provider API key、模型名称和网络连接。"]
        };
      }
    })
  );

  const aggregate = aggregateVotes(memberResults);
  const decision = await synthesizeDecision({ results: memberResults, aggregate, question, context });

  return {
    question,
    context,
    generated_at: new Date().toISOString(),
    tools: toolOutputs,
    members: memberResults,
    aggregate,
    decision
  };
}

async function collectToolOutputs({ question, context, enabledTools }) {
  try {
    return await runFinanceTools({ question, context, enabledTools });
  } catch (error) {
    return [
      {
        id: "tool_runtime_error",
        name: "资源调用",
        status: "error",
        source: "local",
        result: {
          error: error.message || "资源调用失败。"
        }
      }
    ];
  }
}

function buildMemberPrompt({ question, context, toolText, member }) {
  return `问题：
${question}

用户背景：
${context || "无"}

可用金融工具输出：
${toolText}

分析模型：
${member.name}

工具权限：
${(member.allowedTools || []).join(", ") || "无"}

请给出独立判断。你只能使用上方列出的工具输出。不要复述工具输出，只在有价值时引用。
最终必须投 agree 或 disagree。即使建议 watch 或 analysis_only，也要把票映射成 agree 或 disagree。`;
}

function memberToolOutputs(member, toolOutputs) {
  const allowed = new Set(member.allowedTools || []);
  return toolOutputs.filter((tool) => allowed.has(tool.id));
}

function summarizeTools(toolOutputs) {
  return toolOutputs.map((tool) => ({
    id: tool.id,
    name: tool.name,
    status: tool.status || "ok",
    source: tool.source || "local"
  }));
}

function parseModelJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

function normalizeVote(parsed, fallbackModel) {
  const confidenceScore = normalizePercentNumber(parsed.confidence, 50);
  const score = clampNumber(parsed.score, 0, 100, confidenceScore);
  const stance = normalizeStance(parsed.stance, parsed.suggested_action, score, parsed.direction);
  const analysis = limitText(parsed.detailed_analysis || parsed.thesis || "模型未返回分析。", 500);
  return {
    stance,
    decision_label: normalizeDecisionLabel(parsed.decision_label, stance),
    probability: stanceProbability(stance),
    direction: String(parsed.direction || "中性"),
    confidence: confidenceScore / 100,
    score,
    time_horizon: String(parsed.time_horizon || "未说明"),
    investment_type: String(parsed.investment_type || parsed.investmentType || "allocation"),
    suggested_action: String(parsed.suggested_action || parsed.suggestedAction || "watch"),
    suggested_position_sizing: String(parsed.suggested_position_sizing || parsed.suggestedPositionSizing || "watch_only"),
    detailed_analysis: analysis,
    thesis: analysis,
    main_conclusions: normalizeList(parsed.main_conclusions || parsed.key_evidence).slice(0, 4),
    key_evidence: normalizeList(parsed.key_evidence),
    core_evidence: normalizeList(parsed.core_evidence || parsed.coreEvidence || parsed.key_evidence).slice(0, 3),
    opposing_evidence: normalizeList(parsed.opposing_evidence || parsed.opposingEvidence).slice(0, 3),
    key_variables: normalizeList(parsed.key_variables || parsed.keyVariables).slice(0, 4),
    key_assumptions: [],
    risks: normalizeList(parsed.risks || parsed.risk_notes || parsed.riskNotes),
    risk_notes: normalizeList(parsed.risk_notes || parsed.riskNotes || parsed.risks),
    what_would_change_my_mind: [],
    invalidation_conditions: normalizeList(parsed.invalidation_conditions || parsed.invalidationConditions).slice(0, 4),
    next_checks: normalizeList(parsed.next_checks),
    minority_signal: String(parsed.minority_signal || ""),
    returned_model: String(parsed.model || fallbackModel || "")
  };
}

function aggregateVotes(results) {
  const valid = results.filter((result) => result.ok);
  const pool = valid.length ? valid : results;
  const weights = pool.map((result) => committeePolicy.weights[result.id] || Math.max(0.1, result.confidence || 0.1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const weightedProbability = pool.reduce(
    (sum, result, index) => sum + result.probability * weights[index],
    0
  ) / totalWeight;

  const counts = {
    agree: pool.filter((result) => result.stance === "agree").length,
    disagree: pool.filter((result) => result.stance === "disagree").length
  };
  const decision = chooseDecision(counts, weightedProbability);
  const confidence = Math.min(
    0.95,
    Math.max(0.1, pool.reduce((sum, result) => sum + (result.confidence || 0), 0) / pool.length)
  );

  return {
    decision,
    weighted_probability: Number(weightedProbability.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    vote_counts: counts,
    direction: probabilityDirection(weightedProbability),
    total_votes: pool.length,
    summary: `${counts.agree || 0} 票赞同，${counts.disagree || 0} 票反对`
  };
}

async function synthesizeDecision({ results, aggregate, question, context }) {
  const fallback = fallbackDecision(results, aggregate, context);
  const deepseek = getDefaultCouncil().members.find((member) => member.id === "deepseek");
  if (!deepseek) return fallback;

  try {
    const raw = await askModel({
      provider: deepseek.provider,
      model: deepseek.model,
      system: buildSynthesisSystemPrompt(),
      user: buildSynthesisPrompt({ question, context, results, aggregate }),
      temperature: 0.1
    });
    const parsed = parseModelJson(raw);
    const fallbackDecisionLabel = normalizeFinalDecision(aggregate.decision);
    const finalDecision = fallback.risk_officer_veto
      ? "反对"
      : normalizeFinalDecision(parsed.final_decision, fallbackDecisionLabel);
    const disagreements = normalizeList(parsed.disagreements).slice(0, 4);
    const sharedViews = normalizeList(parsed.shared_views || parsed.consensus).slice(0, 4);
    const operationSuggestions = normalizeList(parsed.operation_suggestions || parsed.recommendation).slice(0, 4);
    return {
      ...fallback,
      final_decision: finalDecision,
      analysis_summary: limitText(parsed.analysis_summary || fallback.analysis_summary, 220),
      disagreements: disagreements.length ? disagreements : fallback.disagreements,
      shared_views: sharedViews.length ? sharedViews : fallback.shared_views,
      consensus: sharedViews.length ? sharedViews : fallback.shared_views,
      operation_suggestions: operationSuggestions.length ? operationSuggestions : fallback.operation_suggestions,
      recommendation: operationSuggestions.length ? operationSuggestions : fallback.operation_suggestions,
      investment_advice: limitText(parsed.investment_advice || fallback.investment_advice, 160),
      speculative_intent: fallback.risk_officer_veto
        ? "反对"
        : normalizeFinalDecision(parsed.speculative_intent, fallback.speculative_intent),
      investment_intent: fallback.risk_officer_veto
        ? "反对"
        : normalizeFinalDecision(parsed.investment_intent, fallback.investment_intent),
      risk_constraints: normalizeList(parsed.risk_constraints || fallback.risk_constraints).slice(0, 3),
      vote_summary: aggregate.summary
    };
  } catch {
    return fallback;
  }
}

function buildSynthesisPrompt({ question, context, results, aggregate }) {
  const compactResults = results.map((result) => ({
    name: result.name,
    decision_label: result.decision_label,
    stance: result.stance,
    score: result.score,
    detailed_analysis: result.detailed_analysis,
    main_conclusions: result.main_conclusions,
    core_evidence: result.core_evidence,
    opposing_evidence: result.opposing_evidence,
    invalidation_conditions: result.invalidation_conditions,
    risks: result.risks,
    suggested_action: result.suggested_action,
    suggested_position_sizing: result.suggested_position_sizing,
    minority_signal: result.minority_signal
  }));
  return `问题：
${question}

用户背景：
${context || "无"}

四模型输出：
${JSON.stringify(compactResults, null, 2)}

机械投票摘要，仅供参考，不得替代内容总结：
${JSON.stringify(aggregate, null, 2)}

请只做中立总结。DeepSeek 不能偏袒自己的上文。`;
}

function fallbackDecision(results, aggregate, context = "") {
  const risk = results.find((result) => result.id === "deepseek");
  const profileIncomplete = !String(context || "").trim();
  const riskVeto = Boolean((risk && (risk.score < 50 || risk.stance === "disagree")) || profileIncomplete);
  const finalDecision = riskVeto ? "反对" : normalizeFinalDecision(aggregate.decision);
  const riskConstraints = [
    profileIncomplete ? "用户画像不完整，最终建议只能保持观察或分析。" : "",
    riskVeto ? "Risk Officer 触发风控约束，最终建议必须降级。" : "",
    ...extractRisks(results)
  ].filter(Boolean).slice(0, 3);

  return {
    decision: aggregate.decision,
    final_decision: finalDecision,
    direction: aggregate.direction,
    vote_summary: aggregate.summary,
    analysis_summary: "MAGI SYSTEM 已完成四模型独立分析，并将共识、分歧、操作建议和二元投票收敛为委员会结果。",
    shared_views: extractConsensus(results),
    consensus: extractConsensus(results),
    disagreements: extractDisagreements(results),
    operation_suggestions: aggregate.decision === "agree" && !riskVeto
      ? ["可以继续研究或小规模试探，但必须先确认仓位、止损和复核条件。"]
      : ["证据补齐前，不宜扩大风险暴露。"],
    recommendation: aggregate.decision === "agree" && !riskVeto
      ? ["可以继续研究或小规模试探，但必须先确认仓位、止损和复核条件。"]
      : ["证据补齐前，不宜扩大风险暴露。"],
    investment_advice: riskVeto
      ? "风控约束未解除前，投资意向应收敛为反对或观察。"
      : "若用户画像、估值和风险预算均可接受，可进入下一轮复核。",
    speculative_intent: aggregate.decision === "agree" && !riskVeto ? "赞同" : "反对",
    investment_intent: aggregate.decision === "agree" && !riskVeto ? "赞同" : "反对",
    risk_constraints: riskConstraints,
    risk_officer_veto: riskVeto,
    decision_guide: "把共识当作基准情景，把分歧当作下单前的核验清单。"
  };
}

function extractConsensus(results) {
  return results
    .flatMap((result) => result.main_conclusions || result.key_evidence || [])
    .filter(Boolean)
    .slice(0, 4);
}

function extractDisagreements(results) {
  return results
    .map((result) => `${result.name}：${result.decision_label || result.direction}`)
    .filter(Boolean)
    .slice(0, 4);
}

function extractRisks(results) {
  return results
    .flatMap((result) => result.risk_notes || result.risks || [])
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeStance(stance, action, score, direction) {
  const value = String(stance || "").toLowerCase().replace(/\s+/g, "_");
  if (["agree", "disagree"].includes(value)) {
    return value;
  }
  if (["divided", "agree_with_conditions", "abstain", "neutral"].includes(value)) return binaryVoteFromAction(action, score);
  if (["strong_bullish", "bullish"].includes(value)) return "agree";
  if (["bearish", "strong_bearish"].includes(value)) return "disagree";
  const directionValue = String(direction || "").toLowerCase();
  if (directionValue.includes("bull")) return "agree";
  if (directionValue.includes("bear")) return "disagree";
  return binaryVoteFromAction(action, score);
}

function normalizeDecisionLabel(value, stance) {
  const text = String(value || "").trim();
  if (["同意", "赞同"].includes(text)) return "同意";
  if (["不同意", "不赞同", "反对"].includes(text)) return "不同意";
  if (stance === "agree") return "同意";
  return "不同意";
}

function normalizeFinalDecision(value, fallback = "反对") {
  const text = String(value || "").trim();
  if (["赞同", "反对"].includes(text)) return text;
  if (text === "不赞同") return "反对";
  if (value === "agree") return "赞同";
  if (value === "disagree") return "反对";
  if (["赞同", "反对"].includes(fallback)) return fallback;
  if (fallback === "agree") return "赞同";
  return "反对";
}

function limitText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).slice(0, 8);
  if (!value) return [];
  return [String(value)];
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizePercentNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  if (number > 0 && number <= 1) return Math.round(number * 100);
  return clampNumber(number, 0, 100, fallback);
}

function stanceProbability(stance) {
  if (stance === "agree") return 0.65;
  if (stance === "disagree") return 0.35;
  return 0.5;
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function chooseDecision(counts, probability) {
  if ((counts.disagree || 0) > (counts.agree || 0)) {
    return "disagree";
  }
  if (probability >= 0.62 && (counts.agree || 0) >= (counts.disagree || 0)) return "agree";
  if (probability <= 0.42) return "disagree";
  return (counts.agree || 0) >= (counts.disagree || 0) ? "agree" : "disagree";
}

function probabilityDirection(probability) {
  if (probability >= 0.7) return "强建设性";
  if (probability >= 0.58) return "偏建设性，但需风险约束";
  if (probability >= 0.45) return "中性，取决于后续证据";
  return "防御优先";
}
