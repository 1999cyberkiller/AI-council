/* ──────────────────────────────────────────────────────────────────
   ANALYST COLUMN · 单个分析师专栏（含技术派的 K 线图）
   ────────────────────────────────────────────────────────────────── */

import React from 'react';
import { Stars, VerdictBadge, WireFeed } from './atoms';
import { CandlestickChart } from './CandlestickChart';

export const AnalystColumn = ({ analyst, model, state, klineData, klineLoading, klineError, onRetry, grade, klineRange, onKlineRangeChange }) => {
  const isPending = !state || state.status === 'pending' || state.status === 'waiting';
  const isDone = state?.status === 'done';
  const isError = state?.status === 'error';
  const data = state?.data;
  const showKline = analyst.id === 'tech';

  // Calculate progress for bar
  const totalStages = analyst.stages.length + 1;
  let progress = 0;
  if (isPending) progress = 25 + Math.random() * 30; // approximate, will be updated by feed
  if (isDone) progress = 100;
  if (isError) progress = 0;

  return (
    <div className="fade-up">
      {/* Section label with model name on right */}
      <div className="section-label">
        <span>SEC. {analyst.section} · {analyst.enName}</span>
        <span style={{ color: model ? 'var(--accent)' : 'var(--ink-faded)' }}>
          {model ? `via ${model.name}` : 'NO MODEL'}
        </span>
      </div>

      {/* Monogram + name */}
      <div className="flex items-center gap-4" style={{ margin: '20px 0 14px' }}>
        <div className={`monogram ${isPending ? 'monogram-active' : ''}`}>
          {analyst.monogram}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="display-serif"
            style={{ fontSize: '1.7rem', fontWeight: 700, lineHeight: 1, color: 'var(--ink)' }}
          >
            {analyst.cnName}
          </div>
          <div
            className="body-serif"
            style={{
              fontSize: '0.78rem',
              color: 'var(--ink-soft)',
              marginTop: '4px',
              lineHeight: 1.3,
            }}
          >
            {analyst.byline}
          </div>
        </div>
      </div>

      {/* K-line chart — 仅技术派显示 */}
      {showKline && (
        <>
          {klineLoading && (
            <div className="kline-frame">
              <div className="kline-loading">
                <span className="blink-cursor">读取 K 线数据</span>
              </div>
            </div>
          )}
          {!klineLoading && klineData && klineData.length > 0 && (
            <CandlestickChart
              klines={klineData}
              market={klineData[0]?.market || 'A'}
              currentRange={klineRange}
              onRangeChange={onKlineRangeChange}
            />
          )}
          {!klineLoading && (!klineData || klineData.length === 0) && (
            <div className="kline-frame">
              <div className="kline-loading" style={{ fontSize: '0.7rem' }}>
                {klineError ? `K 线数据不可用：${klineError}` : 'K 线数据不可用（可能为新股或频率限制）'}
              </div>
            </div>
          )}
        </>
      )}

      {/* Conviction strip — only when done */}
      {isDone && (
        <div
          className="flex items-center justify-between"
          style={{
            borderTop: '1px solid var(--ink-faded)',
            borderBottom: '1px solid var(--ink-faded)',
            padding: '8px 0',
            marginBottom: '1.1rem',
          }}
        >
          <span className="small-caps mono" style={{ fontSize: '0.7rem' }}>
            CONVICTION · 信 心
          </span>
          <Stars count={data.conviction} />
        </div>
      )}

      {/* Loading or Error state */}
      {(isPending || isError) && (
        <>
          <WireFeed
            analyst={analyst}
            modelName={model?.name || '—'}
            isLoading={isPending}
            isError={isError}
            errorMsg={state?.error}
            rawPreview={state?.rawPreview}
            onRetry={isError ? onRetry : null}
          />
          {state?.status === 'waiting' && (
            <div className="wire-line" style={{ marginTop: 8, fontSize: '0.74rem' }}>
              <span className="wire-marker">…</span>
              <span style={{ color: 'var(--ink-faded)' }}>模型还在后台写稿，其他专栏先刊出。</span>
            </div>
          )}
          {isPending && (
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${progress}%`,
                  animation: 'progressBreathe 2.5s ease-in-out infinite',
                }}
              />
            </div>
          )}
        </>
      )}

      {/* Done state */}
      {isDone && (
        <div className="ink-develop">
          {grade && grade.grade && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: '0.85rem',
                paddingBottom: '0.55rem',
                borderBottom: '1px dotted var(--ink-faded)',
              }}
            >
              <span
                className="mono small-caps"
                style={{
                  fontSize: '0.62rem',
                  letterSpacing: '0.18em',
                  color: 'var(--ink-soft)',
                }}
              >
                ◆ 主编评级
              </span>
              <span className={`grade-badge grade-${grade.grade}`}>{grade.grade}</span>
              {grade.comment && (
                <span
                  className="body-serif"
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--ink-soft)',
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  「{grade.comment}」
                </span>
              )}
            </div>
          )}
          <h3
            className="display-serif"
            style={{
              fontSize: '1.4rem',
              fontWeight: 700,
              lineHeight: 1.25,
              marginBottom: '1rem',
              color: 'var(--ink)',
              letterSpacing: '-0.005em',
            }}
          >
            {data.headline}
          </h3>

          <div
            className="dropcap body-serif"
            style={{
              fontSize: '1.04rem',
              lineHeight: 1.62,
              marginBottom: '1.2rem',
              textAlign: 'justify',
              color: 'var(--ink)',
            }}
          >
            {data.analysis}
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <div
              className="small-caps mono"
              style={{ fontSize: '0.72rem', color: 'var(--ink-soft)', marginBottom: '0.55rem' }}
            >
              ◆ 关 键 论 点 · KEY POINTS
            </div>
            <ul style={{ listStyle: 'none', padding: 0, fontSize: '0.95rem', margin: 0 }}>
              {data.key_points.map((p, i) => (
                <li key={i} className="key-point body-serif">
                  <span className="marker">§</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          <div className="risk-pull body-serif" style={{ fontSize: '0.88rem', marginBottom: '0.4rem' }}>
            <span className="small-caps mono" style={{ fontSize: '0.66rem', color: 'var(--accent)' }}>
              RISK NOTE —{' '}
            </span>
            {data.risk}
          </div>

          <VerdictBadge verdict={data.verdict} />
        </div>
      )}
    </div>
  );
};
