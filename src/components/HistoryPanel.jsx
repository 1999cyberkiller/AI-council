/* ──────────────────────────────────────────────────────────────────
   HISTORY PANEL · 历史档案面板
   ────────────────────────────────────────────────────────────────── */

import React, { useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { HISTORY_MAX } from '../lib/storage';

export const HistoryPanel = ({ expanded, onToggle, history, onLoad, onDelete, onClearAll }) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
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
            <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
              历史档案
            </div>
            <div
              className="mono small-caps"
              style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
            >
              ARCHIVE · 历 次 议 会 记 录（最多保留 {HISTORY_MAX} 条）
            </div>
          </div>
          <button className="modal-close" onClick={onToggle} aria-label="关闭">×</button>
        </div>

        <div className="modal-body">
          {history.length === 0 ? (
            <div
              className="text-center body-serif"
              style={{ padding: '40px 0', color: 'var(--ink-faded)' }}
            >
              <div className="ornament" style={{ marginBottom: 16, fontSize: '1.5rem' }}>❦</div>
              <div className="display-serif" style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6, color: 'var(--ink-soft)' }}>
                档案柜空空如也
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                完成首次分析后，会自动归档至此供日后查阅
              </div>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="mono" style={{ fontSize: '0.74rem', color: 'var(--ink-soft)', letterSpacing: '0.08em' }}>
                  共 {history.length} 条记录
                </div>
                <button
                  onClick={onClearAll}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--accent)',
                    color: 'var(--accent)',
                    padding: '4px 12px',
                    fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
                    fontSize: '0.7rem',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  清空档案
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {history.map((entry) => {
                  const t = tally(entry);
                  const editorVerdict = entry.editorState?.data?.verdict;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        border: '1px solid var(--ink-faded)',
                        background: 'rgba(255,255,255,0.25)',
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
                        <button
                          onClick={() => onLoad(entry.id)}
                          style={{
                            background: 'var(--ink)',
                            color: 'var(--paper)',
                            border: '1px solid var(--ink)',
                            padding: '5px 12px',
                            fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
                            fontSize: '0.7rem',
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                          }}
                        >
                          查阅
                        </button>
                        <button
                          onClick={() => onDelete(entry.id)}
                          style={{
                            background: 'transparent',
                            color: 'var(--ink-faded)',
                            border: '1px solid var(--ink-faded)',
                            padding: '5px 10px',
                            fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
                            fontSize: '0.7rem',
                            cursor: 'pointer',
                          }}
                          aria-label="删除"
                        >
                          ×
                        </button>
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

