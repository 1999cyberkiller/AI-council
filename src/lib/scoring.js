/* ──────────────────────────────────────────────────────────────────
   SCORING · 分析师准确率评分
   规则：BUY 后超额收益 > 阈值 → 对；SELL 后超额收益 < -阈值 → 对；
        HOLD 时 |超额收益| < 阈值 → 对（HOLD 是"无方向性观点"，
        所以当股票跑得和大盘差不多时它就是对的）
   ────────────────────────────────────────────────────────────────── */

// "正确/错误/打平" 的边界（百分比，绝对值）
// 噪音区间：超额收益绝对值在此区间内视为"打平"，不计正/误
export const SCORING_TIE_BAND_PCT = 1.0;
// HOLD 判定：|超额收益| < 此值视为 HOLD 正确（大盘相当的走势）
export const SCORING_HOLD_THRESHOLD_PCT = 3.0;

/**
 * 判定一次 verdict 在已知 excess return 下的对错
 * @param {string} verdict 'BUY' | 'SELL' | 'HOLD'
 * @param {number} excessPct 超额收益（百分比，例如 +5.3 表示 +5.3%）
 * @returns {'right'|'wrong'|'tie'|'na'}
 */
export function scoreVerdict(verdict, excessPct) {
  if (typeof excessPct !== 'number' || !isFinite(excessPct)) return 'na';
  const abs = Math.abs(excessPct);
  if (verdict === 'BUY') {
    if (excessPct > SCORING_TIE_BAND_PCT) return 'right';
    if (excessPct < -SCORING_TIE_BAND_PCT) return 'wrong';
    return 'tie';
  }
  if (verdict === 'SELL') {
    if (excessPct < -SCORING_TIE_BAND_PCT) return 'right';
    if (excessPct > SCORING_TIE_BAND_PCT) return 'wrong';
    return 'tie';
  }
  if (verdict === 'HOLD') {
    if (abs < SCORING_HOLD_THRESHOLD_PCT) return 'right';
    return 'wrong';
  }
  return 'na';
}

/**
 * 给一条 historyEntry 的 outcome 计算每位分析师 + 主编的 score
 * @param {object} entry historyEntry（已有 outcome）
 * @returns {object} { value: 'right'|'wrong'|..., tech: ..., macro: ..., risk: ..., editor: ... }
 */
export function scoreEntry(entry) {
  const out = entry?.outcome;
  if (!out || typeof out.excessReturnPct !== 'number') return null;
  const result = {};
  // 4 位分析师
  ['value', 'tech', 'macro', 'risk'].forEach((id) => {
    const v = entry.analyses?.[id]?.data?.verdict;
    if (v) result[id] = scoreVerdict(v, out.excessReturnPct);
    else result[id] = 'na';
  });
  // 主编
  const editorVerdict = entry.editorState?.data?.verdict;
  result.editor = editorVerdict ? scoreVerdict(editorVerdict, out.excessReturnPct) : 'na';
  return result;
}

/**
 * 聚合所有已回填条目 → 每个角色的准确率统计
 * @param {Array} history 已包含 outcome 的 entries
 * @returns {object} 形如：
 *   {
 *     value: { total, right, wrong, tie, accuracy, recent: ['right','wrong',...],
 *              byMarket: { A: {total, right, accuracy}, US: {...} } },
 *     ...
 *     editor: { ... }
 *   }
 */
export function aggregateScores(history) {
  const roleIds = ['value', 'tech', 'macro', 'risk', 'editor'];
  const init = () => ({
    total: 0, right: 0, wrong: 0, tie: 0, na: 0,
    accuracy: null,        // null = 样本不足；否则 0..1
    recent: [],            // 最近 N 次（先存全部，最后切片）
    byMarket: {
      A:  { total: 0, right: 0, wrong: 0, tie: 0, accuracy: null },
      US: { total: 0, right: 0, wrong: 0, tie: 0, accuracy: null },
    },
    byAnalyst: {},   // 仅 editor 用：记录主编"押对每位分析师"次数，未来扩展
  });
  const acc = Object.fromEntries(roleIds.map((id) => [id, init()]));

  // 按时间倒序（最近的在前）
  const sorted = [...history]
    .filter((e) => e.outcome && e.outcome.status === 'done')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  sorted.forEach((e) => {
    const scores = scoreEntry(e);
    if (!scores) return;
    const market = e.stockData?.market || 'A';
    roleIds.forEach((id) => {
      const s = scores[id];
      if (s === 'na') {
        acc[id].na += 1;
        return;
      }
      acc[id].total += 1;
      acc[id][s] += 1;
      acc[id].recent.push(s);
      const bm = acc[id].byMarket[market];
      if (bm) {
        bm.total += 1;
        bm[s] += 1;
      }
    });
  });

  // 计算准确率（tie 不计入分母，避免摇摆区间冲淡分数）
  roleIds.forEach((id) => {
    const r = acc[id];
    const denom = r.right + r.wrong;
    r.accuracy = denom > 0 ? r.right / denom : null;
    // 最近 8 次
    r.recent = r.recent.slice(0, 8);
    ['A', 'US'].forEach((mk) => {
      const bm = r.byMarket[mk];
      const d = bm.right + bm.wrong;
      bm.accuracy = d > 0 ? bm.right / d : null;
    });
  });

  return acc;
}

/**
 * 判断一条 history entry 是否到期需要回填
 * - 已有 done outcome → 跳过
 * - 上次尝试失败但 <2 小时前 → 跳过（避免重试风暴）
 * - 时间戳 + N 天 > 当前 → 跳过（还没到期）
 * - 否则 → 该回填
 */
export const TRACK_WINDOW_DAYS = 30;
const MIN_RETRY_GAP_MS = 2 * 60 * 60 * 1000;        // 2 小时
const MAX_BACKFILL_AGE_MS = 180 * 24 * 60 * 60 * 1000; // 180 天后视为过期不再追

export function isDueForBackfill(entry, now = Date.now()) {
  if (!entry || !entry.timestamp) return false;
  if (entry.outcome?.status === 'done') return false;

  const age = now - entry.timestamp;
  const requiredAge = TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (age < requiredAge) return false;
  if (age > MAX_BACKFILL_AGE_MS) return false;  // 太老不追

  // 已有 attempts，最后一次 < 2 小时前则跳过
  const attempts = entry.outcomeAttempts || [];
  if (attempts.length > 0) {
    const lastAt = attempts[attempts.length - 1].at || 0;
    if (now - lastAt < MIN_RETRY_GAP_MS) return false;
  }
  // 失败次数过多则放弃
  if (attempts.length >= 8) return false;
  return true;
}

/**
 * 判断"待回填"状态
 * @returns 'done' | 'pending' | 'overdue' | 'failed' | 'unknown'
 */
export function backfillStatus(entry, now = Date.now()) {
  if (!entry || !entry.timestamp) return 'unknown';
  if (entry.outcome?.status === 'done') return 'done';
  const age = now - entry.timestamp;
  const required = TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (age < required) return 'pending';
  if ((entry.outcomeAttempts || []).length >= 8) return 'failed';
  if (age > MAX_BACKFILL_AGE_MS) return 'failed';
  return 'overdue';
}

/**
 * 计算还有几天可回填（未到期时为正，已到期为 0）
 */
export function daysUntilBackfill(entry, now = Date.now()) {
  if (!entry || !entry.timestamp) return 0;
  const required = TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const remaining = entry.timestamp + required - now;
  if (remaining <= 0) return 0;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}
