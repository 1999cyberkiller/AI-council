/* ──────────────────────────────────────────────────────────────────
   PARSER · LLM 响应解析（兼容推理标签 + 多种 JSON 包裹方式）
   ────────────────────────────────────────────────────────────────── */

// 从模型原始返回中尽力提取 JSON 对象
function extractJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  // 剥离推理模型的 thinking 标签
  let cleanText = rawText
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
    .trim();

  const tryParse = (s) => {
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  };

  // 策略 1: 整段是合法 JSON
  let parsed = tryParse(cleanText);
  if (parsed) return parsed;

  // 策略 2: 去掉 markdown 代码块
  const codeBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    parsed = tryParse(codeBlockMatch[1].trim());
    if (parsed) return parsed;
  }

  // 策略 3: 找第一个 { 到最后一个 }
  const stripped = cleanText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    parsed = tryParse(stripped.slice(start, end + 1));
    if (parsed) return parsed;
  }

  // 策略 4: 用括号深度匹配找完整最外层 {...}
  let depth = 0, startIdx = -1;
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] === '{') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (stripped[i] === '}') {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        const candidate = tryParse(stripped.slice(startIdx, i + 1));
        if (candidate) return candidate;
        startIdx = -1;
      }
    }
  }

  return null;
}

// 给原始 LLM 输出附上易读的失败原因（用户可读 + raw preview 用于折叠展开）
function makeParseError(rawText) {
  const preview = (rawText || '').replace(/\s+/g, ' ').slice(0, 200);
  const err = new Error('分析师交稿格式不符规范，请重试');
  err.rawPreview = preview;
  err.code = 'PARSE_ERROR';
  return err;
}

export function parseAnalystResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('模型返回为空');
  }
  const parsed = extractJson(rawText);
  if (!parsed) throw makeParseError(rawText);

  if (!['BUY', 'HOLD', 'SELL'].includes(parsed.verdict)) parsed.verdict = 'HOLD';
  parsed.conviction = Math.max(1, Math.min(5, parseInt(parsed.conviction) || 3));
  parsed.headline = parsed.headline || '观点待定';
  parsed.analysis = parsed.analysis || '正文缺失';
  parsed.key_points = Array.isArray(parsed.key_points) ? parsed.key_points.slice(0, 3) : [];
  parsed.risk = parsed.risk || '—';
  // data_gaps: 容忍缺失（旧版历史记录、不听话的模型）；过滤掉空字符串
  parsed.data_gaps = Array.isArray(parsed.data_gaps)
    ? parsed.data_gaps
        .filter((s) => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim())
        .slice(0, 3)
    : [];
  return parsed;
}

// 共识条目规范化：兼容两种形态
//   旧：字符串 "...."
//   新：{ point: "...", supporters: ["分析师A", ...] }
function normalizeConsensusArea(item) {
  if (typeof item === 'string') {
    return { point: item, supporters: [] };
  }
  if (item && typeof item === 'object') {
    return {
      point: typeof item.point === 'string' ? item.point : '—',
      supporters: Array.isArray(item.supporters)
        ? item.supporters.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
        : [],
    };
  }
  return null;
}

// 分歧条目规范化：兼容两种形态
//   旧：字符串 "...."
//   新：{ topic: "...", positions: {分析师A: "立场"}, root_cause: "..." }
const VALID_ROOT_CAUSES = new Set([
  'data_interpretation',
  'reasoning_path',
  'risk_appetite',
  'framework_choice',
]);
function normalizeDissentArea(item) {
  if (typeof item === 'string') {
    return { topic: item, positions: {}, root_cause: null };
  }
  if (item && typeof item === 'object') {
    const positions =
      item.positions && typeof item.positions === 'object' && !Array.isArray(item.positions)
        ? Object.fromEntries(
            Object.entries(item.positions)
              .filter(([k, v]) => typeof k === 'string' && typeof v === 'string')
              .map(([k, v]) => [k.trim(), v.trim()])
          )
        : {};
    const rc = typeof item.root_cause === 'string' ? item.root_cause.trim() : null;
    return {
      topic: typeof item.topic === 'string' ? item.topic : '—',
      positions,
      root_cause: VALID_ROOT_CAUSES.has(rc) ? rc : null,
    };
  }
  return null;
}

function normalizeUniqueContribution(item) {
  if (item && typeof item === 'object') {
    const analyst = typeof item.analyst === 'string' ? item.analyst.trim() : '';
    const point = typeof item.point === 'string' ? item.point.trim() : '';
    if (analyst && point) return { analyst, point };
  }
  return null;
}

export function parseEditorResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('主编返回为空');
  }
  const parsed = extractJson(rawText);
  if (!parsed) throw makeParseError(rawText);

  if (!['BUY', 'HOLD', 'SELL'].includes(parsed.verdict)) parsed.verdict = 'HOLD';
  parsed.conviction = Math.max(1, Math.min(5, parseInt(parsed.conviction) || 3));
  parsed.headline = parsed.headline || '主编观点待定';
  parsed.review = parsed.review || '札记缺失';

  // 新结构：对象数组；旧结构：字符串数组——都接住
  parsed.consensus_areas = Array.isArray(parsed.consensus_areas)
    ? parsed.consensus_areas.map(normalizeConsensusArea).filter(Boolean).slice(0, 4)
    : [];
  parsed.dissent_areas = Array.isArray(parsed.dissent_areas)
    ? parsed.dissent_areas.map(normalizeDissentArea).filter(Boolean).slice(0, 3)
    : [];
  parsed.unique_contributions = Array.isArray(parsed.unique_contributions)
    ? parsed.unique_contributions.map(normalizeUniqueContribution).filter(Boolean).slice(0, 3)
    : [];
  parsed.aggregated_data_gaps = Array.isArray(parsed.aggregated_data_gaps)
    ? parsed.aggregated_data_gaps
        .filter((s) => typeof s === 'string' && s.trim())
        .map((s) => s.trim())
        .slice(0, 3)
    : [];

  parsed.watchpoint = parsed.watchpoint || '—';
  parsed.grades = (parsed.grades && typeof parsed.grades === 'object' && !Array.isArray(parsed.grades))
    ? parsed.grades : {};
  return parsed;
}

// 输入清洗：剥掉常见的中文修饰前后缀
export function cleanTickerInput(raw) {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(
    /^(请\s*)?(分析|看一下|看看|查一下|查查|查询|了解|研究|帮我看|帮我查|分析下|帮看下|看下)\s*/i,
    ''
  );
  s = s.replace(
    /\s*(怎么样|这只股票|这股|这只|这家|这家公司|股票|怎样|如何|的情况|的走势|的基本面)\??$/i,
    ''
  );
  return s.trim();
}
