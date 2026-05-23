/* ──────────────────────────────────────────────────────────────────
   EVOLUTION TIMELINE · 同一只股票多次分析的演化时间线
   - 节点 = 每次议会，颜色编码 verdict，粗细编码 conviction
   - 上方覆盖股价走势 sparkline
   - 节点可展开看 headline + key_sentence + 主编 grades
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useMemo } from 'react';
import { backfillStatus } from '../lib/scoring';

const VERDICT_COLOR = {
  BUY:  '#7BB89A',  // var(--buy)
  HOLD: '#D4B26A',  // var(--hold)
  SELL: '#D77B6A',  // var(--sell)
};
const VERDICT_CN = { BUY: '买入', HOLD: '持有', SELL: '卖出' };

/**
 * @param {Array} entries  全部 history 条目（任意 ticker）
 * @param {string} ticker  当前股票代码
 * @returns 按 ticker 过滤、按时间升序排列的条目（最早在前）
 */
function entriesForTicker(entries, ticker) {
  if (!Array.isArray(entries) || !ticker) return [];
  return entries
    .filter((e) => e.ticker === ticker || e.stockData?.code === ticker)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtRelative(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 90) return `${Math.floor(days / 7)} 周前`;
  return `${Math.floor(days / 30)} 个月前`;
}

// Conviction → marker size (px diameter)
function markerSize(c) {
  const cl = Math.max(1, Math.min(5, c || 3));
  return 12 + cl * 4; // 16/20/24/28/32
}

