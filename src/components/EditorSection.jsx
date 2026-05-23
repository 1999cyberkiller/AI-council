/* ──────────────────────────────────────────────────────────────────
   EDITOR SECTION · 主编札记板块
   - 共识/分歧结构化对比表（含归属 chip + 根因徽章）
   - 独有贡献区
   - 评分卡片
   ────────────────────────────────────────────────────────────────── */

import React from 'react';
import { renderWithMentions } from './StockMention';
import { ANALYSTS_COUNT, ROOT_CAUSE_CN } from '../lib/constants';

// 历史档案兼容层：旧 V5 数据可能是字符串数组形态
// 在渲染层做防御性归一化，避免 history 回看时崩溃
function coerceConsensusItem(item) {
  if (typeof item === 'string') return { point: item, supporters: [] };
  if (item && typeof item === 'object') {
    return {
      point: item.point || '—',
      supporters: Array.isArray(item.supporters) ? item.supporters : [],
    };
  }
  return null;
}
function coerceDissentItem(item) {
  if (typeof item === 'string') return { topic: item, positions: {}, root_cause: null };
  if (item && typeof item === 'object') {
    return {
      topic: item.topic || '—',
      positions: item.positions && typeof item.positions === 'object' ? item.positions : {},
      root_cause: item.root_cause || null,
    };
  }
  return null;
}

