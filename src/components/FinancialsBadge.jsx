/* ──────────────────────────────────────────────────────────────────
   FINANCIALS BADGE · 最近 4 季度财务 sparkline + 可展开表格
   - 紧凑模式：3 个 mini sparkline（营收、利润、ROE）
   - 点击展开看完整表格
   ────────────────────────────────────────────────────────────────── */

import React, { useState } from 'react';

const pctFmt = (v) => {
  if (v == null) return '—';
  const p = v * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
};

const numFmt = (v, market) => {
  if (v == null) return '—';
  if (market === 'A') {
    if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(1)}亿`;
    if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(0)}万`;
    return v.toFixed(0);
  } else {
    if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
    if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
    return v.toFixed(0);
  }
};

const ratioFmt = (v) => v == null ? '—' : v.toFixed(2);

// Mini sparkline: takes [v1, v2, v3, v4] (oldest to newest)
const Sparkline = ({ values, w = 64, h = 18 }) => {
  const valid = values.filter((v) => v != null);
  if (valid.length < 2) return <span className="fin-spark-empty">—</span>;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const xStep = w / (values.length - 1);
  const points = values
    .map((v, i) => {
      if (v == null) return null;
      const x = i * xStep;
      const y = h - ((v - min) / range) * h;
      return { x, y, value: v };
    })
    .filter(Boolean);
  const path = points
    .map((p, i) => (i === 0 ? `M ${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`))
    .join(' ');
  // 趋势颜色：最后一个 vs 第一个
  const first = valid[0];
  const last = valid[valid.length - 1];
  const lastPoint = points[points.length - 1];
  const trendUp = last > first;
  return (
    <svg width={w} height={h} className="fin-spark">
      <path d={path} fill="none" stroke={trendUp ? 'var(--buy)' : 'var(--sell)'} strokeWidth="1.5" />
      <circle cx={lastPoint.x} cy={lastPoint.y} r="2" fill={trendUp ? 'var(--buy)' : 'var(--sell)'} />
    </svg>
  );
};

export const FinancialsBadge = ({ financialsData }) => {
  const [expanded, setExpanded] = useState(false);

  if (!financialsData || !Array.isArray(financialsData.quarters) || financialsData.quarters.length === 0) {
    if (financialsData?.hasMissingKey) {
      // 不重复 EventsBadge 已经的提示
      return null;
    }
    return null;
  }
  const quarters = financialsData.quarters;
  const market = financialsData.market;
  // 倒序：最旧在左，最新在右，用于 sparkline
  const reversed = [...quarters].reverse();

  return (
    <div className="fin-badge">
      <button
        className="fin-badge-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="点击展开完整财务表"
      >
        <span className="mono small-caps fin-badge-label">最近 4Q 财务</span>
        <span className="fin-mini-row">
          <span className="fin-mini">
            <span className="fin-mini-label">营收</span>
            <Sparkline values={reversed.map((q) => q.revenue)} />
            <span className="fin-mini-last">{numFmt(reversed[reversed.length - 1].revenue, market)}</span>
          </span>
          <span className="fin-mini">
            <span className="fin-mini-label">净利</span>
            <Sparkline values={reversed.map((q) => q.netIncome)} />
            <span className="fin-mini-last">{numFmt(reversed[reversed.length - 1].netIncome, market)}</span>
          </span>
          <span className="fin-mini">
            <span className="fin-mini-label">ROE</span>
            <Sparkline values={reversed.map((q) => q.roe)} />
            <span className="fin-mini-last">{pctFmt(reversed[reversed.length - 1].roe)}</span>
          </span>
        </span>
        <span className="fin-badge-toggle">{expanded ? '收起 ▴' : '展开 ▾'}</span>
      </button>

      {expanded && (
        <div className="fin-badge-table">
          <table className="fin-table">
            <thead>
              <tr>
                <th></th>
                {quarters.map((q, i) => (
                  <th key={i}>
                    {i === 0 ? '最新' : `T-${i}`}<br />
                    <span className="fin-table-period">{q.period}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="fin-row-label">营收</td>
                {quarters.map((q, i) => <td key={i}>{numFmt(q.revenue, market)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">营收 YoY</td>
                {quarters.map((q, i) => <td key={i} className={q.revenueYoY != null && q.revenueYoY < 0 ? 'fin-neg' : ''}>{pctFmt(q.revenueYoY)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">净利润</td>
                {quarters.map((q, i) => <td key={i}>{numFmt(q.netIncome, market)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">净利 YoY</td>
                {quarters.map((q, i) => <td key={i} className={q.netIncomeYoY != null && q.netIncomeYoY < 0 ? 'fin-neg' : ''}>{pctFmt(q.netIncomeYoY)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">毛利率</td>
                {quarters.map((q, i) => <td key={i}>{pctFmt(q.grossMargin)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">净利率</td>
                {quarters.map((q, i) => <td key={i}>{pctFmt(q.netMargin)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">ROE</td>
                {quarters.map((q, i) => <td key={i}>{pctFmt(q.roe)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">资产负债率</td>
                {quarters.map((q, i) => <td key={i}>{pctFmt(q.debtRatio)}</td>)}
              </tr>
              <tr>
                <td className="fin-row-label">经营现金/净利</td>
                {quarters.map((q, i) => <td key={i}>{ratioFmt(q.cfoToNI)}</td>)}
              </tr>
            </tbody>
          </table>
          <div className="fin-table-note">
            数据来源：{market === 'A' ? '东方财富' : 'Finnhub / SEC'} · 缓存 12 小时
          </div>
        </div>
      )}
    </div>
  );
};