// Build a sparkline path of editor verdicts converted to a numeric axis
// BUY=+1, HOLD=0, SELL=-1, weighted by conviction
function buildSparkline(entries) {
  if (entries.length < 2) return null;
  const points = entries.map((e, i) => {
    const v = e.editorState?.data?.verdict;
    const c = e.editorState?.data?.conviction || 3;
    const score = v === 'BUY' ? 1 : v === 'SELL' ? -1 : 0;
    return { x: i, y: score * (c / 5) };
  });

  const minY = -1;
  const maxY = 1;
  const w = 600;
  const h = 60;
  const xStep = w / Math.max(1, points.length - 1);
  return points
    .map((p, i) => {
      const x = i * xStep;
      const y = h - ((p.y - minY) / (maxY - minY)) * h;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

const TimelineNode = ({ entry, idx, total, expanded, onToggle }) => {
  const v = entry.editorState?.data?.verdict;
  const conviction = entry.editorState?.data?.conviction || 3;
  const color = VERDICT_COLOR[v] || '#888';
  const size = markerSize(conviction);
  const headline = entry.editorState?.data?.headline || '主编未交稿';
  const keySent = entry.editorState?.data?.key_sentence;
  const backfillState = backfillStatus(entry);

  return (
    <div className="evo-node" data-expanded={expanded}>
      <button
        className="evo-node-marker-btn"
        onClick={onToggle}
        aria-label={`第 ${idx + 1} 次分析，${fmtDate(entry.timestamp)}`}
      >
        <span
          className="evo-node-marker"
          style={{
            width: size,
            height: size,
            background: color,
            borderColor: 'var(--ink)',
          }}
        >
          <span className="evo-node-marker-label">{idx + 1}</span>
        </span>
      </button>
      <div className="evo-node-meta">
        <div className="evo-node-date">{fmtDate(entry.timestamp)}</div>
        <div className="evo-node-rel">{fmtRelative(entry.timestamp)}</div>
      </div>
      <div className="evo-node-summary">
        <div className="evo-node-verdict-row">
          {v && (
            <span className="evo-pill" style={{ color, borderColor: color }}>
              {v} · {conviction}/5
            </span>
          )}
          {entry.stockData?.price != null && (
            <span className="evo-price">
              {entry.stockData.market === 'A' ? '¥' : '$'}
              {entry.stockData.price.toFixed(2)}
            </span>
          )}
          {backfillState === 'done' && entry.outcome?.excessReturnPct != null && (
            <span className={`evo-outcome evo-outcome--${
              Math.abs(entry.outcome.excessReturnPct) < 1 ? 'tie'
              : entry.outcome.excessReturnPct > 0 ? 'up' : 'down'
            }`}>
              30 日后超额 {entry.outcome.excessReturnPct >= 0 ? '+' : ''}
              {entry.outcome.excessReturnPct.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="evo-node-headline">{headline}</div>

        {expanded && (
          <div className="evo-node-expanded">
            {keySent && (
              <div className="evo-node-keysent">
                <span className="evo-keysent-bar" aria-hidden="true" />
                <span>{keySent}</span>
              </div>
            )}
            {entry.editorState?.data?.watchpoint && (
              <div className="evo-node-watchpoint">
                <span className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)' }}>
                  关注点 · 
                </span>
                <span>{entry.editorState.data.watchpoint}</span>
              </div>
            )}
            <div className="evo-node-detail-grid">
              {entry.stockData?.pe != null && (
                <div className="evo-detail-cell">
                  <div className="evo-detail-label">PE</div>
                  <div className="evo-detail-value">{entry.stockData.pe.toFixed(1)}</div>
                </div>
              )}
              {entry.stockData?.pb != null && (
                <div className="evo-detail-cell">
                  <div className="evo-detail-label">PB</div>
                  <div className="evo-detail-value">{entry.stockData.pb.toFixed(2)}</div>
                </div>
              )}
              <div className="evo-detail-cell">
                <div className="evo-detail-label">议会</div>
                <div className="evo-detail-value evo-detail-votes">
                  {(() => {
                    const verdicts = Object.values(entry.analyses || {})
                      .map((a) => a?.data?.verdict).filter(Boolean);
                    const buy = verdicts.filter(x => x === 'BUY').length;
                    const hold = verdicts.filter(x => x === 'HOLD').length;
                    const sell = verdicts.filter(x => x === 'SELL').length;
                    return `${buy}·${hold}·${sell}`;
                  })()}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const EvolutionTimeline = ({ history, ticker, onLoadEntry, mode = 'compact' }) => {
  const entries = useMemo(() => entriesForTicker(history, ticker), [history, ticker]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  if (entries.length === 0) {
    return mode === 'modal' ? (
      <div className="evo-empty">
        <div className="display-serif" style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 6 }}>
          暂无历史档案
        </div>
        <div className="body-serif" style={{ fontSize: '0.88rem', color: 'var(--ink-soft)' }}>
          这只股票还没有过往分析记录。第一次议会完成后，将自动开始留存档案。
        </div>
      </div>
    ) : null;
  }

  if (entries.length === 1 && mode === 'compact') {
    // 只有一次分析，紧凑模式下不显示（没什么"演化"可言）
    return null;
  }

  const toggle = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const sparkPath = buildSparkline(entries);

  return (
    <div className={`evo-wrap evo-wrap--${mode}`}>
      <div className="evo-header">
        <div>
          <div className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', letterSpacing: '0.12em' }}>
            EVOLUTION · 演 化 时 间 线
          </div>
          <div className="display-serif" style={{ fontSize: '1.05rem', fontWeight: 600, marginTop: 4 }}>
            此股已分析 {entries.length} 次 · 跨度 {fmtRelative(entries[0].timestamp)} 至今
          </div>
        </div>
        {mode === 'modal' && (
          <div className="evo-header-meta">
            <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--ink-soft)' }}>
              点击节点展开详情
            </span>
          </div>
        )}
      </div>

      {sparkPath && (
        <div className="evo-spark">
          <svg viewBox="0 0 600 60" width="100%" height="50" preserveAspectRatio="none">
            {/* 0 线 */}
            <line x1="0" y1="30" x2="600" y2="30" stroke="var(--ink-faded)" strokeDasharray="3 3" strokeWidth="1" />
            <text x="2" y="14" fontSize="10" fill="var(--ink-faded)" fontFamily="monospace">BUY</text>
            <text x="2" y="58" fontSize="10" fill="var(--ink-faded)" fontFamily="monospace">SELL</text>
            <path d={sparkPath} fill="none" stroke="var(--accent)" strokeWidth="2" />
          </svg>
        </div>
      )}

      <div className="evo-nodes">
        {entries.map((e, idx) => (
          <TimelineNode
            key={e.id}
            entry={e}
            idx={idx}
            total={entries.length}
            expanded={expandedIds.has(e.id)}
            onToggle={() => toggle(e.id)}
          />
        ))}
      </div>

      {mode === 'modal' && onLoadEntry && (
        <div className="evo-modal-footer">
          <span className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)' }}>
            点击某次分析的"载入"按钮回到当时的完整议会
          </span>
        </div>
      )}
    </div>
  );
};
