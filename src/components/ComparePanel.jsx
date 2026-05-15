/* ──────────────────────────────────────────────────────────────────
   COMPARE PANEL · 多标的并排对比
   - 数据源：tabs（内存中已分析）+ history（持久化）
   - 不发任何新 API 请求；纯派生视图
   - 选 2-4 只→ 并排对比表
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { ANALYSTS } from '../lib/prompts';

const MAX_COMPARE = 4;
const MIN_COMPARE = 2;
const ROLE_ID_TO_CN = { value: '价值派', tech: '技术派', macro: '宏观派', risk: '风险派' };

// 把一个 tab / history entry 归一为对比单元
function normalizeSource(src, kind /* 'tab' | 'history' */) {
  if (!src || !src.stockData) return null;
  return {
    key: kind === 'tab' ? `tab:${src.id}` : `history:${src.id}`,
    kind,
    ticker: src.ticker || src.stockData.code,
    timestamp: src.timestamp || Date.now(),
    stockData: src.stockData,
    analyses: src.analyses || {},
    editorState: src.editorState || null,
  };
}

// 计算每个标的的"快照"（用于对比行）
function buildSnapshot(unit) {
  const sd = unit.stockData;
  const editorData = unit.editorState?.status === 'done' ? unit.editorState.data : null;

  // 4 位分析师 verdict 票数
  const votes = { BUY: 0, HOLD: 0, SELL: 0 };
  const verdictByRole = {};   // { value: 'BUY', ... }
  const convictionByRole = {};
  ANALYSTS.forEach((a) => {
    const st = unit.analyses?.[a.id];
    if (st?.status === 'done') {
      const v = st.data?.verdict;
      if (v && votes[v] != null) votes[v] += 1;
      verdictByRole[a.id] = v;
      convictionByRole[a.id] = st.data?.conviction;
    }
  });

  const successCount = verdictByRole && Object.keys(verdictByRole).length;
  const convictionVals = Object.values(convictionByRole).filter((x) => typeof x === 'number');
  const convictionAvg = convictionVals.length > 0
    ? convictionVals.reduce((a, b) => a + b, 0) / convictionVals.length
    : null;

  // dominant verdict（票数最高的）
  let dominant = null;
  if (votes.BUY > votes.HOLD && votes.BUY > votes.SELL) dominant = 'BUY';
  else if (votes.SELL > votes.HOLD && votes.SELL > votes.BUY) dominant = 'SELL';
  else if (votes.HOLD > 0) dominant = 'HOLD';
  // 平票时取主编立场作 fallback
  if (!dominant && editorData?.verdict) dominant = editorData.verdict;

  // 分歧度：4 票里如果 BUY/SELL 同时存在则分歧=高；否则若有 HOLD 混入则=中；全一致则=低
  let dissent;
  if (votes.BUY > 0 && votes.SELL > 0) dissent = 'high';
  else if (successCount >= 2 && (votes.HOLD > 0 && (votes.BUY > 0 || votes.SELL > 0))) dissent = 'mid';
  else dissent = 'low';

  return {
    name: sd.name,
    code: sd.code,
    market: sd.market,
    price: sd.price,
    changePct: sd.changePct,
    pe: sd.pe,
    pb: sd.pb,
    marketCap: sd.marketCap,
    high52: sd.high52,
    low52: sd.low52,
    votes,
    verdictByRole,
    convictionByRole,
    convictionAvg,
    successCount,
    dominant,
    dissent,
    editorHeadline: editorData?.headline || null,
    editorVerdict: editorData?.verdict || null,
    editorConviction: editorData?.conviction || null,
    editorWatchpoint: editorData?.watchpoint || null,
    topKeyPoints: collectTopKeyPoints(unit.analyses, 3),
    topRisks: collectTopRisks(unit.analyses, 2),
    timestamp: unit.timestamp,
    kind: unit.kind,
  };
}

function collectTopKeyPoints(analyses, limit) {
  const points = [];
  ANALYSTS.forEach((a) => {
    const st = analyses?.[a.id];
    if (st?.status === 'done' && Array.isArray(st.data?.key_points)) {
      st.data.key_points.forEach((p) => {
        if (p && typeof p === 'string') points.push({ from: a.cnName, text: p });
      });
    }
  });
  return points.slice(0, limit);
}

