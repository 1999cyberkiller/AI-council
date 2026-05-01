import { getDefaultCouncil, providerConfigured } from "./council-config.js";
import { runFinanceTools } from "./finance-tools.js";
import { askModel } from "./model-adapters.js";

const memberSystem = `你是 AI 金融议会的一名独立议员。
角色：{{ROLE}}

产品原则：
- 你看不到其他议员的输出，必须独立判断，避免锚定。
- 方差是信号。不要为了显得稳妥而调和分歧。
- 所有判断必须可证伪。必须写出关键假设和什么会改变你的看法。
- 不输出投资建议指令，只输出决策辅助信息。

表达必须使用专业中文，必要时保留 English 专业术语。不要写寒暄。
只返回符合以下结构的 JSON：
{
  "stance": "agree | disagree | agree_with_conditions | abstain",
  "probability": 0.0,
  "direction": "简短决策方向",
  "confidence": 0.0,
  "time_horizon": "判断期限",
  "thesis": "核心推理",
  "key_evidence": ["核心依据"],
  "key_assumptions": ["该结论成立所依赖的关键假设"],
  "risks": ["主要风险"],
  "what_would_change_my_mind": ["会让你修正结论的具体证据"],
  "next_checks": ["后续核验"],
  "minority_signal": "如果你的观点可能是少数派，说明它为什么值得保留",
  "model": "模型名称"
}`;

const chairSystem = `你是 AI 金融议会主席，独立于四位议员之外。
你不投票，不站队，不引入四席都没有提出的新观点。
你的任务是整理共识、分歧和少数派意见，形成中文决策辅助包。
不要把分歧强行调和。表达必须专业、简洁、可执行。
只返回符合以下结构的 JSON：
{
  "decision": "agree | disagree | agree_with_conditions | abstain",
  "probability": 0.0,
  "direction": "决策方向",
  "confidence": 0.0,
  "vote_summary": "投票摘要",
  "rationale": "该判断成立的原因",
  "consensus_zone": ["至少 2 席共同支持的要点"],
  "disagreements": ["关键分歧"],
  "minority_opinion_preserved": "最值得保留的少数派意见",
  "action": "下一步动作",
  "watchlist": ["观察项"],
  "decision_guide": "用户如何根据风险偏好使用这份结论"
}`;

