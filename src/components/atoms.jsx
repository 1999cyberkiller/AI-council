/* ──────────────────────────────────────────────────────────────────
   ATOMIC COMPONENTS · 小尺寸纯展示组件
   - Stars         五星信心度
   - VerdictBadge  买入/持有/卖出徽章
   - TickerTape    顶部行情滚动条
   - WireFeed      加载状态电传式日志
   - WireFeedError 错误显示 + 可展开原始返回
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect } from 'react';
import {
  STY_RETRY_BTN_BASE, STY_ERR_LINE, STY_ERR_RAW, STY_DISCLOSURE_BTN,
} from '../lib/styles';

export const Stars = ({ count, total = 5 }) => (
  <span className="mono" style={{ fontSize: '0.95rem' }}>
    {[...Array(total)].map((_, i) => (
      <span key={i} className={i < count ? 'star-filled' : 'star-empty'}>
        {i < count ? '★' : '☆'}
      </span>
    ))}
  </span>
);

export const VerdictBadge = ({ verdict }) => {
  const cn = verdict === 'BUY' ? '建议买入' : verdict === 'SELL' ? '建议卖出' : '建议持有';
  const cls =
    verdict === 'BUY' ? 'verdict-buy' : verdict === 'SELL' ? 'verdict-sell' : 'verdict-hold';
  return <div className={`verdict-box ${cls} ink-bleed`}>{verdict} · {cn}</div>;
};

export const TickerTape = ({ stockData }) => {
  // 根据窗口宽度调速：窄屏快，宽屏慢
  const [duration, setDuration] = useState(40);
  useEffect(() => {
    const calc = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1280;
      // 380px 屏 ~ 22s，1280px ~ 38s，4K(3840) ~ 70s
      const d = Math.round(20 + (w / 100) * 1.4);
      setDuration(Math.max(20, Math.min(80, d)));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  if (!stockData) return null;
  const isUp = (stockData.changePct || 0) >= 0;
  const ccy = stockData.market === 'A' ? '¥' : '$';

  const items = [
    { label: stockData.name, code: stockData.code },
    { label: '现价', value: `${ccy}${(stockData.price || 0).toFixed(2)}` },
    {
      label: '涨跌',
      value: `${isUp ? '▲' : '▼'} ${(stockData.changePct || 0).toFixed(2)}%`,
      color: isUp ? 'ticker-arrow-up' : 'ticker-arrow-down',
    },
    stockData.pe != null && { label: 'PE', value: stockData.pe.toFixed(1) },
    stockData.pb != null && { label: 'PB', value: stockData.pb.toFixed(2) },
    stockData.marketCap && {
      label: '市值',
      value:
        stockData.market === 'A'
          ? `¥${(stockData.marketCap / 1e8).toFixed(0)}亿`
          : `$${(stockData.marketCap / 1e9).toFixed(1)}B`,
    },
    stockData.high52 && {
      label: '52周高',
      value: `${ccy}${stockData.high52.toFixed(2)}`,
    },
    stockData.low52 && {
      label: '52周低',
      value: `${ccy}${stockData.low52.toFixed(2)}`,
    },
    stockData.volume && {
      label: '成交量',
      value:
        stockData.volume > 1e6
          ? `${(stockData.volume / 1e6).toFixed(1)}M`
          : stockData.volume.toLocaleString(),
    },
    stockData.sector && { label: '板块', value: stockData.sector },
  ].filter(Boolean);

  // Duplicate for seamless scroll
  const doubled = [...items, ...items];

  return (
    <div className="ticker-strip fade-up">
      <div className="ticker-track" style={{ animationDuration: `${duration}s` }}>
        {doubled.map((it, i) => (
          <span key={i} className="ticker-item">
            <span className="ticker-label">{it.label}</span>
            {it.code && <span style={{ fontWeight: 700 }}>{it.code}</span>}
            {it.value && <span className={it.color || ''}>{it.value}</span>}
          </span>
        ))}
      </div>
    </div>
  );
};

// Error display with collapsible raw preview
export const WireFeedError = ({ errorMsg, rawPreview, onRetry, availableModels, currentModelId, onRetryWithModel }) => {
  const [showRaw, setShowRaw] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);

  // Available alternate models (exclude current one)
  const alternates = (availableModels || []).filter((m) => m.id !== currentModelId);

  return (
    <div className="wire-feed">
      <div className="wire-line error">
        <span className="wire-marker">✗</span>
        <span>通讯失败</span>
      </div>
      <div className="wire-line" style={STY_ERR_LINE}>
        <span className="wire-marker">›</span>
        <span style={{ color: 'var(--ink-faded)' }}>{errorMsg}</span>
      </div>
      {rawPreview && (
        <div style={{ marginTop: 8, paddingLeft: 24 }}>
          <button
            onClick={() => setShowRaw((s) => !s)}
            style={STY_DISCLOSURE_BTN}
            aria-expanded={showRaw}
          >
            {showRaw ? '— 收起原始返回' : '+ 查看原始返回(调试用)'}
          </button>
          {showRaw && <pre style={STY_ERR_RAW}>{rawPreview}</pre>}
        </div>
      )}
      <div style={{ marginTop: 12, paddingLeft: 24, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {onRetry && (
          <button
            onClick={onRetry}
            style={STY_RETRY_BTN_BASE}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'var(--paper)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--accent)';
            }}
          >
            ↻ 重新撰稿
          </button>
        )}
        {onRetryWithModel && alternates.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelMenu((s) => !s)}
              style={STY_RETRY_BTN_BASE}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--ink)';
                e.currentTarget.style.color = 'var(--paper)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--accent)';
              }}
              aria-haspopup="true"
              aria-expanded={showModelMenu}
            >
              换模型重试 ▾
            </button>
            {showModelMenu && (
              <div className="retry-model-menu">
                {alternates.map((m) => (
                  <button
                    key={m.id}
                    className="retry-model-menu-item"
                    onClick={() => {
                      setShowModelMenu(false);
                      onRetryWithModel(m.id);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const WireFeed = ({ analyst, modelName, isLoading, isError, errorMsg, rawPreview, onRetry, availableModels, currentModelId, onRetryWithModel }) => {
  const [completed, setCompleted] = useState(0);

  useEffect(() => {
    if (!isLoading) return;
    setCompleted(0);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(i + 1, analyst.stages.length - 1);
      setCompleted(i);
    }, 2200);
    return () => clearInterval(id);
  }, [isLoading, analyst.stages.length]);

  const lines = [
    { text: `接入 ${modelName} 通讯线路`, status: completed >= 0 ? 'done' : 'pending' },
    ...analyst.stages.map((stage, i) => {
      let status = 'pending';
      if (i < completed) status = 'done';
      else if (i === completed) status = 'active';
      // Last stage stays "active" until response arrives
      if (i === analyst.stages.length - 1 && completed === analyst.stages.length - 1) {
        status = 'active';
      }
      return { text: stage, status };
    }),
  ];

  if (isError) {
    return <WireFeedError
      errorMsg={errorMsg}
      rawPreview={rawPreview}
      onRetry={onRetry}
      availableModels={availableModels}
      currentModelId={currentModelId}
      onRetryWithModel={onRetryWithModel}
    />;
  }

  return (
    <div className="wire-feed">
      {lines.map((line, i) => {
        const marker =
          line.status === 'done'
            ? '✓'
            : line.status === 'active'
            ? '▸'
            : '·';
        return (
          <div key={i} className={`wire-line ${line.status}`}>
            <span className="wire-marker">{marker}</span>
            <span className={line.status === 'active' ? 'blink-cursor' : ''}>
              {line.text}
            </span>
          </div>
        );
      })}
    </div>
  );
};
