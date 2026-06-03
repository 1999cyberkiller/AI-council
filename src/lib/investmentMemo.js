import { ANALYSTS } from './prompts';
import { buildEvidenceMarkdown, buildResearchQuality } from './researchQuality';

const FIELD_FALLBACK = '待补充';

const joinPoints = (points, limit = 3) => {
  const list = points
    .filter((p) => typeof p === 'string' && p.trim())
    .map((p) => p.trim())
    .slice(0, limit);
  return list.length ? list.map((p) => `- ${p}`).join('\n') : FIELD_FALLBACK;
};

const getAnalystData = (analyses) => Object.values(analyses || {})
  .filter((st) => st?.status === 'done' && st.data)
  .map((st) => st.data);

const daysFromNow = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function buildInvestmentMemoDraft(stockData, analyses, editorState) {
  const editor = editorState?.status === 'done' ? editorState.data : null;
  const researchQuality = buildResearchQuality(analyses, editorState, ANALYSTS);
  const analystData = getAnalystData(analyses);
  const bulls = analystData.filter((d) => d.verdict === 'BUY');
  const bears = analystData.filter((d) => d.verdict === 'SELL' || d.verdict === 'HOLD');
  const bullPoints = bulls.flatMap((d) => d.key_points || []);
  const bearPoints = [
    ...bears.map((d) => d.risk).filter(Boolean),
    ...(editor?.dissent_areas || []).map((d) => d.topic).filter(Boolean),
  ];
  const catalysts = [
    editor?.watchpoint,
    ...(editor?.consensus_areas || []).map((d) => d.point).filter(Boolean),
  ].filter((p) => p && p !== '—');

  return {
    thesis: editor?.key_sentence || editor?.headline || analystData[0]?.headline || `${stockData?.name || '该标的'}研究结论待补充`,
    bullCase: joinPoints(bullPoints.length ? bullPoints : analystData.flatMap((d) => d.key_points || [])),
    bearCase: joinPoints(bearPoints),
    catalysts: joinPoints(catalysts),
    invalidation: editor?.watchpoint && editor.watchpoint !== '—'
      ? `若「${editor.watchpoint}」恶化或无法验证，重新评估本轮判断。`
      : FIELD_FALLBACK,
    thesisState: researchQuality.thesisState,
    researchAction: researchQuality.researchAction,
    sourceQuality: editor?.evidence_summary?.source_quality || (
      researchQuality.gate === 'durable' ? 'medium' : 'low'
    ),
    weakestLink: editor?.evidence_summary?.weakest_link || (
      researchQuality.blockerCount > 0 ? '存在会阻断行动性的证据缺口' : '逐条原始来源仍需补齐'
    ),
    durableClaim: editor?.evidence_summary?.durable_claim || '',
    mustRefreshIf: joinPoints(researchQuality.mustRefreshIf, 4),
    nextReview: researchQuality.staleAfter || daysFromNow(14),
    evidenceLog: buildEvidenceMarkdown(researchQuality.evidenceRows),
    evidenceStats: {
      gate: researchQuality.gate,
      durableCount: researchQuality.durableCount,
      weakCount: researchQuality.weakCount,
      blockerCount: researchQuality.blockerCount,
    },
    notes: '',
    updatedAt: Date.now(),
  };
}

export function memoToMarkdown(stockData, memo) {
  if (!stockData || !memo) return '';
  return [
    `# ${stockData.name || stockData.code} 投资备忘录`,
    '',
    `- 代码：${stockData.code || '—'}`,
    `- Thesis 状态：${memo.thesisState || 'draft'}`,
    `- 研究动作：${memo.researchAction || 'watch_only'}`,
    `- 来源质量：${memo.sourceQuality || 'low'}`,
    `- 下次复盘：${memo.nextReview || '—'}`,
    '',
    '## 核心判断',
    memo.thesis || FIELD_FALLBACK,
    '',
    '## 买入理由',
    memo.bullCase || FIELD_FALLBACK,
    '',
    '## 反方理由',
    memo.bearCase || FIELD_FALLBACK,
    '',
    '## 关键催化',
    memo.catalysts || FIELD_FALLBACK,
    '',
    '## 失效条件',
    memo.invalidation || FIELD_FALLBACK,
    '',
    '## 刷新条件',
    memo.mustRefreshIf || FIELD_FALLBACK,
    '',
    '## 最弱证据链',
    memo.weakestLink || FIELD_FALLBACK,
    '',
    '## Evidence Log',
    memo.evidenceLog || FIELD_FALLBACK,
    '',
    '## 手记',
    memo.notes || FIELD_FALLBACK,
  ].join('\n');
}
