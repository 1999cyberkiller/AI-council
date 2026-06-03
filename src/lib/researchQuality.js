export const CLAIM_TYPES = new Set([
  'fact',
  'reported_metric',
  'company_claim',
  'guidance',
  'target',
  'commitment',
  'forecast',
  'assumption',
  'interpretation',
  'opinion',
  'market_pricing',
  'sentiment',
  'rumor_signal',
  'derived_calculation',
]);

export const EVIDENCE_CATEGORIES = new Set([
  'verified_fact',
  'reported_fact',
  'company_statement',
  'management_guidance',
  'market_pricing',
  'assumption',
  'inference',
  'estimate',
  'weak_signal',
  'stale',
  'contradicted',
  'unknown',
]);

export const READINESS_IMPACTS = new Set([
  'supports_durable_conclusion',
  'supports_working_view',
  'monitoring_only',
  'blocks_actionability',
  'blocks_publication',
  'not_material',
]);

export const RESEARCH_ACTIONS = new Set([
  'watch_only',
  'upgrade_watch',
  'downgrade_watch',
  'add_to_research_queue',
  'reduce_research_priority',
  'hedge_context',
  'event_setup',
  'post_event_follow_through',
  'valuation_reset_watch',
  'risk_reduction_context',
  'needs_refresh',
  'no_action',
  'retire_thesis',
]);

export const THESIS_STATES = new Set([
  'draft',
  'active',
  'watch',
  'upgrade_watch',
  'downgrade_watch',
  'narrative_watch',
  'stale',
  'retired',
]);

const WEAK_CATEGORIES = new Set([
  'company_statement',
  'management_guidance',
  'market_pricing',
  'assumption',
  'inference',
  'estimate',
  'weak_signal',
  'stale',
  'contradicted',
  'unknown',
]);

const normalizeToken = (value, allowed, fallback) => {
  const token = typeof value === 'string' ? value.trim() : '';
  return allowed.has(token) ? token : fallback;
};

const normalizeList = (value) => (
  Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
);

const inferClaimType = (text, fallback = 'interpretation') => {
  const s = String(text || '');
  if (/PE|PB|EPS|ROE|ROIC|营收|收入|利润|现金流|市值|估值|同比|环比|margin|revenue|earnings/i.test(s)) return 'reported_metric';
  if (/MA|均线|K线|成交量|RSI|MACD|支撑|阻力|突破|回踩|趋势/i.test(s)) return 'market_pricing';
  if (/指引|guidance|目标|target|预测|consensus|共识|预期/i.test(s)) return 'forecast';
  if (/风险|不确定|假设|如果|取决于/i.test(s)) return 'assumption';
  return fallback;
};

const inferEvidenceCategory = (claimType, analystId) => {
  if (claimType === 'fact' || claimType === 'reported_metric') return 'reported_fact';
  if (claimType === 'guidance') return 'management_guidance';
  if (claimType === 'market_pricing' || analystId === 'tech') return 'market_pricing';
  if (claimType === 'forecast' || claimType === 'derived_calculation') return 'estimate';
  if (claimType === 'company_claim') return 'company_statement';
  if (claimType === 'rumor_signal' || claimType === 'sentiment') return 'weak_signal';
  if (claimType === 'assumption') return 'assumption';
  return 'inference';
};

const fallbackEvidenceRows = (analystId, analystName, data) => {
  const rows = [];
  normalizeList(data?.key_points).slice(0, 3).forEach((point, index) => {
    const claimType = inferClaimType(point);
    rows.push({
      source_id: `${analystId}_point_${index + 1}`,
      claim_area: analystId === 'tech' ? 'market_pricing' : 'thesis_support',
      claim_type: claimType,
      claim_text: point,
      source_speaker: 'mira',
      verification_status: claimType === 'reported_metric' ? 'disclosed' : 'modeled',
      authority_level: 'L6',
      used_by_agent: analystName,
      confidence: data?.conviction >= 4 ? 'medium' : 'low',
      evidence_category: inferEvidenceCategory(claimType, analystId),
      freshness_status: 'unknown',
      conflict_status: 'not_checked',
      treatment: claimType === 'market_pricing' ? 'attribute' : 'haircut',
      readiness_impact: 'supports_working_view',
      notes: '由模型专栏观点回填，缺少逐条原始来源。',
    });
  });
  if (data?.risk) {
    rows.push({
      source_id: `${analystId}_risk`,
      claim_area: 'risk',
      claim_type: 'assumption',
      claim_text: data.risk,
      source_speaker: 'mira',
      verification_status: 'modeled',
      authority_level: 'L6',
      used_by_agent: analystName,
      confidence: 'medium',
      evidence_category: 'assumption',
      freshness_status: 'unknown',
      conflict_status: 'not_checked',
      treatment: 'monitor',
      readiness_impact: 'monitoring_only',
      notes: '风险项需要后续来源验证。',
    });
  }
  return rows;
};

