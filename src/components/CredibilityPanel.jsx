/* ──────────────────────────────────────────────────────────────────
   CREDIBILITY PANEL · 准确率档案面板（v12 加固版）
   - 所有数据访问加 fallback，避免 undefined.x 崩面板
   - 空状态条件改宽松：只要还没 done 的全显示空提示（不只是三计数都 0）
   - 包裹 ErrorBoundary，子组件异常不再产生白屏
   ────────────────────────────────────────────────────────────────── */

import React, { useMemo, useRef } from 'react';
import { useEscToClose, useFocusTrap } from '../hooks';
import { backfillStatus, daysUntilBackfill } from '../lib/scoring';
import { ErrorBoundary } from './ErrorBoundary';

const ROLE_NAME_MAP = {
  value: '价值派',
  tech: '技术派',
  macro: '宏观派',
  risk: '风险派',
  editor: '主编',
};
const ROLE_IDS = ['value', 'tech', 'macro', 'risk', 'editor'];

// 给一个保险的 role stat 默认值，stats 缺位时不至于崩
const EMPTY_ROLE_STAT = {
  total: 0,
  right: 0,
  wrong: 0,
  tie: 0,
  na: 0,
  accuracy: null,
  recent: [],
  byMarket: {
    A: { total: 0, right: 0, wrong: 0, tie: 0, accuracy: null },
    US: { total: 0, right: 0, wrong: 0, tie: 0, accuracy: null },
  },
};

function safeRoleStat(stats, id) {
  const r = stats?.[id];
  if (!r || typeof r !== 'object') return EMPTY_ROLE_STAT;
  return {
    total: r.total || 0,
    right: r.right || 0,
    wrong: r.wrong || 0,
    tie: r.tie || 0,
    na: r.na || 0,
    accuracy: typeof r.accuracy === 'number' ? r.accuracy : null,
    recent: Array.isArray(r.recent) ? r.recent : [],
    byMarket: {
      A: {
        total: r?.byMarket?.A?.total || 0,
        right: r?.byMarket?.A?.right || 0,
        wrong: r?.byMarket?.A?.wrong || 0,
        accuracy: typeof r?.byMarket?.A?.accuracy === 'number' ? r.byMarket.A.accuracy : null,
      },
      US: {
        total: r?.byMarket?.US?.total || 0,
        right: r?.byMarket?.US?.right || 0,
        wrong: r?.byMarket?.US?.wrong || 0,
        accuracy: typeof r?.byMarket?.US?.accuracy === 'number' ? r.byMarket.US.accuracy : null,
      },
    },
  };
}