export async function analyzeWithCouncil({ question, context = "", selectedMembers = [] }) {
  const council = getDefaultCouncil();
  const members = selectedMembers.length
    ? council.members.filter((member) => selectedMembers.includes(member.id))
    : council.members;

  if (!question || !question.trim()) {
    throw new Error("请输入分析问题。");
  }

  const enabledTools = unique(members.flatMap((member) => member.allowedTools || []));
  const toolOutputs = await runFinanceTools({ question, context, enabledTools });

  const memberResults = await Promise.all(
    members.map(async (member) => {
      const startedAt = Date.now();
      const visibleToolOutputs = memberToolOutputs(member, toolOutputs);
      const toolText = JSON.stringify(visibleToolOutputs, null, 2);
      try {
        const raw = await askModel({
          provider: member.provider,
          model: member.model,
          system: memberSystem.replace("{{ROLE}}", `${member.name}: ${member.role}`),
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
          stance: "abstain",
          probability: 0.5,
          confidence: 0,
          direction: "无法形成判断",
          thesis: error.message,
          key_evidence: [],
          risks: ["模型调用失败。"],
          next_checks: ["检查 provider API key、模型名称和网络连接。"]
        };
      }
    })
  );

  const aggregate = aggregateVotes(memberResults);
  const chair = await synthesizeChair({ council, question, context, toolOutputs, memberResults, aggregate });

  return {
    question,
    context,
    generated_at: new Date().toISOString(),
    tools: toolOutputs,
    members: memberResults,
    aggregate,
    chair
  };
}

function buildMemberPrompt({ question, context, toolText, member }) {
  return `问题：
${question}

用户背景：
${context || "无"}

可用金融工具输出：
${toolText}

议会成员：
${member.name}

工具权限：
${(member.allowedTools || []).join(", ") || "无"}

请给出独立判断。你只能使用上方列出的工具输出。不要复述工具输出，只在有价值时引用。`;
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

async function synthesizeChair({ council, question, context, toolOutputs, memberResults, aggregate }) {
  if (!providerConfigured(council.chair.provider)) {
    return localChair(memberResults, aggregate);
  }

  const payload = {
    question,
    context,
    tools: toolOutputs,
    member_results: anonymizeMembers(memberResults),
    aggregate
  };

  try {
    const raw = await askModel({
      provider: council.chair.provider,
      model: council.chair.model,
      system: chairSystem,
      user: JSON.stringify(payload, null, 2),
      temperature: 0.1
    });
    return normalizeChair(parseModelJson(raw), aggregate);
  } catch {
    return localChair(memberResults, aggregate);
  }
}

function anonymizeMembers(memberResults) {
  return memberResults.map((result, index) => ({
    seat: `Seat ${String.fromCharCode(65 + index)}`,
    stance: result.stance,
    probability: result.probability,
    confidence: result.confidence,
    direction: result.direction,
    thesis: result.thesis,
    key_evidence: result.key_evidence,
    key_assumptions: result.key_assumptions,
    risks: result.risks,
    what_would_change_my_mind: result.what_would_change_my_mind,
    minority_signal: result.minority_signal
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
  const stance = normalizeStance(parsed.stance);
  return {
    stance,
    probability: clampNumber(parsed.probability, stanceProbability(stance)),
    direction: String(parsed.direction || "中性"),
    confidence: clampNumber(parsed.confidence, 0.4),
    time_horizon: String(parsed.time_horizon || "未说明"),
    thesis: String(parsed.thesis || "模型未返回核心推理。"),
    key_evidence: normalizeList(parsed.key_evidence),
    key_assumptions: normalizeList(parsed.key_assumptions),
    risks: normalizeList(parsed.risks),
    what_would_change_my_mind: normalizeList(parsed.what_would_change_my_mind),
    next_checks: normalizeList(parsed.next_checks),
    minority_signal: String(parsed.minority_signal || ""),
    returned_model: String(parsed.model || fallbackModel || "")
  };
}

function normalizeChair(parsed, aggregate) {
  return {
    decision: normalizeStance(parsed.decision || aggregate.decision),
    probability: clampNumber(parsed.probability, aggregate.weighted_probability),
    direction: String(parsed.direction || aggregate.direction),
    confidence: clampNumber(parsed.confidence, aggregate.confidence),
    vote_summary: String(parsed.vote_summary || aggregate.summary),
    rationale: String(parsed.rationale || "该结论来自议会加权投票。"),
    consensus_zone: normalizeList(parsed.consensus_zone),
    disagreements: normalizeList(parsed.disagreements),
    minority_opinion_preserved: String(parsed.minority_opinion_preserved || ""),
    action: String(parsed.action || "在证据更充分前，不宜扩大仓位。"),
    watchlist: normalizeList(parsed.watchlist),
    decision_guide: String(parsed.decision_guide || "")
  };
}

function aggregateVotes(results) {
  const valid = results.filter((result) => result.ok);
  const pool = valid.length ? valid : results;
  const weights = pool.map((result) => Math.max(0.1, result.confidence || 0.1));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const weightedProbability = pool.reduce(
    (sum, result, index) => sum + result.probability * weights[index],
    0
  ) / totalWeight;

  const counts = countBy(pool.map((result) => result.stance));
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
    summary: `${counts.agree || 0} 票赞同，${counts.agree_with_conditions || 0} 票有条件赞同，${counts.disagree || 0} 票反对，${counts.abstain || 0} 票弃权`
  };
}

function localChair(results, aggregate) {
  const disagreement = [...new Set(results.map((result) => result.direction).filter(Boolean))].slice(0, 4);
  const consensus = extractConsensus(results);
  const minority = extractMinority(results);
  return {
    decision: aggregate.decision,
    probability: aggregate.weighted_probability,
    direction: aggregate.direction,
    confidence: aggregate.confidence,
    vote_summary: aggregate.summary,
    rationale: "主席模型尚未配置或调用失败，因此使用本地投票规则完成综合判断。",
    consensus_zone: consensus,
    disagreements: disagreement,
    minority_opinion_preserved: minority,
    action: aggregate.weighted_probability >= 0.6
      ? "可以分阶段推进，但必须保留明确的下行触发条件。"
      : "缺失证据补齐前，不宜扩大仓位。",
    watchlist: [
      "估值水平与远期盈利修正的匹配度",
      "流动性环境与政策方向",
      "持仓拥挤度与回撤不对称风险"
    ],
    decision_guide: "把共识当作基准情景，把分歧当作下单前的核验清单。"
  };
}

function extractConsensus(results) {
  return results
    .flatMap((result) => result.key_evidence || [])
    .filter(Boolean)
    .slice(0, 3);
}

function extractMinority(results) {
  const valid = results.filter((result) => result.ok);
  if (!valid.length) return "";
  const counts = countBy(valid.map((result) => result.stance));
  const minority = valid.find((result) => counts[result.stance] === 1);
  return minority?.minority_signal || minority?.thesis || "";
}

function normalizeStance(stance) {
  const value = String(stance || "").toLowerCase().replace(/\s+/g, "_");
  if (["agree", "disagree", "agree_with_conditions", "abstain"].includes(value)) return value;
  if (["strong_bullish", "bullish"].includes(value)) return "agree";
  if (value === "neutral") return "agree_with_conditions";
  if (["bearish", "strong_bearish"].includes(value)) return "disagree";
  return "abstain";
}

function clampNumber(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean).slice(0, 8);
  if (!value) return [];
  return [String(value)];
}

function stanceProbability(stance) {
  if (stance === "agree") return 0.65;
  if (stance === "agree_with_conditions") return 0.55;
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
  if ((counts.disagree || 0) > (counts.agree || 0) + (counts.agree_with_conditions || 0)) {
    return "disagree";
  }
  if (probability >= 0.62 && (counts.agree || 0) >= (counts.disagree || 0)) return "agree";
  if (probability <= 0.42) return "disagree";
  if ((counts.abstain || 0) > (counts.agree || 0) + (counts.agree_with_conditions || 0)) {
    return "abstain";
  }
  return "agree_with_conditions";
}

function probabilityDirection(probability) {
  if (probability >= 0.7) return "强建设性";
  if (probability >= 0.58) return "偏建设性，但需风险约束";
  if (probability >= 0.45) return "中性，取决于后续证据";
  return "防御优先";
}
