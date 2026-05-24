import React, { useEffect, useMemo, useState } from 'react';
import { buildQVMRForDispatch, qvmrActionToVerdict } from '../quant/qvmrAdapter.js';

/**
 * Task 3 改进：
 * - dataCoverage < MIN_COVERAGE_FOR_VERDICT 时不出分数，UI 显示"数据不足"
 * - dataCoverage 在 MIN_COVERAGE_FOR_VERDICT ~ SAFE_COVERAGE 之间出分但加灰色警告
 * - dataCoverage >= SAFE_COVERAGE 时正常展示
 *
 * 原因：QVMR 配置里很多 signal 在没接入指数 / 行业 / 估值分位数据时永远是 false。
 *       这会系统性地把所有股票打成"持有或降仓"，比没分数更糟糕——会让人误以为
 *       系统真的算过了，从而相信一个本质是"全部 null 默认 false"的虚假结论。
 */
const MIN_COVERAGE_FOR_VERDICT = 50;
const SAFE_COVERAGE = 75;

const MANUAL_GROUPS = [
  {
    title: '市场环境',
    items: [
      ['hs300AboveMA60', '沪深 300 在 MA60 上方'],
      ['zz500AboveMA60', '中证 500 在 MA60 上方'],
      ['allAAmountAboveMA20', '全 A 成交额高于 20 日均值'],
      ['advancersMoreThanDecliners', '上涨家数多于下跌家数'],
    ],
  },
  {
    title: '行业强度',
    items: [
      ['industryReturn20dTop30', '行业 20 日涨幅前 30%'],
      ['industryReturn60dTop30', '行业 60 日涨幅前 30%'],
      ['industryAmountAboveMA20', '行业成交额高于 20 日均值'],
      ['industryNewHighOrLimitUpIncreasing', '行业新高或涨停扩散'],
      ['return20dBeatsIndustry', '20 日涨幅强于行业'],
    ],
  },
  {
    title: '人工补充',
    items: [
      ['unlockOrShareholderReductionRisk', '解禁或减持风险'],
      ['earningsWarningOrGuidanceCut', '业绩预警或盈利下修'],
      ['return20dAbove50pct', '近 20 日涨幅超过 50%'],
      ['marginBalanceRisingButPriceFlat', '融资上升但股价横盘'],
      ['valuationBelow70pctHistoricalPercentile', '估值低于自身 70% 分位'],
    ],
  },
];

const STORAGE_KEY = 'dispatch:qvmr-manual:v1';

function loadManualMap() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveManualMap(map) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

const actionCN = (action) => ({
  STRONG_BUY: '强买',
  BUY: '买入',
  WATCH: '观察',
  HOLD_OR_REDUCE: '持有或降仓',
  REDUCE: '降仓',
  EXIT: '退出',
  NO_TRADE: '不开仓',
}[action] || action || '—');

const verdictCN = (v) => (v === 'BUY' ? '买入' : v === 'SELL' ? '卖出' : v === 'HOLD' ? '持有' : '—');

const pct = (v) => `${Math.round((v || 0) * 100)}%`;