function collectTopRisks(analyses, limit) {
  const risks = [];
  ANALYSTS.forEach((a) => {
    const st = analyses?.[a.id];
    if (st?.status === 'done' && st.data?.risk) {
      risks.push({ from: a.cnName, text: st.data.risk });
    }
  });
  return risks.slice(0, limit);
}

// 判断一行的"分歧度"：跨标的的取值是否完全相同
function rowHasDivergence(values) {
  if (!values || values.length < 2) return false;
  const nonEmpty = values.filter((v) => v != null && v !== '—' && v !== '');
  if (nonEmpty.length < 2) return false;
  const first = JSON.stringify(nonEmpty[0]);
  return nonEmpty.some((v) => JSON.stringify(v) !== first);
}

// Util — 格式化
const fmtPrice = (snap) => {
  if (snap.price == null) return '—';
  const ccy = snap.market === 'A' ? '¥' : '$';
  return `${ccy}${snap.price.toFixed(2)}`;
};
const fmtPct = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const fmtNum = (n, digits = 1) => (n == null ? '—' : n.toFixed(digits));
const fmtMcap = (n, market) => {
  if (n == null) return '—';
  return market === 'A' ? `¥${(n / 1e8).toFixed(0)}亿` : `$${(n / 1e9).toFixed(1)}B`;
};

const verdictColor = (v) =>
  v === 'BUY' ? 'var(--buy-light)' : v === 'SELL' ? 'var(--sell-light)' : v === 'HOLD' ? 'var(--hold-light)' : 'var(--ink-faded)';

const verdictBg = (v) =>
  v === 'BUY' ? 'rgba(123,184,154,0.18)' : v === 'SELL' ? 'rgba(215,123,106,0.16)' : v === 'HOLD' ? 'rgba(212,178,106,0.16)' : 'transparent';

const dissentLabel = (level) =>
  level === 'high' ? '分歧大' : level === 'mid' ? '有分歧' : '基本一致';

