/* ──────────────────────────────────────────────────────────────────
   HISTORY PANEL · 历史档案面板
   ────────────────────────────────────────────────────────────────── */

import React, { useRef, useState, useMemo } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { HISTORY_MAX } from '../lib/storage';

export const HistoryPanel = ({ expanded, onToggle, history, onLoad, onDelete, onClearAll, onExport }) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
  const [filter, setFilter] = useState('');
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return history;
    return history.filter((e) => {
      const name = (e.stockData?.name || '').toLowerCase();
      const code = (e.stockData?.code || e.ticker || '').toLowerCase();
      return name.includes(q) || code.includes(q);
    });
  }, [history, filter]);
  if (!expanded) return null;

  const formatTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now - d;
    const diffH = Math.floor(diffMs / 3600000);
    const diffD = Math.floor(diffMs / 86400000);
    if (diffMs < 60000) return '刚刚';
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)} 分钟前`;
    if (diffH < 24) return `${diffH} 小时前`;
    if (diffD < 7) return `${diffD} 天前`;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 统计每条历史的多空票数
  const tally = (entry) => {
    const done = Object.values(entry.analyses || {}).filter((a) => a?.status === 'done');
    const buy = done.filter((d) => d.data.verdict === 'BUY').length;
    const hold = done.filter((d) => d.data.verdict === 'HOLD').length;
    const sell = done.filter((d) => d.data.verdict === 'SELL').length;
    return { buy, hold, sell, total: done.length };
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onToggle}>
      <div ref={containerRef} className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">历史档案</div>
            <div className="modal-subtitle">
              ARCHIVE · 历 次 议 会 记 录（最多保留 {HISTORY_MAX} 条）
            </div>
          </div>
          <button className="modal-close" onClick={onToggle} aria-label="关闭">×</button>
        </div>

        <div className="modal-body">
          {history.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-kicker">ARCHIVE · 00</div>
              <div className="empty-state-title">档案柜空空如也</div>
              <div className="empty-state-hint">完成首次分析后，会自动归档至此供日后查阅</div>
              <button type="button" className="empty-state-action" onClick={onToggle}>
                返回议事厅 →
              </button>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16, display: 'flex', gap: 14, alignItems: 'center' }}>
                <input
                  className="panel-filter"
                  type="search"
                  placeholder="筛选：名称或代码…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="筛选历史记录"
                  style={{ flex: 1 }}
                />
                <span className="mono" style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                  {filter ? `${visible.length} / ${history.length} 条` : `共 ${history.length} 条`}
                </span>
                <button onClick={onClearAll} className="list-btn list-btn--danger">清空档案</button>
              </div>

              {visible.length === 0 && (
                <div className="empty-state" style={{ padding: '24px 0' }}>
                  <div className="empty-state-hint">没有匹配「{filter}」的记录</div>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {visible.map((entry) => {
                  const t = tally(entry);
                  const editorVerdict = entry.editorState?.data?.verdict;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        border: '1px solid var(--ink-faded)',
                        background: 'var(--card-bg-strong)',
                        padding: '12px 14px',
                        display: 'grid',
                        gridTemplateColumns: '1fr auto',
                        gap: 12,
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span
                            className="display-serif"
                            style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--ink)' }}
                          >
                            {entry.stockData?.name || entry.ticker}
                          </span>
                          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', letterSpacing: '0.1em' }}>
                            {entry.stockData?.code || entry.ticker}
                          </span>
                          <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-faded)', letterSpacing: '0.06em' }}>
                            · {formatTime(entry.timestamp)}
                          </span>
                        </div>
                        <div className="mono" style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', letterSpacing: '0.05em' }}>
                          <span style={{ color: 'var(--buy)', fontWeight: 700 }}>{t.buy}</span>
                          <span style={{ margin: '0 4px', color: 'var(--ink-faded)' }}>·</span>
                          <span style={{ color: 'var(--hold)', fontWeight: 700 }}>{t.hold}</span>
                          <span style={{ margin: '0 4px', color: 'var(--ink-faded)' }}>·</span>
                          <span style={{ color: 'var(--sell)', fontWeight: 700 }}>{t.sell}</span>
                          <span style={{ marginLeft: 8, color: 'var(--ink-faded)' }}>B·H·S</span>
                          {editorVerdict && (
                            <>
                              <span style={{ margin: '0 8px', color: 'var(--ink-faded)' }}>|</span>
                              <span style={{ color: 'var(--ink-faded)' }}>主编：</span>
                              <span style={{
                                color: editorVerdict === 'BUY' ? 'var(--buy)' :
                                       editorVerdict === 'SELL' ? 'var(--sell)' : 'var(--hold)',
                                fontWeight: 700,
                              }}>
                                {editorVerdict}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => onLoad(entry.id)} className="list-btn list-btn--primary">查阅</button>
                        <button onClick={() => onExport && onExport(entry.id)} className="list-btn">导出</button>
                        <button onClick={() => onDelete(entry.id)} className="list-btn list-btn--quiet" aria-label="删除">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
