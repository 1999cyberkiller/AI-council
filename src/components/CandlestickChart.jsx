/* ──────────────────────────────────────────────────────────────────
   CANDLESTICK CHART · 90 日 K 线 + MA20 / MA60 + 触屏 / 悬停查看
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useRef } from 'react';

export const CandlestickChart = ({ klines, market, currentRange = 90, onRangeChange }) => {
  const [hoverIdx, setHoverIdx] = useState(null);
  const svgRef = useRef(null);

  if (!klines || klines.length === 0) return null;

  const width = 380;          // viewBox 宽度（响应式缩放）
  const height = 168;
  const padTop = 8;
  const padBottom = 18;
  const padLeft = 36;
  const padRight = 6;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // 计算价格范围（同时考虑 K 线 + MA20 + MA60）
  let yMin = Infinity, yMax = -Infinity;
  klines.forEach((k) => {
    yMin = Math.min(yMin, k.low);
    yMax = Math.max(yMax, k.high);
    if (k.ma20 != null) { yMin = Math.min(yMin, k.ma20); yMax = Math.max(yMax, k.ma20); }
    if (k.ma60 != null) { yMin = Math.min(yMin, k.ma60); yMax = Math.max(yMax, k.ma60); }
  });
  const yPad = (yMax - yMin) * 0.06;
  yMin -= yPad;
  yMax += yPad;
  const yScale = (price) => padTop + chartH * (1 - (price - yMin) / (yMax - yMin));

  const n = klines.length;
  const candleW = Math.max(2, (chartW / n) * 0.7);
  const stepX = chartW / n;
  const xCenter = (i) => padLeft + stepX * i + stepX / 2;

  // MA 路径
  const buildPath = (key) => {
    const parts = [];
    klines.forEach((k, i) => {
      if (k[key] == null) return;
      const x = xCenter(i);
      const y = yScale(k[key]);
      parts.push(parts.length === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : `L ${x.toFixed(1)} ${y.toFixed(1)}`);
    });
    return parts.join(' ');
  };

  const ma20Path = buildPath('ma20');
  const ma60Path = buildPath('ma60');

  // Y 轴刻度（5 档）
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = yMin + (yMax - yMin) * (i / 4);
    yTicks.push({ v, y: yScale(v) });
  }

  // X 轴日期（首/中/末）
  const dateTicks = [
    { i: 0, label: klines[0].date.slice(5) },
    { i: Math.floor(n / 2), label: klines[Math.floor(n / 2)].date.slice(5) },
    { i: n - 1, label: klines[n - 1].date.slice(5) },
  ];

  const last = klines[n - 1];
  const first = klines[0];
  const periodChange = ((last.close - first.close) / first.close) * 100;

  // ── 鼠标交互：把 mouse / touch 坐标转成 K 线索引
  const handlePointerMove = (e) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0]?.clientX : e.clientX;
    if (clientX == null) return;
    const xInViewBox = ((clientX - rect.left) / rect.width) * width;
    if (xInViewBox < padLeft || xInViewBox > width - padRight) {
      setHoverIdx(null);
      return;
    }
    const idx = Math.round((xInViewBox - padLeft - stepX / 2) / stepX);
    if (idx >= 0 && idx < n) setHoverIdx(idx);
    else setHoverIdx(null);
  };
  const handlePointerLeave = () => setHoverIdx(null);

  const hoverK = hoverIdx != null ? klines[hoverIdx] : null;
  const hoverX = hoverIdx != null ? xCenter(hoverIdx) : null;

  // tooltip 位置避免贴边
  const tipW = 130;
  const tipPad = 4;
  let tipX = hoverX != null ? hoverX + 8 : 0;
  if (tipX + tipW > width - padRight) tipX = hoverX - tipW - 8;
  if (tipX < padLeft) tipX = padLeft + 2;
  const tipY = padTop + 2;

  const rangeOptions = [
    { days: 30, label: '30D' },
    { days: 90, label: '90D' },
    { days: 180, label: '180D' },
    { days: 365, label: '1Y' },
  ];

  return (
    <div className="kline-frame">
      <div className="kline-title-row">
        <span>FIG. I · {currentRange}日 K 线 · MA20 · MA60</span>
        <span style={{ color: periodChange >= 0 ? 'var(--buy)' : 'var(--accent)' }}>
          区间 {periodChange >= 0 ? '+' : ''}{periodChange.toFixed(2)}%
        </span>
      </div>

      {onRangeChange && (
        <div
          style={{
            display: 'flex',
            gap: 4,
            marginBottom: 4,
            justifyContent: 'flex-end',
          }}
        >
          {rangeOptions.map((opt) => (
            <button
              key={opt.days}
              onClick={() => onRangeChange(opt.days)}
              className="kline-range-btn"
              data-active={currentRange === opt.days ? 'true' : 'false'}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ display: 'block', cursor: 'crosshair', touchAction: 'pan-y' }}
        preserveAspectRatio="xMidYMid meet"
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onTouchStart={handlePointerMove}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerLeave}
      >
        {/* 网格线 */}
        {yTicks.map((t, i) => (
          <line
            key={`g${i}`}
            x1={padLeft} x2={width - padRight}
            y1={t.y} y2={t.y}
            stroke="var(--ink-faded)"
            strokeWidth="0.4"
            strokeDasharray="2 3"
            opacity="0.45"
          />
        ))}

        {/* Y 轴价格刻度 */}
        {yTicks.map((t, i) => (
          <text
            key={`yt${i}`}
            x={padLeft - 4}
            y={t.y + 3}
            textAnchor="end"
            fontSize="8"
            fontFamily="'Courier Prime', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace"
            fill="var(--ink-faded)"
          >
            {t.v.toFixed(market === 'A' ? 2 : 2)}
          </text>
        ))}

        {/* X 轴日期 */}
        {dateTicks.map((t, i) => (
          <text
            key={`xt${i}`}
            x={xCenter(t.i)}
            y={height - 5}
            textAnchor="middle"
            fontSize="8"
            fontFamily="'Courier Prime', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace"
            fill="var(--ink-faded)"
          >
            {t.label}
          </text>
        ))}

        {/* MA60 (虚线 · 酒红) — 先画底层 */}
        {ma60Path && (
          <path
            d={ma60Path}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.2"
            strokeDasharray="3 2"
            opacity="0.85"
          />
        )}

        {/* MA20 (实线 · 墨色) */}
        {ma20Path && (
          <path
            d={ma20Path}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="1.3"
            opacity="0.9"
          />
        )}

        {/* 蜡烛 */}
        {klines.map((k, i) => {
          const cx = xCenter(i);
          const isUp = k.close >= k.open;
          const yHigh = yScale(k.high);
          const yLow = yScale(k.low);
          const yOpen = yScale(k.open);
          const yClose = yScale(k.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(0.8, Math.abs(yClose - yOpen));

          return (
            <g key={i}>
              {/* 影线 */}
              <line
                x1={cx} x2={cx}
                y1={yHigh} y2={yLow}
                stroke={isUp ? 'var(--buy)' : 'var(--sell)'}
                strokeWidth="0.7"
              />
              {/* 实体 */}
              <rect
                x={cx - candleW / 2}
                y={bodyTop}
                width={candleW}
                height={bodyH}
                fill={isUp ? 'var(--paper)' : 'var(--sell)'}
                stroke={isUp ? 'var(--buy)' : 'var(--sell)'}
                strokeWidth="0.7"
              />
            </g>
          );
        })}

        {/* ── Hover 十字光标 + tooltip ── */}
        {hoverK != null && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={hoverX} x2={hoverX}
              y1={padTop} y2={height - padBottom}
              stroke="var(--ink)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              opacity="0.55"
            />
            <line
              x1={padLeft} x2={width - padRight}
              y1={yScale(hoverK.close)} y2={yScale(hoverK.close)}
              stroke="var(--ink)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
              opacity="0.55"
            />
            {/* 收盘价右侧黑色标签 */}
            <rect
              x={width - padRight - 36}
              y={yScale(hoverK.close) - 7}
              width="36"
              height="13"
              fill="var(--ink)"
              opacity="0.92"
            />
            <text
              x={width - padRight - 18}
              y={yScale(hoverK.close) + 3}
              textAnchor="middle"
              fontSize="8"
              fontFamily="'Courier Prime', monospace"
              fill="var(--paper)"
              fontWeight="700"
            >
              {hoverK.close.toFixed(2)}
            </text>

            {/* Tooltip 浮窗 */}
            <rect
              x={tipX}
              y={tipY}
              width={tipW}
              height="62"
              fill="var(--paper)"
              stroke="var(--ink)"
              strokeWidth="0.7"
              opacity="0.97"
            />
            <text x={tipX + tipPad + 2} y={tipY + 11} fontSize="8.5" fontFamily="'Fraunces', serif" fontWeight="700" fill="var(--ink)">
              {hoverK.date}
            </text>
            <text x={tipX + tipPad + 2} y={tipY + 22} fontSize="7.5" fontFamily="'Courier Prime', monospace" fill="var(--ink-soft)">
              开 <tspan fill="var(--ink)" fontWeight="700">{hoverK.open.toFixed(2)}</tspan>
              <tspan dx="6">高</tspan> <tspan fill="var(--buy)" fontWeight="700">{hoverK.high.toFixed(2)}</tspan>
            </text>
            <text x={tipX + tipPad + 2} y={tipY + 32} fontSize="7.5" fontFamily="'Courier Prime', monospace" fill="var(--ink-soft)">
              收 <tspan fill={hoverK.close >= hoverK.open ? 'var(--buy)' : 'var(--sell)'} fontWeight="700">{hoverK.close.toFixed(2)}</tspan>
              <tspan dx="6">低</tspan> <tspan fill="var(--sell)" fontWeight="700">{hoverK.low.toFixed(2)}</tspan>
            </text>
            <text x={tipX + tipPad + 2} y={tipY + 42} fontSize="7.5" fontFamily="'Courier Prime', monospace" fill="var(--ink-soft)">
              MA20 <tspan fill="var(--ink)" fontWeight="700">{hoverK.ma20 != null ? hoverK.ma20.toFixed(2) : '—'}</tspan>
            </text>
            <text x={tipX + tipPad + 2} y={tipY + 52} fontSize="7.5" fontFamily="'Courier Prime', monospace" fill="var(--ink-soft)">
              MA60 <tspan fill="var(--accent)" fontWeight="700">{hoverK.ma60 != null ? hoverK.ma60.toFixed(2) : '—'}</tspan>
            </text>
          </g>
        )}
      </svg>

      <div className="kline-legend">
        <span className="kline-legend-item">
          <span className="kline-legend-mark" style={{ background: 'var(--ink)' }} />
          MA20 {last.ma20 != null ? last.ma20.toFixed(2) : '—'}
        </span>
        <span className="kline-legend-item">
          <span
            className="kline-legend-mark"
            style={{ background: 'transparent', borderTop: '2px dashed var(--accent)' }}
          />
          MA60 {last.ma60 != null ? last.ma60.toFixed(2) : '—'}
        </span>
        <span className="kline-legend-item" style={{ marginLeft: 'auto' }}>
          收 {last.close.toFixed(2)}
        </span>
      </div>
    </div>
  );
};