export const EditorSection = ({ state, model, voteStats, onRetry, analystProgress, mentionDict, currentCode, onSummonStock }) => {
  const isPending = !state || state.status === 'pending';
  const isDone = state?.status === 'done';
  const isError = state?.status === 'error';
  const data = state?.data;

  const verdictColor = (v) =>
    v === 'BUY' ? 'var(--buy-light)' : v === 'SELL' ? 'var(--sell-light)' : 'var(--hold-light)';
  const verdictCN = (v) => (v === 'BUY' ? '买入' : v === 'SELL' ? '卖出' : '持有');

  // Item 2: progress visualization helper
  const progress = analystProgress || { done: 0, total: 4, doneAnalysts: [], pendingAnalysts: [], failedAnalysts: [] };

  return (
    <section className="editor-section fade-up">
      <div className="editor-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <div
            className="mono small-caps"
            style={{ fontSize: '0.72rem', letterSpacing: '0.32em', color: 'var(--paper-dark)', marginBottom: 4 }}
          >
            ◆ EDITOR-IN-CHIEF · 主 编 札 记 ◆
          </div>
          <div
            className="display-serif"
            style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1, letterSpacing: '0.02em' }}
          >
            综 合 裁 决
          </div>
          <div
            className="mono"
            style={{ fontSize: '0.66rem', color: 'var(--paper-dark)', letterSpacing: '0.12em', marginTop: 6 }}
          >
            主笔 · CHIEF · {model ? model.name : '—'}
          </div>
        </div>

        {/* 完成后才显示的紧凑型 vote / conviction / verdict 三栏 */}
        {isDone && (
          <div className="editor-header-stats">
            <div className="editor-stat-mini">
              <div className="editor-stat-label">议会票数</div>
              <div className="editor-stat-value">
                <span style={{ color: 'var(--buy-light)' }}>{voteStats?.buy || 0}</span>
                <span style={{ color: 'var(--paper-dark)', margin: '0 0.2rem' }}>·</span>
                <span style={{ color: 'var(--hold-light)' }}>{voteStats?.hold || 0}</span>
                <span style={{ color: 'var(--paper-dark)', margin: '0 0.2rem' }}>·</span>
                <span style={{ color: 'var(--sell-light)' }}>{voteStats?.sell || 0}</span>
              </div>
              <div className="editor-stat-sub">B · H · S</div>
            </div>
            <div className="editor-stat-mini">
              <div className="editor-stat-label">主编信心</div>
              <div className="editor-stat-value">
                {data.conviction}<span style={{ fontSize: '0.7rem', color: 'var(--paper-dark)' }}> / 5</span>
              </div>
              <div className="editor-stat-sub" style={{ color: '#E8C97A', letterSpacing: 0 }}>
                {'★'.repeat(data.conviction)}{'☆'.repeat(5 - data.conviction)}
              </div>
            </div>
            <div className="editor-stat-mini">
              <div className="editor-stat-label">最终建议</div>
              <div
                style={{
                  border: `1.5px solid ${verdictColor(data.verdict)}`,
                  color: verdictColor(data.verdict),
                  padding: '3px 8px',
                  fontFamily: "'Fraunces', 'Noto Serif SC', serif",
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  fontSize: '0.78rem',
                  marginTop: 2,
                }}
              >
                {data.verdict}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="editor-body">
        {/* Loading */}
        {isPending && (
          <div style={{ padding: '20px 0' }}>
            {/* 议会进度可视化 — V17 */}
            <div className="editor-progress">
              <div className="editor-progress-bar">
                <div
                  className="editor-progress-fill"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
              <div className="editor-progress-meta">
                <span>
                  已交稿 <strong>{progress.done}</strong> / {progress.total}
                </span>
                {progress.doneAnalysts.length > 0 && (
                  <span className="editor-progress-chips">
                    {progress.doneAnalysts.map((name) => (
                      <span key={name} className="editor-progress-chip editor-progress-chip--done">
                        ✓ {name}
                      </span>
                    ))}
                    {progress.failedAnalysts.map((name) => (
                      <span key={name} className="editor-progress-chip editor-progress-chip--failed">
                        ✕ {name}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            </div>

            <div
              className="mono"
              style={{
                fontSize: '0.84rem',
                color: 'var(--paper-dark)',
                letterSpacing: '0.08em',
                lineHeight: 2,
                marginTop: 18,
              }}
            >
              <div>▸ 审阅四位作者本期专栏</div>
              <div>▸ 抽离共识与分歧</div>
              <div className="blink-cursor">
                {progress.done < progress.total
                  ? `▸ 等 ${progress.total - progress.done} 位交稿…`
                  : '▸ 落笔札记'}
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div style={{ color: 'var(--sell-light)', padding: '20px 0' }}>
            <div
              className="display-serif"
              style={{ fontSize: '1.1rem', marginBottom: 6, fontWeight: 600 }}
            >
              ※ 主编因故未能落稿
            </div>
            <div
              className="mono"
              style={{ fontSize: '0.78rem', color: 'var(--paper-dark)', wordBreak: 'break-word' }}
            >
              {state.error}
            </div>
            {onRetry && (
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={onRetry}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--paper-dark)',
                    color: 'var(--paper-dark)',
                    padding: '5px 16px',
                    fontFamily: "'Courier Prime', 'Noto Sans SC', monospace",
                    fontSize: '0.74rem',
                    letterSpacing: '0.16em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    transition: 'all 0.18s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--paper)';
                    e.currentTarget.style.color = 'var(--ink)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--paper-dark)';
                  }}
                >
                  ↻ 重新落稿 · Retry
                </button>
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {isDone && (
          <>
            {/* Headline */}
            <h3
              className="display-serif"
              style={{
                fontSize: 'clamp(1.3rem, 2.6vw, 1.7rem)',
                fontWeight: 700,
                lineHeight: 1.3,
                marginBottom: 18,
                color: 'var(--paper)',
                letterSpacing: '0.005em',
              }}
            >
              {data.headline}
            </h3>

            {/* Key sentence pullquote — 整篇核心，单独提炼 */}
            {data.key_sentence && (
              <div className="editor-keysent">
                <span className="editor-keysent-bar" aria-hidden="true" />
                <div className="editor-keysent-text">{data.key_sentence}</div>
              </div>
            )}

            {/* Review body with drop cap */}
            <div
              className="editor-dropcap body-serif body-serif-indent"
              style={{
                fontSize: '1.02rem',
                lineHeight: 1.72,
                color: 'var(--paper)',
                textAlign: 'justify',
                marginBottom: 22,
                opacity: 0.96,
              }}
            >
              {data.review.split(/\n+/).filter((p) => p.trim()).map((p, i) => (
                <p key={i} style={{ margin: i === 0 ? '0 0 0.85em 0' : '0.85em 0 0.85em 0' }}>
                  {mentionDict ? renderWithMentions(p, mentionDict, currentCode, onSummonStock) : p}
                </p>
              ))}
            </div>

            {/* Empty fallback — neither consensus nor dissent populated */}
            {data.consensus_areas.length === 0 && data.dissent_areas.length === 0 && (
              <div
                className="body-serif"
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--paper-dark)',
                  fontStyle: 'italic',
                  marginBottom: 18,
                  padding: '12px 14px',
                  border: '1px dashed var(--paper-dark)',
                }}
              >
                本期主编未提炼出明显的共识或分歧。
              </div>
            )}

            {/* Consensus · 共识区 */}
            {data.consensus_areas.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div
                  className="mono small-caps"
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.18em',
                    color: 'var(--buy-light)',
                    marginBottom: 10,
                  }}
                >
                  ◆ 共 识 · CONSENSUS
                </div>
                <div className="cd-stack">
                  {data.consensus_areas.map((raw, i) => {
                    const c = coerceConsensusItem(raw);
                    if (!c) return null;
                    return (
                    <div key={i} className="cd-row cd-row--consensus">
                      <div
                        className="body-serif"
                        style={{ fontSize: '0.96rem', lineHeight: 1.55, color: 'var(--paper)' }}
                      >
                        <span style={{ color: 'var(--buy-light)', marginRight: 6 }}>§</span>
                        {c.point}
                      </div>
                      {c.supporters.length > 0 && (
                        <div className="cd-chips" style={{ marginTop: 8 }}>
                          {c.supporters.map((s, j) => (
                            <span key={j} className="cd-chip cd-chip--buy">{s}</span>
                          ))}
                          <span className="cd-chip-count">
                            {c.supporters.length}/{ANALYSTS_COUNT}
                          </span>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Dissent · 分歧区 */}
            {data.dissent_areas.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div
                  className="mono small-caps"
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.18em',
                    color: 'var(--sell-light)',
                    marginBottom: 10,
                  }}
                >
                  ◆ 分 歧 · DISSENT
                </div>
                <div className="cd-stack">
                  {data.dissent_areas.map((raw, i) => {
                    const d = coerceDissentItem(raw);
                    if (!d) return null;
                    const positionEntries = Object.entries(d.positions || {});
                    return (
                      <div key={i} className="cd-row cd-row--dissent">
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'baseline',
                            gap: 12,
                            marginBottom: positionEntries.length > 0 ? 10 : 0,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div
                            className="body-serif"
                            style={{ fontSize: '0.96rem', lineHeight: 1.5, color: 'var(--paper)' }}
                          >
                            <span style={{ color: 'var(--sell-light)', marginRight: 6 }}>⚡</span>
                            {d.topic}
                          </div>
                          {d.root_cause && ROOT_CAUSE_CN[d.root_cause] && (
                            <span className="cd-root-cause">
                              根因 · {ROOT_CAUSE_CN[d.root_cause]}
                            </span>
                          )}
                        </div>
                        {positionEntries.length > 0 && (
                          <div className="cd-positions">
                            {positionEntries.map(([analyst, stance]) => (
                              <div key={analyst} className="cd-position">
                                <span className="cd-chip cd-chip--sell">{analyst}</span>
                                <span
                                  className="body-serif"
                                  style={{ fontSize: '0.88rem', color: 'var(--paper-dark)', lineHeight: 1.45 }}
                                >
                                  → {stance}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unique contributions · 独有贡献 */}
            {data.unique_contributions && data.unique_contributions.length > 0 && (
              <div style={{ marginBottom: 22 }}>
                <div
                  className="mono small-caps"
                  style={{
                    fontSize: '0.66rem',
                    letterSpacing: '0.18em',
                    color: 'var(--hold-light)',
                    marginBottom: 10,
                  }}
                >
                  ◆ 独 有 贡 献 · UNIQUE INSIGHTS
                </div>
                <div className="cd-stack">
                  {data.unique_contributions.map((u, i) => (
                    <div key={i} className="cd-row cd-row--unique">
                      <span className="cd-chip cd-chip--hold">{u.analyst} 独家</span>
                      <span
                        className="body-serif"
                        style={{ fontSize: '0.92rem', color: 'var(--paper)', lineHeight: 1.5, marginLeft: 10 }}
                      >
                        💡 {u.point}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Watchpoint */}
            <div
              style={{
                borderLeft: '3px solid var(--accent-soft)',
                background: 'rgba(168, 70, 56, 0.12)',
                padding: '10px 16px',
                marginBottom: 22,
              }}
            >
              <div
                className="mono small-caps"
                style={{
                  fontSize: '0.64rem',
                  letterSpacing: '0.18em',
                  color: 'var(--accent-soft)',
                  marginBottom: 4,
                }}
              >
                ◆ 主 编 提 示 · WATCHPOINT
              </div>
              <div
                className="body-serif"
                style={{ fontSize: '0.96rem', color: 'var(--paper)', lineHeight: 1.5 }}
              >
                {data.watchpoint}
              </div>
            </div>

            {/* Final stats moved to header — keep area clean */}

            <div
              className="text-center body-serif"
              style={{
                fontSize: '0.74rem',
                color: 'var(--paper-dark)',
                marginTop: 20,
                lineHeight: 1.55,
              }}
            >
              ※ 主编札记由所选模型基于四篇专栏综合而成，非编辑部官方立场。投资有风险，决策需独立。
            </div>
          </>
        )}
      </div>
    </section>
  );
};
