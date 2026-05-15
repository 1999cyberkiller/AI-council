/* ──────────────────────────────────────────────────────────────────
   WATCHLIST PANEL · 自选股面板
   ────────────────────────────────────────────────────────────────── */

import React, { useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { WATCHLIST_MAX } from '../lib/storage';

export const WatchlistPanel = ({ expanded, onToggle, watchlist, onAnalyze, onRemove }) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
  if (!expanded) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onToggle}>
      <div ref={containerRef} className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
              自选股
            </div>
            <div
              className="mono small-caps"
              style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
            >
              WATCHLIST · 我 关 注 的 标 的（最多 {WATCHLIST_MAX} 条）
            </div>
          </div>
          <button className="modal-close" onClick={onToggle} aria-label="关闭">×</button>
        </div>

        <div className="modal-body">
          {watchlist.length === 0 ? (
            <div
              className="text-center body-serif"
              style={{ padding: '40px 0', color: 'var(--ink-faded)' }}
            >
              <div className="ornament" style={{ marginBottom: 16, fontSize: '1.5rem' }}>★</div>
              <div className="display-serif" style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6, color: 'var(--ink-soft)' }}>
                自选名单为空
              </div>
              <div style={{ fontSize: '0.85rem' }}>
                分析后点标题旁的 ★ 按钮即可加入此列表
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {watchlist.map((w) => (
                <div
                  key={w.code}
                  style={{
                    border: '1px solid var(--ink-faded)',
                    background: 'rgba(255,255,255,0.18)',
                    padding: '12px 14px',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 12,
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                      <span
                        className="display-serif"
                        style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--ink)' }}
                      >
                        {w.name}
                      </span>
                      <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', letterSpacing: '0.1em' }}>
                        {w.code}
                      </span>
                      <span className="mono" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)' }}>
                        · {w.market === 'A' ? 'A 股' : '美股'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => onAnalyze(w)}
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
                      召集议会
                    </button>
                    <button
                      onClick={() => onRemove(w.code)}
                      style={{
                        background: 'transparent',
                        color: 'var(--ink-faded)',
                        border: '1px solid var(--ink-faded)',
                        padding: '5px 10px',
                        fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
                        fontSize: '0.7rem',
                        cursor: 'pointer',
                      }}
                      aria-label="移除"
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

