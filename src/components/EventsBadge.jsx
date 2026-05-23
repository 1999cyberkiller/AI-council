/* ──────────────────────────────────────────────────────────────────
   EVENTS BADGE · 报头下方的事件提示
   - 显示距下次财报 + 分红的天数
   - 缺少美股 Finnhub key 时显示一行提示
   - 数据空时不渲染
   ────────────────────────────────────────────────────────────────── */

import React from 'react';

const ICONS = {
  earnings: '📊',
  dividend: '💰',
  lockup: '🔓',
};

const TYPE_CN = {
  earnings: '财报',
  dividend: '分红',
  lockup: '解禁',
};

function formatDaysUntil(days, type) {
  if (days == null) return null;
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days < 0) return `${-days} 天前公布`;
  return `${days} 天后`;
}

function urgencyClass(days) {
  if (days == null) return 'ev-far';
  if (days <= 3) return 'ev-urgent';   // ≤3 天，红色
  if (days <= 14) return 'ev-soon';    // ≤14 天，琥珀
  return 'ev-far';                     // >14 天，淡灰
}

export const EventsBadge = ({ eventsData, consensusData, finnhubKeyConfigured }) => {
  const hasEvents = eventsData && Array.isArray(eventsData.events) && eventsData.events.length > 0;
  const hasConsensus = consensusData && consensusData.data;
  const market = eventsData?.market || consensusData?.data?.market;
  const hasMissingKey = (eventsData?.hasMissingKey || consensusData?.hasMissingKey);

  // 全部空 + 美股缺 key：提示
  if (!hasEvents && !hasConsensus) {
    if (market === 'US' && hasMissingKey) {
      return (
        <div className="events-badge events-badge--hint">
          <span className="ev-icon">⚙</span>
          <span>美股事件/共识数据需在配置中添加 Finnhub key</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="events-badge">
      {/* 共识 chip (V20) */}
      {hasConsensus && (() => {
        const c = consensusData.data;
        const total = (c.buyCount || 0) + (c.holdCount || 0) + (c.sellCount || 0);
        const tone = c.overall === 'strong_buy' || c.overall === 'buy' ? 'ev-buy'
          : c.overall === 'strong_sell' || c.overall === 'sell' ? 'ev-sell'
          : 'ev-soon';
        const upsidePart = c.targetUpside != null
          ? ` · 目标 ${c.targetUpside >= 0 ? '+' : ''}${(c.targetUpside * 100).toFixed(0)}%`
          : '';
        const titleParts = [];
        if (total > 0) titleParts.push(`${total} 家：买 ${c.buyCount} / 持 ${c.holdCount} / 卖 ${c.sellCount}`);
        if (c.targetPrice) {
          const ccy = c.market === 'A' ? '元' : 'USD';
          titleParts.push(`共识目标价 ${c.targetPrice.toFixed(2)}${ccy}`);
        }
        if (c.latestDate) titleParts.push(`最新评级 ${c.latestDate}`);
        return (
          <span className={`ev-item ${tone}`} title={titleParts.join(' · ')}>
            <span className="ev-icon">📈</span>
            <span className="ev-type">共识</span>
            <span className="ev-when">{c.overallLabel || '—'}{upsidePart}</span>
          </span>
        );
      })()}

      {/* events chips */}
      {hasEvents && eventsData.events.map((ev, i) => {
        const urgent = urgencyClass(ev.daysUntil);
        const cn = TYPE_CN[ev.type] || ev.type;
        const timeLabel = formatDaysUntil(ev.daysUntil, ev.type);
        const dateLabel = ev.date ? ` · ${ev.date}` : '';
        return (
          <span key={`${ev.type}-${i}`} className={`ev-item ${urgent}`} title={`${ev.label || cn}${dateLabel}`}>
            <span className="ev-icon">{ICONS[ev.type] || '·'}</span>
            <span className="ev-type">{cn}</span>
            <span className="ev-when">{timeLabel}</span>
          </span>
        );
      })}
    </div>
  );
};