export function normalizeEvidenceRow(row, index, context = {}) {
  const claimText = typeof row?.claim_text === 'string' && row.claim_text.trim()
    ? row.claim_text.trim()
    : context.fallbackText || '未说明的研究信息';
  const claimType = normalizeToken(row?.claim_type, CLAIM_TYPES, inferClaimType(claimText));
  const evidenceCategory = normalizeToken(
    row?.evidence_category,
    EVIDENCE_CATEGORIES,
    inferEvidenceCategory(claimType, context.analystId)
  );
  return {
    source_id: String(row?.source_id || `${context.analystId || 'agent'}_${index + 1}`),
    claim_area: String(row?.claim_area || 'thesis_support'),
    claim_type: claimType,
    claim_text: claimText,
    source_speaker: String(row?.source_speaker || 'mira'),
    verification_status: String(row?.verification_status || 'modeled'),
    authority_level: /^L[1-6]$/.test(row?.authority_level || '') ? row.authority_level : 'L6',
    used_by_agent: String(row?.used_by_agent || context.analystName || 'AI Council'),
    confidence: ['high', 'medium', 'low'].includes(row?.confidence) ? row.confidence : 'low',
    evidence_category: evidenceCategory,
    freshness_status: ['current', 'acceptable_for_period', 'preliminary', 'stale', 'unknown'].includes(row?.freshness_status)
      ? row.freshness_status
      : 'unknown',
    conflict_status: ['none', 'unresolved', 'contradicted', 'not_checked'].includes(row?.conflict_status)
      ? row.conflict_status
      : 'not_checked',
    treatment: ['use_normally', 'attribute', 'sensitize', 'haircut', 'source_gap', 'monitor', 'exclude', 'open_item'].includes(row?.treatment)
      ? row.treatment
      : (WEAK_CATEGORIES.has(evidenceCategory) ? 'haircut' : 'attribute'),
    readiness_impact: normalizeToken(row?.readiness_impact, READINESS_IMPACTS, 'supports_working_view'),
    notes: String(row?.notes || ''),
  };
}

export function collectEvidenceRows(analyses, editorState, analystMeta = []) {
  const rows = [];
  analystMeta.forEach((analyst) => {
    const data = analyses?.[analyst.id]?.status === 'done' ? analyses[analyst.id].data : null;
    if (!data) return;
    const rawRows = Array.isArray(data.evidence_log) && data.evidence_log.length
      ? data.evidence_log
      : fallbackEvidenceRows(analyst.id, analyst.cnName, data);
    rawRows.forEach((row, index) => {
      rows.push(normalizeEvidenceRow(row, index, {
        analystId: analyst.id,
        analystName: analyst.cnName,
        fallbackText: data.headline,
      }));
    });
  });

  const editor = editorState?.status === 'done' ? editorState.data : null;
  if (Array.isArray(editor?.evidence_log)) {
    editor.evidence_log.forEach((row, index) => {
      rows.push(normalizeEvidenceRow(row, index, {
        analystId: 'editor',
        analystName: '主编',
        fallbackText: editor.headline,
      }));
    });
  }
  return rows;
}

export function buildResearchQuality(analyses, editorState, analystMeta = []) {
  const evidenceRows = collectEvidenceRows(analyses, editorState, analystMeta);
  const editor = editorState?.status === 'done' ? editorState.data : null;
  const durableRows = evidenceRows.filter((row) => row.readiness_impact === 'supports_durable_conclusion');
  const blockerRows = evidenceRows.filter((row) => (
    row.readiness_impact === 'blocks_actionability' ||
    row.readiness_impact === 'blocks_publication' ||
    row.evidence_category === 'unknown' ||
    row.evidence_category === 'contradicted' ||
    row.evidence_category === 'stale'
  ));
  const weakRows = evidenceRows.filter((row) => WEAK_CATEGORIES.has(row.evidence_category));
  const supportRows = evidenceRows.filter((row) => (
    row.claim_area !== 'risk' &&
    row.readiness_impact !== 'monitoring_only' &&
    row.readiness_impact !== 'not_material'
  ));
  const hasMarketPricingOnly = supportRows.length > 0 &&
    supportRows.every((row) => row.evidence_category === 'market_pricing');

  let thesisState = normalizeToken(editor?.thesis_state, THESIS_STATES, 'draft');
  let researchAction = normalizeToken(editor?.research_action, RESEARCH_ACTIONS, 'watch_only');
  let gate = 'working_view';

  if (blockerRows.length > 0 || hasMarketPricingOnly) {
    thesisState = thesisState === 'active' ? 'watch' : thesisState;
    researchAction = researchAction === 'no_action' ? 'needs_refresh' : researchAction;
    gate = 'source_gap';
  } else if (durableRows.length >= 2 && weakRows.length <= durableRows.length) {
    thesisState = thesisState === 'draft' ? 'active' : thesisState;
    gate = 'durable';
  }

  return {
    thesisState,
    researchAction,
    gate,
    staleAfter: editor?.stale_after || '',
    mustRefreshIf: normalizeList(editor?.must_refresh_if),
    evidenceRows,
    durableCount: durableRows.length,
    blockerCount: blockerRows.length,
    weakCount: weakRows.length,
  };
}

export function buildEvidenceMarkdown(rows) {
  if (!rows?.length) return '暂无 evidence log。';
  const header = [
    'source_id',
    'claim_area',
    'claim_type',
    'claim_text',
    'source_speaker',
    'verification_status',
    'authority_level',
    'used_by_agent',
    'confidence',
    'evidence_category',
    'freshness_status',
    'conflict_status',
    'treatment',
    'readiness_impact',
    'notes',
  ];
  const escapeCell = (value) => String(value ?? '').replace(/\n/g, ' ').replace(/\|/g, '/');
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${header.map((key) => escapeCell(row[key])).join(' | ')} |`),
  ].join('\n');
}
