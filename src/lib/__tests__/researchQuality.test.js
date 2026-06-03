import { describe, expect, it } from 'vitest';
import { buildResearchQuality, collectEvidenceRows } from '../researchQuality';

const analysts = [
  { id: 'value', cnName: '价值派' },
  { id: 'tech', cnName: '技术派' },
];

describe('researchQuality', () => {
  it('normalizes missing evidence rows from analyst output', () => {
    const rows = collectEvidenceRows({
      value: {
        status: 'done',
        data: {
          conviction: 3,
          headline: '估值仍需验证',
          key_points: ['PE 处于历史中枢', '现金流仍需观察'],
          risk: '盈利兑现不及预期',
        },
      },
    }, null, analysts);

    expect(rows).toHaveLength(3);
    expect(rows[0].authority_level).toBe('L6');
    expect(rows[0].readiness_impact).toBe('supports_working_view');
    expect(rows[2].claim_area).toBe('risk');
  });

  it('downgrades market-pricing-only evidence', () => {
    const quality = buildResearchQuality({
      tech: {
        status: 'done',
        data: {
          conviction: 4,
          headline: '趋势仍强',
          key_points: ['MA20 上穿 MA60', '成交量放大'],
          risk: '跌破均线则转弱',
        },
      },
    }, {
      status: 'done',
      data: {
        thesis_state: 'active',
        research_action: 'no_action',
      },
    }, analysts);

    expect(quality.gate).toBe('source_gap');
    expect(quality.thesisState).toBe('watch');
    expect(quality.researchAction).toBe('needs_refresh');
  });

  it('allows durable gate when high-quality claims are present', () => {
    const quality = buildResearchQuality({
      value: {
        status: 'done',
        data: {
          evidence_log: [
            {
              claim_text: '公司披露一季度营收同比增长',
              claim_type: 'reported_metric',
              evidence_category: 'verified_fact',
              readiness_impact: 'supports_durable_conclusion',
            },
            {
              claim_text: '自由现金流改善来自经营现金流',
              claim_type: 'reported_metric',
              evidence_category: 'reported_fact',
              readiness_impact: 'supports_durable_conclusion',
            },
          ],
        },
      },
    }, {
      status: 'done',
      data: {
        thesis_state: 'draft',
        research_action: 'watch_only',
      },
    }, analysts);

    expect(quality.gate).toBe('durable');
    expect(quality.thesisState).toBe('active');
    expect(quality.durableCount).toBe(2);
  });
});