function CredibilityPanelInner({
  stats, history,
  onBackfillNow, backfillState, backfillProgress,
}) {
  // ── 桶计数（防御性） ─────────────────────────────────────────
  const buckets = useMemo(() => {
    const b = { done: 0, overdue: 0, pending: 0, failed: 0 };
    (history || []).forEach((e) => {
      const s = backfillStatus(e);
      if (b[s] != null) b[s] += 1;
    });
    return b;
  }, [history]);

  const overdueList = useMemo(() => {
    return (history || [])
      .filter((e) => backfillStatus(e) === 'overdue')
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .slice(0, 10);
  }, [history]);

  const pendingList = useMemo(() => {
    return (history || [])
      .filter((e) => backfillStatus(e) === 'pending')
      .sort((a, b) => daysUntilBackfill(a) - daysUntilBackfill(b))
      .slice(0, 8);
  }, [history]);

  const fmtAcc = (r) => (r.accuracy == null ? '—' : `${(r.accuracy * 100).toFixed(0)}%`);
  const fmtMarket = (r, mk) => {
    const bm = r.byMarket?.[mk];
    if (!bm || bm.accuracy == null) return '—';
    return `${(bm.accuracy * 100).toFixed(0)}% · n=${(bm.right || 0) + (bm.wrong || 0)}`;
  };

  const isBusy = backfillState === 'running';
  const totalHistory = (history || []).length;
  // 真正"无任何东西可显示"的判定：history 完全空或全是 unknown 状态
  const isCompletelyEmpty = totalHistory === 0;
  // "未到出第一个准确率数据的时刻"：没有 done，但有 pending/overdue/failed
  const hasOnlyWaiting =
    buckets.done === 0 && (buckets.pending > 0 || buckets.overdue > 0 || buckets.failed > 0);

  return (
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
          到期待回填 <strong style={{ color: 'var(--accent)' }}>{buckets.overdue}</strong> 条 ·
          未满 30 天 <strong style={{ color: 'var(--ink-soft)' }}>{buckets.pending}</strong> 条 ·
          已放弃 <strong style={{ color: 'var(--ink-faded)' }}>{buckets.failed}</strong> 条
          {totalHistory > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--ink-faded)' }}>
              · 总历史 <strong>{totalHistory}</strong> 条
            </span>
          )}
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

      {/* 完全空：突出空状态，但保留卡片让用户看到分析师列表 */}
      {isCompletelyEmpty && (
        <div className="cred-banner cred-banner--empty">
          <div className="cred-banner-title">档案空白</div>
          <div className="cred-banner-body">
            还没有任何分析。从下一次召集议会起，每条分析会自动记录基准并在 30 天后判定对错——
            <strong> 30 天后</strong>你才能看到第一条准确率数据。
          </div>
        </div>
      )}

      {/* 有数据但还没满 30 天：温和提醒 */}
      {hasOnlyWaiting && (
        <div className="cred-banner cred-banner--waiting">
          <div className="cred-banner-title">⏳ 数据采集中</div>
          <div className="cred-banner-body">
            已记录 <strong>{buckets.pending + buckets.overdue + buckets.failed}</strong> 条分析的初始价格和基准指数。
            最早的一条还差 <strong>
              {pendingList.length > 0 ? daysUntilBackfill(pendingList[0]) : 0}
            </strong> 天满 30 日。准确率档案目前为空，这是正常的。
          </div>
        </div>
      )}

      {/* 角色准确率卡片（永远显示，即使全 n=0） */}
      <div className="cred-cards-grid">
        {ROLE_IDS.map((id) => {
          const r = safeRoleStat(stats, id);
          const denom = r.right + r.wrong;
          const accClass =
            r.accuracy == null
              ? 'neutral'
              : r.accuracy >= 0.6
              ? 'good'
              : r.accuracy >= 0.4
              ? 'mid'
              : 'bad';
          return (
            <div key={id} className={`cred-card cred-card--${id}`}>
              <div className="cred-card-header">
                <span className="cred-role-name">{ROLE_NAME_MAP[id]}</span>
                {id === 'editor' && <span className="cred-role-badge">主笔</span>}
              </div>
              <div className="cred-accuracy-big">
                {r.accuracy == null ? (
                  <span className="cred-empty">— · n=0</span>
                ) : (
                  <>
                    <span className={`cred-pct cred-pct--${accClass}`}>{fmtAcc(r)}</span>
                    <span className="cred-n">n={denom}</span>
                  </>
                )}
              </div>
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
              <div className="cred-distribution">
                <span style={{ color: 'var(--buy)' }}>对 {r.right}</span>
                <span style={{ color: 'var(--ink-faded)', margin: '0 6px' }}>·</span>
                <span style={{ color: 'var(--sell)' }}>错 {r.wrong}</span>
                <span style={{ color: 'var(--ink-faded)', margin: '0 6px' }}>·</span>
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
                  const ageDays = e.timestamp ? Math.floor((Date.now() - e.timestamp) / 86400000) : 0;
                  const attemptCount = (e.outcomeAttempts || []).length;
                  const lastErr = attemptCount > 0
                    ? e.outcomeAttempts[e.outcomeAttempts.length - 1]?.error
                    : null;
                  return (
                    <li key={e.id || `${e.ticker}-${e.timestamp}`}>
                      <span className="cred-queue-name">{e.stockData?.name || e.ticker || '—'}</span>
                      <span className="cred-queue-meta">
                        分析于 {ageDays} 天前
                        {attemptCount > 0 && ` · 已重试 ${attemptCount} 次`}
                      </span>
                      {lastErr && (
                        <span className="cred-queue-err">{String(lastErr).slice(0, 60)}</span>
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
                  <li key={e.id || `${e.ticker}-${e.timestamp}`}>
                    <span className="cred-queue-name">{e.stockData?.name || e.ticker || '—'}</span>
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
    </div>
  );
}

export const CredibilityPanel = ({
  expanded, onToggle, stats, history,
  onBackfillNow, backfillState, backfillProgress,
}) => {
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
        <ErrorBoundary>
          <CredibilityPanelInner
            stats={stats}
            history={history}
            onBackfillNow={onBackfillNow}
            backfillState={backfillState}
            backfillProgress={backfillProgress}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
};
