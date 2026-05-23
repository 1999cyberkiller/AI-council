/* ──────────────────────────────────────────────────────────────────
   WATCHLIST PANEL · 自选股面板
   ────────────────────────────────────────────────────────────────── */

import React, { useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { WATCHLIST_MAX } from '../lib/storage';

function fmtScanTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function buildDailyBrief(watchlist, scanState) {
  const items = scanState?.items || {};
  const rows = watchlist.map((w) => ({ ...w, scan: items[w.code] })).filter((w) => w.scan);
  const warnings = rows.filter((w) => w.scan.status === 'warning');
  const errors = rows.filter((w) => w.scan.status === 'error');
  const quiet = rows.filter((w) => w.scan.status === 'ok').length;
  const pending = rows.filter((w) => w.scan.status === 'pending').length;
  return { rows, warnings, errors, quiet, pending };
}

export const WatchlistPanel = ({
  expanded,
  onToggle,
  watchlist,
  onAnalyze,
  onRemove,
  onHover,
  scanState,
  onScan,
}) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
  if (!expanded) return null;
  const brief = buildDailyBrief(watchlist, scanState);

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
          {watchlist.length > 0 && (
            <div className="watchlist-toolbar">
              <div className="mono watchlist-scan-meta">
                {scanState?.running
                  ? `巡检中 ${scanState.done || 0}/${scanState.total || watchlist.length}`
                  : scanState?.lastRunAt
                  ? `上次巡检 ${fmtScanTime(scanState.lastRunAt)}`
                  : '仅查行情，不调用模型'}
              </div>
              <button className="btn-ghost" onClick={onScan} disabled={scanState?.running}>
                {scanState?.running ? '巡检中…' : '巡检自选股'}
              </button>
            </div>
          )}

          {watchlist.length > 0 && (scanState?.running || scanState?.lastRunAt) && (
            <div className="watchlist-brief">
              <div className="watchlist-brief-head">
                <div>
                  <div className="mono small-caps watchlist-brief-kicker">DAILY BRIEF · 自 选 异 动</div>
                  <div className="display-serif watchlist-brief-title">
                    {brief.warnings.length + brief.errors.length > 0
                      ? `今日重点 ${brief.warnings.length + brief.errors.length} 只`
                      : brief.pending > 0
                      ? '日报生成中'
                      : '今日暂无明显异动'}
                  </div>
                </div>
                <div className="mono watchlist-brief-count">
                  平稳 {brief.quiet} · 异动 {brief.warnings.length} · 失败 {brief.errors.length}
                </div>
              </div>
              <div className="watchlist-brief-list">
                {[...brief.warnings, ...brief.errors].slice(0, 6).map((w) => (
                  <button
                    key={w.code}
                    className={`watchlist-brief-row watchlist-brief-row--${w.scan.status}`}
                    onClick={() => onAnalyze(w)}
                  >
                    <span>{w.name || w.code}</span>
                    <span>{w.scan.changeText || w.scan.detail}</span>
                    <span>{w.scan.detail}</span>
                  </button>
                ))}
                {brief.warnings.length + brief.errors.length === 0 && brief.pending === 0 && (
                  <div className="watchlist-brief-empty">
                    自选池整体平稳，今天不用被噪音拖着走。
                  </div>
                )}
              </div>
            </div>
          )}

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
                <div key={w.code} className="watchlist-item-wrap">
                  <div
                    onMouseEnter={() => onHover && onHover(w)}
                    onTouchStart={() => onHover && onHover(w)}
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
                      {scanState?.items?.[w.code] && (
                        <div className={`watchlist-scan-line watchlist-scan-line--${scanState.items[w.code].status}`}>
                          {scanState.items[w.code].status === 'pending' ? (
                            '读取行情中'
                          ) : scanState.items[w.code].status === 'error' ? (
                            scanState.items[w.code].detail || '巡检失败'
                          ) : (
                            <>
                              <span>{scanState.items[w.code].priceText}</span>
                              <span>{scanState.items[w.code].changeText}</span>
                              <span>{scanState.items[w.code].detail}</span>
                            </>
                          )}
                        </div>
                      )}
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
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