export const QVMRPanel = ({ stockData, klineData, financialsData, editorState }) => {
  const [manualMap, setManualMap] = useState({});
  const code = stockData?.code || '';
  const manualSignals = useMemo(() => manualMap[code] || {}, [manualMap, code]);

  useEffect(() => {
    setManualMap(loadManualMap());
  }, []);

  const result = useMemo(
    () => buildQVMRForDispatch({ stockData, klineData, financialsData, manualSignals }),
    [stockData, klineData, financialsData, manualSignals]
  );

  if (!stockData || !result) return null;

  const { qvmr, explanation, dataCoverage } = result;
  const editorVerdict = editorState?.status === 'done' ? editorState.data?.verdict : null;
  const qvmrVerdict = qvmrActionToVerdict(qvmr.action);
  const isOverride = editorVerdict && editorVerdict !== qvmrVerdict && (qvmr.hardRules.mustExit || !qvmr.hardRules.allowNewPosition);

  const insufficient = dataCoverage < MIN_COVERAGE_FOR_VERDICT;
  const partial = dataCoverage < SAFE_COVERAGE && !insufficient;

  const updateManual = (key, checked) => {
    const next = {
      ...manualMap,
      [code]: { ...(manualMap[code] || {}), [key]: checked },
    };
    setManualMap(next);
    saveManualMap(next);
  };

  const resetManual = () => {
    const next = { ...manualMap };
    delete next[code];
    setManualMap(next);
    saveManualMap(next);
  };

  /* ── insufficient: 不出分数，直接显示"数据不足"卡片 ───────── */
  if (insufficient) {
    return (
      <section className="qvmr-panel fade-up">
        <div className="qvmr-head">
          <div>
            <div className="mono small-caps qvmr-kicker">QVMR · 交 易 纪 律 裁 判</div>
            <h3 className="display-serif qvmr-title">QVMR 交易裁决</h3>
          </div>
          <div className="qvmr-action qvmr-action--insufficient">
            <span>数据不足</span>
            <strong>—</strong>
          </div>
        </div>

        <div className="qvmr-body">
          <div className="qvmr-insufficient-block">
            <div className="qvmr-insufficient-title">⚠ 数据覆盖率 {dataCoverage}%，不出具结论</div>
            <div className="qvmr-insufficient-body">
              QVMR 评分需要市场、行业、估值分位等数据才能给出有效结论。
              当前可自动获取的信号不到一半。强行打分会因为大量信号缺失被默认当作"未满足"，
              系统性把所有股票判成"持有或降仓"——这比不打分更糟糕，因为会让人误以为系统真的算过了。
            </div>
            <div className="qvmr-insufficient-hint">
              下面可以手动补全已知的市场 / 行业 / 公告信号。勾选数量足够时会自动出分。
            </div>
          </div>

          <details className="qvmr-manual" open>
            <summary>
              <span>手动补全市场、行业和公告风险</span>
              <em>当前自动覆盖约 {dataCoverage}%</em>
            </summary>
            <div className="qvmr-manual-grid">
              {MANUAL_GROUPS.map((group) => (
                <div className="qvmr-manual-group" key={group.title}>
                  <h4>{group.title}</h4>
                  {group.items.map(([key, label]) => (
                    <label key={key} className="qvmr-check">
                      <input
                        type="checkbox"
                        checked={manualSignals[key] === true}
                        onChange={(e) => updateManual(key, e.target.checked)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <button className="btn-ghost qvmr-reset" onClick={resetManual}>清空手动信号</button>
          </details>
        </div>
      </section>
    );
  }

  /* ── partial / safe: 出分数，但 partial 时加 banner ─────── */
  const sections = [
    ['市场', qvmr.breakdown.marketScore, 20],
    ['行业', qvmr.breakdown.industryScore, 20],
    ['动量', qvmr.breakdown.momentumScore, 25],
    ['成交', qvmr.breakdown.volumeScore, 15],
    ['质量', qvmr.breakdown.qualityScore, 15],
    ['风险扣分', -qvmr.breakdown.penalty, -20],
  ];

  return (
    <section className={`qvmr-panel fade-up ${partial ? 'qvmr-panel--partial' : ''}`}>
      <div className="qvmr-head">
        <div>
          <div className="mono small-caps qvmr-kicker">
            QVMR · 交 易 纪 律 裁 判
            {partial && <span className="qvmr-coverage-warn"> · 数据覆盖 {dataCoverage}%，结论偏保守</span>}
          </div>
          <h3 className="display-serif qvmr-title">QVMR 交易裁决</h3>
        </div>
        <div className={`qvmr-action qvmr-action--${qvmr.action}`}>
          <span>{actionCN(qvmr.action)}</span>
          <strong>{qvmr.score}</strong>
        </div>
      </div>

      <div className="qvmr-body">
        {partial && (
          <div className="qvmr-partial-banner">
            ⓘ 自动信号覆盖率 <strong>{dataCoverage}%</strong>。
            未获取到的市场和行业信号被默认按"未满足"处理，因此分数偏保守。
            可在下方手动补全已知信号以提升结论可信度。
          </div>
        )}

        <div className="qvmr-verdict-row">
          <div>
            <span>主编观点</span>
            <strong>{verdictCN(editorVerdict)}</strong>
          </div>
          <div>
            <span>QVMR 裁决</span>
            <strong>{actionCN(qvmr.action)}</strong>
          </div>
          <div>
            <span>建议单票仓位</span>
            <strong>{pct(qvmr.suggestedPosition)}</strong>
          </div>
          <div>
            <span>总仓位区间</span>
            <strong>{pct(qvmr.suggestedPortfolioExposure.min)}-{pct(qvmr.suggestedPortfolioExposure.max)}</strong>
          </div>
        </div>

        {isOverride && (
          <div className="qvmr-hard-warning">
            QVMR hardRules 已覆盖 AI 观点。交易动作以纪律裁决为准。
          </div>
        )}

        <div className="qvmr-score-grid">
          {sections.map(([label, value, max]) => (
            <div className="qvmr-score-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <small>{max > 0 ? `/ ${max}` : '扣分'}</small>
            </div>
          ))}
        </div>

        <div className="qvmr-explain-grid">
          <div>
            <h4>已满足信号</h4>
            <ul>
              {explanation.strengths.slice(0, 8).map((item) => <li key={item}>{item}</li>)}
              {explanation.strengths.length === 0 && <li>自动信号不足，先按缺失处理。</li>}
            </ul>
          </div>
          <div>
            <h4>硬规则</h4>
            <ul>
              {(qvmr.hardRules.blockReason.length ? qvmr.hardRules.blockReason : ['未触发硬性阻断']).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <details className="qvmr-manual">
          <summary>
            <span>手动补全市场、行业和公告风险</span>
            <em>当前自动覆盖约 {dataCoverage}%</em>
          </summary>
          <div className="qvmr-manual-grid">
            {MANUAL_GROUPS.map((group) => (
              <div className="qvmr-manual-group" key={group.title}>
                <h4>{group.title}</h4>
                {group.items.map(([key, label]) => (
                  <label key={key} className="qvmr-check">
                    <input
                      type="checkbox"
                      checked={manualSignals[key] === true}
                      onChange={(e) => updateManual(key, e.target.checked)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <button className="btn-ghost qvmr-reset" onClick={resetManual}>清空手动信号</button>
        </details>
      </div>
    </section>
  );
};