export const ComparePanel = ({ expanded, onToggle, tabs, history, onSelectInMain }) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);

  // 候选源：tabs（已分析过）+ history 里 tabs 没覆盖的
  const candidates = useMemo(() => {
    const list = [];
    const seen = new Set();
    (tabs || []).forEach((t) => {
      const u = normalizeSource(t, 'tab');
      if (!u) return;
      // 至少 1 位分析师交了稿才有意义
      const done = Object.values(u.analyses).filter((a) => a?.status === 'done').length;
      if (done === 0) return;
      list.push(u);
      seen.add(u.ticker);
    });
    (history || []).forEach((h) => {
      if (seen.has(h.ticker)) return;
      const u = normalizeSource(h, 'history');
      if (!u) return;
      const done = Object.values(u.analyses).filter((a) => a?.status === 'done').length;
      if (done === 0) return;
      list.push(u);
      seen.add(u.ticker);
    });
    // 按时间倒序
    list.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    return list;
  }, [tabs, history]);

  // 默认选中当前 tabs（不超过 MAX）
  const defaultSelected = useMemo(() => {
    const out = [];
    candidates.forEach((c) => {
      if (c.kind === 'tab' && out.length < MAX_COMPARE) out.push(c.key);
    });
    return out;
  }, [candidates]);

  const [selectedKeys, setSelectedKeys] = useState(defaultSelected);

  // expanded 时同步默认选中
  useEffect(() => {
    if (expanded) setSelectedKeys(defaultSelected);
  }, [expanded, defaultSelected]);

  if (!expanded) return null;

  const toggleSelect = (key) => {
    setSelectedKeys((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_COMPARE) {
        // 满了，挤掉最旧的
        return [...prev.slice(1), key];
      }
      return [...prev, key];
    });
  };

  const selectedUnits = candidates.filter((c) => selectedKeys.includes(c.key));
  const snapshots = selectedUnits.map(buildSnapshot);
  const enoughToCompare = snapshots.length >= MIN_COMPARE;

  // 行定义：每行一个对比维度。divergent 字段单元会高亮
  const rows = !enoughToCompare ? [] : [
    {
      label: '主流派结论',
      cells: snapshots.map((s) => (
        <span className="cmp-verdict-cell" style={{ background: verdictBg(s.dominant), color: verdictColor(s.dominant) }}>
          {s.dominant || '—'}
          {s.dominant && (
            <span className="cmp-vote-mini">
              {s.votes.BUY}/{s.votes.HOLD}/{s.votes.SELL}
            </span>
          )}
        </span>
      )),
      values: snapshots.map((s) => s.dominant),
    },
    {
      label: '主编最终',
      cells: snapshots.map((s) => (
        <span className="cmp-verdict-cell" style={{ background: verdictBg(s.editorVerdict), color: verdictColor(s.editorVerdict) }}>
          {s.editorVerdict || '主编未出'}
          {s.editorConviction != null && (
            <span className="cmp-vote-mini">★{s.editorConviction}/5</span>
          )}
        </span>
      )),
      values: snapshots.map((s) => s.editorVerdict),
    },
    {
      label: '内部分歧度',
      cells: snapshots.map((s) => (
        <span className={`cmp-dissent cmp-dissent--${s.dissent}`}>
          {dissentLabel(s.dissent)}
        </span>
      )),
      values: snapshots.map((s) => s.dissent),
    },
    {
      label: '平均信心',
      cells: snapshots.map((s) => (
        <span className="cmp-cell-text mono">
          {s.convictionAvg == null ? '—' : `${s.convictionAvg.toFixed(1)} / 5`}
        </span>
      )),
      values: snapshots.map((s) => s.convictionAvg != null ? s.convictionAvg.toFixed(1) : null),
    },
    { rowDivider: true },
    {
      label: '现价',
      cells: snapshots.map((s) => <span className="cmp-cell-text mono">{fmtPrice(s)}</span>),
      values: snapshots.map((s) => s.price),
    },
    {
      label: '今日涨跌',
      cells: snapshots.map((s) => (
        <span className="cmp-cell-text mono" style={{ color: (s.changePct || 0) >= 0 ? 'var(--buy)' : 'var(--sell)' }}>
          {fmtPct(s.changePct)}
        </span>
      )),
      values: snapshots.map((s) => (s.changePct == null ? null : Math.sign(s.changePct))),
    },
    {
      label: 'PE',
      cells: snapshots.map((s) => <span className="cmp-cell-text mono">{fmtNum(s.pe)}</span>),
      values: snapshots.map((s) => (s.pe == null ? null : Math.round(s.pe))),
    },
    {
      label: 'PB',
      cells: snapshots.map((s) => <span className="cmp-cell-text mono">{fmtNum(s.pb, 2)}</span>),
      values: snapshots.map((s) => (s.pb == null ? null : s.pb.toFixed(1))),
    },
    {
      label: '市值',
      cells: snapshots.map((s) => <span className="cmp-cell-text mono">{fmtMcap(s.marketCap, s.market)}</span>),
      values: snapshots.map((s) => s.marketCap),
    },
    { rowDivider: true },
    {
      label: '主编头条',
      cells: snapshots.map((s) => (
        <div className="cmp-cell-prose">{s.editorHeadline || '—'}</div>
      )),
      values: snapshots.map((s) => s.editorHeadline),
    },
    {
      label: '关注点',
      cells: snapshots.map((s) => (
        <div className="cmp-cell-prose cmp-cell-prose--watch">{s.editorWatchpoint || '—'}</div>
      )),
      values: snapshots.map((s) => s.editorWatchpoint),
    },
    {
      label: '热门论点',
      cells: snapshots.map((s) => (
        <div className="cmp-keypoints">
          {s.topKeyPoints.length === 0 ? '—' : s.topKeyPoints.map((p, i) => (
            <div key={i} className="cmp-keypoint">
              <span className="cmp-keypoint-from">{p.from}</span>
              <span className="cmp-keypoint-text">{p.text}</span>
            </div>
          ))}
        </div>
      )),
      values: snapshots.map((s) => s.topKeyPoints.map((p) => p.text).join('|')),
    },
    {
      label: '主要风险',
      cells: snapshots.map((s) => (
        <div className="cmp-keypoints">
          {s.topRisks.length === 0 ? '—' : s.topRisks.map((r, i) => (
            <div key={i} className="cmp-keypoint cmp-keypoint--risk">
              <span className="cmp-keypoint-from">{r.from}</span>
              <span className="cmp-keypoint-text">{r.text}</span>
            </div>
          ))}
        </div>
      )),
      values: snapshots.map((s) => s.topRisks.map((r) => r.text).join('|')),
    },
    { rowDivider: true },
    {
      label: '四派立场',
      cells: snapshots.map((s) => (
        <div className="cmp-roles">
          {['value', 'tech', 'macro', 'risk'].map((id) => {
            const v = s.verdictByRole[id];
            return (
              <div key={id} className="cmp-role-row">
                <span className="cmp-role-name">{ROLE_ID_TO_CN[id]}</span>
                <span className="cmp-role-verdict" style={{ color: verdictColor(v) }}>
                  {v || '—'}
                </span>
              </div>
            );
          })}
        </div>
      )),
      values: snapshots.map((s) => JSON.stringify(s.verdictByRole)),
    },
  ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onToggle}>
      <div ref={containerRef} className="modal-container cmp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
              横向对比
            </div>
            <div
              className="mono small-caps"
              style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
            >
              CROSS · 选 {MIN_COMPARE}–{MAX_COMPARE} 只并排比较（复用已分析数据，零 API 调用）
            </div>
          </div>
          <button
            onClick={onToggle}
            className="modal-close"
            aria-label="关闭"
            title="关闭"
          >
            ✕
          </button>
        </div>

        <div className="modal-body" style={{ padding: 0 }}>
          {/* 候选选择条 */}
          <div className="cmp-picker">
            <div className="cmp-picker-header">
              <span className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)' }}>
                ◆ 候 选 · {candidates.length} 只可选 · 已选 {selectedKeys.length}/{MAX_COMPARE}
              </span>
            </div>
            {candidates.length === 0 ? (
              <div className="cmp-empty">
                还没有任何已分析的标的。先在主页召集议会分析几只，再回来对比。
              </div>
            ) : (
              <div className="cmp-candidates">
                {candidates.map((c) => {
                  const isSelected = selectedKeys.includes(c.key);
                  return (
                    <button
                      key={c.key}
                      className={`cmp-candidate ${isSelected ? 'cmp-candidate--selected' : ''}`}
                      onClick={() => toggleSelect(c.key)}
                      type="button"
                    >
                      <span className="cmp-candidate-name">{c.stockData.name}</span>
                      <span className="cmp-candidate-code">{c.stockData.code}</span>
                      <span className="cmp-candidate-mkt">{c.stockData.market === 'A' ? 'A股' : '美股'}</span>
                      {c.kind === 'history' && (
                        <span className="cmp-candidate-kind">档案</span>
                      )}
                      {isSelected && <span className="cmp-candidate-check">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 对比主体 */}
          {!enoughToCompare ? (
            <div className="cmp-hint">
              {selectedKeys.length === 0
                ? '请勾选至少 2 只标的开始对比'
                : `还差 ${MIN_COMPARE - selectedKeys.length} 只`}
            </div>
          ) : (
            <div className="cmp-table-wrap">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th className="cmp-th-label">维度</th>
                    {snapshots.map((s, i) => (
                      <th key={i} className="cmp-th-stock">
                        <button
                          className="cmp-th-stock-btn"
                          onClick={() => {
                            // 点击表头切换主页 tab 到这只
                            const unit = selectedUnits[i];
                            if (onSelectInMain && unit?.kind === 'tab') {
                              onSelectInMain(unit.ticker);
                              onToggle();
                            }
                          }}
                          title={selectedUnits[i].kind === 'tab' ? '切换主页到此标的' : ''}
                          type="button"
                        >
                          <div className="cmp-th-name">{s.name}</div>
                          <div className="cmp-th-meta">
                            <span className="cmp-th-code">{s.code}</span>
                            <span className="cmp-th-mkt">{s.market === 'A' ? 'A股' : '美股'}</span>
                          </div>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => {
                    if (row.rowDivider) {
                      return (
                        <tr key={ri} className="cmp-row-divider">
                          <td colSpan={snapshots.length + 1} />
                        </tr>
                      );
                    }
                    const divergent = rowHasDivergence(row.values);
                    return (
                      <tr key={ri} className={divergent ? 'cmp-row cmp-row--diverge' : 'cmp-row'}>
                        <td className="cmp-td-label">
                          {row.label}
                          {divergent && <span className="cmp-diverge-mark" title="此维度跨标的取值不同">⚡</span>}
                        </td>
                        {row.cells.map((cell, ci) => (
                          <td key={ci} className="cmp-td">{cell}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="cmp-footer-hint">
                <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--ink-faded)' }}>
                  ⚡ 标记 = 跨标的取值不同的维度；这是对比最有价值的地方
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
