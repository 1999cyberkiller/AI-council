/* ──────────────────────────────────────────────────────────────────
   CREDIBILITY PANEL · 准确率档案面板
   显示 4 位分析师 + 主编的历史准确率（按"超过基准"判定）。
   数据来源：history 中已回填 outcome 的条目。
   ────────────────────────────────────────────────────────────────── */

import React, { useMemo, useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { backfillStatus, daysUntilBackfill } from '../lib/scoring';

export const CredibilityPanel = ({
  expanded, onToggle, stats, history,
  onBackfillNow, backfillState, backfillProgress,
}) => {
  useEscToClose(expanded, onToggle);
  const containerRef = useRef(null);
  useFocusTrap(expanded, containerRef);
  if (!expanded) return null;

  const roleNameMap = {
    value: '价值派',
    tech: '技术派',
    macro: '宏观派',
    risk: '风险派',
    editor: '主编',
  };
  const roleIds = ['value', 'tech', 'macro', 'risk', 'editor'];

  // 按 backfillStatus 分类历史
  const buckets = useMemo(() => {
    const b = { done: 0, overdue: 0, pending: 0, failed: 0 };
    history.forEach((e) => {
      const s = backfillStatus(e);
      if (b[s] != null) b[s] += 1;
    });
    return b;
  }, [history]);

  // 待回填条目（按到期时间排序）
  const overdueList = useMemo(() => {
    return history
      .filter((e) => backfillStatus(e) === 'overdue')
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, 10);
  }, [history]);

  const pendingList = useMemo(() => {
    return history
      .filter((e) => backfillStatus(e) === 'pending')
      .sort((a, b) => daysUntilBackfill(a) - daysUntilBackfill(b))
      .slice(0, 8);
  }, [history]);

  const fmtPct = (p) => (p == null ? '—' : `${(p * 100).toFixed(0)}%`);
  const fmtAcc = (r) => {
    if (r.accuracy == null) return '—';
    return `${(r.accuracy * 100).toFixed(0)}%`;
  };
  const fmtMarket = (r, mk) => {
    const bm = r.byMarket[mk];
    if (bm.accuracy == null) return '—';
    return `${(bm.accuracy * 100).toFixed(0)}% · n=${bm.right + bm.wrong}`;
  };

  const isBusy = backfillState === 'running';

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={onToggle}>
      <div ref={containerRef} className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
              准确率档案
            </div>
            <div
              className="mono small-caps"
              style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
            >
              CREDIBILITY · 30 日后超额收益判定
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
          {/* 头部说明条 */}
          <div className="cred-info-strip">
            <div className="body-serif" style={{ fontSize: '0.84rem', lineHeight: 1.55 }}>
              <span style={{ color: 'var(--accent)', fontWeight: 600 }}>判定规则：</span>
              BUY 后 30 日内股票超额收益（vs 沪深300 或 SPY）&gt; +1% 算对；SELL 后 &lt; -1% 算对；
              HOLD 时绝对超额收益 &lt; 3% 算对；|超额| ≤ 1% 为打平不计入。
            </div>
            <div
              className="mono"
              style={{ fontSize: '0.72rem', color: 'var(--ink-faded)', marginTop: 8, letterSpacing: '0.04em' }}
            >
              样本：已完成 <strong style={{ color: 'var(--ink)' }}>{buckets.done}</strong> 条 ·
              到期待回填 <strong style={{ color: 'var(--accent-soft)' }}>{buckets.overdue}</strong> 条 ·
              未满 30 天 <strong style={{ color: 'var(--ink-soft)' }}>{buckets.pending}</strong> 条 ·
              已放弃 <strong style={{ color: 'var(--ink-faded)' }}>{buckets.failed}</strong> 条
            </div>
            {buckets.overdue > 0 && (
              <button
                className="cred-backfill-btn"
                onClick={() => onBackfillNow({ maxPerRun: 10, force: true })}
                disabled={isBusy}
              >
                {isBusy
                  ? `回填中… ${backfillProgress?.current || 0}/${backfillProgress?.total || 0}`
                  : `↻ 立即回填到期 ${buckets.overdue} 条`}
              </button>
            )}
          </div>

          {/* 角色准确率卡片 */}
          <div className="cred-cards-grid">
            {roleIds.map((id) => {
              const r = stats[id];
              const denom = r.right + r.wrong;
              return (
                <div key={id} className={`cred-card cred-card--${id}`}>
                  <div className="cred-card-header">
                    <span className="cred-role-name">{roleNameMap[id]}</span>
                    {id === 'editor' && <span className="cred-role-badge">主笔</span>}
                  </div>
                  <div className="cred-accuracy-big">
                    {r.accuracy == null ? (
                      <span className="cred-empty">— · n=0</span>
                    ) : (
                      <>
                        <span className={`cred-pct cred-pct--${r.accuracy >= 0.6 ? 'good' : r.accuracy >= 0.4 ? 'mid' : 'bad'}`}>
                          {fmtAcc(r)}
                        </span>
                        <span className="cred-n">n={denom}</span>
                      </>
                    )}
                  </div>
                  {/* 最近 8 次对错痕迹 */}
                  {r.recent.length > 0 && (
                    <div className="cred-streak">
                      {r.recent.map((s, i) => (
                        <span
                          key={i}
                          className={`cred-dot cred-dot--${s}`}
                          title={s === 'right' ? '正确' : s === 'wrong' ? '错误' : s === 'tie' ? '打平' : '未判定'}
                        >
                          {s === 'right' ? '✓' : s === 'wrong' ? '✗' : s === 'tie' ? '=' : '·'}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* 按市场拆分 */}
                  <div className="cred-bymarket">
                    <div className="cred-bymarket-row">
                      <span className="cred-bymarket-label">A 股</span>
                      <span className="cred-bymarket-val">{fmtMarket(r, 'A')}</span>
                    </div>
                    <div className="cred-bymarket-row">
                      <span className="cred-bymarket-label">美 股</span>
                      <span className="cred-bymarket-val">{fmtMarket(r, 'US')}</span>
                    </div>
                  </div>
                  {/* 分布 */}
                  <div className="cred-distribution">
                    <span style={{ color: 'var(--buy-light)' }}>对 {r.right}</span>
                    <span style={{ color: 'var(--paper-dark)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--sell-light)' }}>错 {r.wrong}</span>
                    <span style={{ color: 'var(--paper-dark)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--ink-faded)' }}>平 {r.tie}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 待回填条目 */}
          {(overdueList.length > 0 || pendingList.length > 0) && (
            <div className="cred-queue-section">
              {overdueList.length > 0 && (
                <div className="cred-queue-block">
                  <div className="cred-queue-header">
                    <span className="cd-chip cd-chip--editor">⚠ 已到期 · 待回填</span>
                    <span className="cred-queue-count">{overdueList.length} 条</span>
                  </div>
                  <ul className="cred-queue-list">
                    {overdueList.map((e) => {
                      const ageDays = Math.floor((Date.now() - e.timestamp) / 86400000);
                      const attemptCount = (e.outcomeAttempts || []).length;
                      const lastErr = attemptCount > 0
                        ? e.outcomeAttempts[e.outcomeAttempts.length - 1].error
                        : null;
                      return (
                        <li key={e.id}>
                          <span className="cred-queue-name">{e.stockData?.name || e.ticker}</span>
                          <span className="cred-queue-meta">
                            分析于 {ageDays} 天前
                            {attemptCount > 0 && ` · 已重试 ${attemptCount} 次`}
                          </span>
                          {lastErr && (
                            <span className="cred-queue-err">{lastErr.slice(0, 40)}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {pendingList.length > 0 && (
                <div className="cred-queue-block">
                  <div className="cred-queue-header">
                    <span className="cd-chip cd-chip--neutral">未到期 · 静候</span>
                    <span className="cred-queue-count">{pendingList.length} 条</span>
                  </div>
                  <ul className="cred-queue-list">
                    {pendingList.map((e) => (
                      <li key={e.id}>
                        <span className="cred-queue-name">{e.stockData?.name || e.ticker}</span>
                        <span className="cred-queue-meta">
                          还差 {daysUntilBackfill(e)} 天可回填
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 空状态 */}
          {buckets.done === 0 && buckets.overdue === 0 && buckets.pending === 0 && (
            <div className="cred-empty-state">
              <div className="display-serif" style={{ fontSize: '1.1rem', marginBottom: 6 }}>
                档案空白
              </div>
              <div className="body-serif" style={{ fontSize: '0.86rem', color: 'var(--ink-faded)', lineHeight: 1.6 }}>
                目前还没有任何分析进入准确率追踪。从下一次召集议会起，每条分析会自动记录基准并在 30 天后回填——
                30 天后你才能看到第一条准确率数据。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

