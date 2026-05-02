import { getDefaultCouncil } from "./council-config.js";
import { runFinanceTools } from "./finance-tools.js";
import { askModel } from "./model-adapters.js";

const memberSystem = `你是 MAGI SYSTEM 的一名独立分析模型。
角色：{{ROLE}}

产品原则：
- 你看不到其他议员的输出，必须独立判断，避免锚定。
- 方差是信号。不要为了显得稳妥而调和分歧。
- 所有判断必须可证伪。必须说明核心证据、关键风险和结论边界。
- 不输出投资建议指令，只输出决策辅助信息。
- 如果用户问题可以用“是/否”回答，你必须直接选择 agree 或 disagree。不要返回 agree_with_conditions。
- detailed_analysis 必须是完整分析摘要，少于 500 个中文字符，不输出隐藏思维链。

表达必须使用专业中文，必要时保留 English 专业术语。不要写寒暄。
只返回符合以下结构的 JSON：
{
  "stance": "agree | disagree | divided",
  "decision_label": "同意 | 不同意 | 分歧",
  "time_horizon": "判断期限",
  "detailed_analysis": "少于 500 个中文字符的完整分析摘要",
  "main_conclusions": ["主要结论，最多 4 条"],
  "key_evidence": ["核心依据"],
  "risks": ["主要风险"],
  "next_checks": ["后续核验"],
  "minority_signal": "如果你的观点可能是少数派，说明它为什么值得保留",
  "model": "模型名称"
}`;

const synthesisSystem = `你是 MAGI SYSTEM 的最终备忘录整理员，由 DeepSeek 执行。
你的任务只是在四个模型输出之间做中立总结，不允许偏袒 DeepSeek 自己的分析，不允许扩大或改写任何模型未表达的观点。
你必须输出专业中文，只返回 JSON：
{
  "final_decision": "赞同 | 不赞同 | 分歧",
  "disagreements": ["四模型的关键分歧，最多 4 条"],
  "consensus": ["四模型的共同判断，最多 4 条"],
  "recommendation": ["基于分歧和共识给出的操作建议，最多 4 条"]
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
          stance: "divided",
          decision_label: "分歧",
          probability: 0.5,
          confidence: 0,
          direction: "无法形成判断",
          detailed_analysis: limitText(error.message, 500),
          thesis: limitText(error.message, 500),
          main_conclusions: ["模型调用失败。"],
          key_evidence: [],
          key_assumptions: [],
          risks: ["模型调用失败。"],
          what_would_change_my_mind: [],
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
  const analysis = limitText(parsed.detailed_analysis || parsed.thesis || "模型未返回分析。", 500);
  return {
    stance,
    decision_label: normalizeDecisionLabel(parsed.decision_label, stance),
    probability: stanceProbability(stance),
    direction: String(parsed.direction || "中性"),
    confidence: 0.5,
    time_horizon: String(parsed.time_horizon || "未说明"),
    detailed_analysis: analysis,
    thesis: analysis,
    main_conclusions: normalizeList(parsed.main_conclusions || parsed.key_evidence).slice(0, 4),
    key_evidence: normalizeList(parsed.key_evidence),
    key_assumptions: [],
    risks: normalizeList(parsed.risks),
    what_would_change_my_mind: [],
    next_checks: normalizeList(parsed.next_checks),
    minority_signal: String(parsed.minority_signal || ""),
    returned_model: String(parsed.model || fallbackModel || "")
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
    summary: `${counts.agree || 0} 票赞同，${counts.disagree || 0} 票不赞同，${counts.divided || 0} 票分歧`
  };
}

async function synthesizeDecision({ results, aggregate, question, context }) {
  const fallback = fallbackDecision(results, aggregate);
  const deepseek = getDefaultCouncil().members.find((member) => member.id === "deepseek");
  if (!deepseek) return fallback;

  try {
    const raw = await askModel({
      provider: deepseek.provider,
      model: deepseek.model,
      system: synthesisSystem,
      user: buildSynthesisPrompt({ question, context, results, aggregate }),
      temperature: 0.1
    });
    const parsed = parseModelJson(raw);
    const disagreements = normalizeList(parsed.disagreements).slice(0, 4);
    const consensus = normalizeList(parsed.consensus).slice(0, 4);
    const recommendation = normalizeList(parsed.recommendation).slice(0, 4);
    return {
      ...fallback,
      final_decision: normalizeFinalDecision(parsed.final_decision, fallback.final_decision),
      disagreements: disagreements.length ? disagreements : fallback.disagreements,
      consensus: consensus.length ? consensus : fallback.consensus,
      recommendation: recommendation.length ? recommendation : fallback.recommendation
    };
  } catch {
    return fallback;
  }
}

function buildSynthesisPrompt({ question, context, results, aggregate }) {
  const compactResults = results.map((result) => ({
    name: result.name,
    decision_label: result.decision_label,
    detailed_analysis: result.detailed_analysis,
    main_conclusions: result.main_conclusions,
    risks: result.risks,
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

function fallbackDecision(results, aggregate) {
  return {
    decision: aggregate.decision,
    final_decision: normalizeFinalDecision(aggregate.decision),
    direction: aggregate.direction,
    vote_summary: aggregate.summary,
    rationale: "MAGI SYSTEM 根据四个模型的并行输出完成加权综合，并保留共识、分歧和少数派信号。",
    consensus: extractConsensus(results),
    disagreements: extractDisagreements(results),
    recommendation: aggregate.decision === "agree"
      ? ["可以推进，但必须先确认风险边界和执行节奏。"]
      : aggregate.decision === "disagree"
        ? ["证据补齐前，不宜扩大风险暴露。"]
        : ["先处理分歧项，再决定是否执行。"],
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

function normalizeStance(stance) {
  const value = String(stance || "").toLowerCase().replace(/\s+/g, "_");
  if (["agree", "disagree", "divided", "agree_with_conditions", "abstain"].includes(value)) {
    if (value === "agree_with_conditions" || value === "abstain") return "divided";
    return value;
  }
  if (["strong_bullish", "bullish"].includes(value)) return "agree";
  if (value === "neutral") return "divided";
  if (["bearish", "strong_bearish"].includes(value)) return "disagree";
  return "divided";
}

function normalizeDecisionLabel(value, stance) {
  const text = String(value || "").trim();
  if (["同意", "不同意", "分歧"].includes(text)) return text;
  if (stance === "agree") return "同意";
  if (stance === "disagree") return "不同意";
  return "分歧";
}

function normalizeFinalDecision(value, fallback = "分歧") {
  const text = String(value || "").trim();
  if (["赞同", "不赞同", "分歧"].includes(text)) return text;
  if (value === "agree") return "赞同";
  if (value === "disagree") return "不赞同";
  if (["赞同", "不赞同", "分歧"].includes(fallback)) return fallback;
  if (fallback === "agree") return "赞同";
  if (fallback === "disagree") return "不赞同";
  return "分歧";
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
  return "divided";
}

function probabilityDirection(probability) {
  if (probability >= 0.7) return "强建设性";
  if (probability >= 0.58) return "偏建设性，但需风险约束";
  if (probability >= 0.45) return "中性，取决于后续证据";
  return "防御优先";
}
