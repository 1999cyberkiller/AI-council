/* ──────────────────────────────────────────────────────────────────
   NEWS BADGE · 近期资讯折叠条
   - 默认折叠 (summary 形态)：N 条 · 最新 X 小时前
   - 展开后显示完整列表，每条带 source · datetime · headline · summary · link
   - 跟 FinancialsBadge 同形态
   ────────────────────────────────────────────────────────────────── */

import React, { useState } from 'react';

function fmtRelative(timestamp) {
  if (!timestamp) return '';
  const ms = Date.now() - (typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime());
  if (isNaN(ms)) return '';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h <= 0) return `${m} 分钟前`;
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

function parseTimestamp(item) {
  if (item.timestamp) return item.timestamp;
  if (item.datetime) {
    const t = new Date(item.datetime.replace(' ', 'T')).getTime();
    return isNaN(t) ? null : t;
  }
  return null;
}

export const NewsBadge = ({ newsData }) => {
  const [expanded, setExpanded] = useState(false);
  if (!newsData || !Array.isArray(newsData.items) || newsData.items.length === 0) {
    return null;
  }

  const items = newsData.items;
  const newest = items[0];
  const newestTs = parseTimestamp(newest);
  const sources = [...new Set(items.map((i) => i.source).filter(Boolean))].slice(0, 3);

  return (
    <div className="news-badge">
      <button
        className="news-badge-summary"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title="点击展开完整资讯列表"
      >
        <span className="mono small-caps news-badge-label">近期资讯</span>
        <span className="news-badge-meta">
          <span className="news-count">{items.length} 条</span>
          {newestTs && (
            <span className="news-newest">· 最新 {fmtRelative(newestTs)}</span>
          )}
          {sources.length > 0 && (
            <span className="news-sources">· {sources.join('、')}</span>
          )}
        </span>
        <span className="news-badge-toggle">{expanded ? '收起 ▴' : '展开 ▾'}</span>
      </button>

      {expanded && (
        <div className="news-badge-list">
          {items.map((item, i) => (
            <div key={i} className="news-item">
              <div className="news-item-head">
                <span className="news-item-datetime">{item.datetime || '—'}</span>
                {item.source && <span className="news-item-source">· {item.source}</span>}
              </div>
              <div className="news-item-headline">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer">{item.headline}</a>
                ) : (
                  item.headline
                )}
              </div>
              {item.summary && item.summary.length > 10 && (
                <div className="news-item-summary body-serif">{item.summary}</div>
              )}
            </div>
          ))}
          <div className="news-list-note">
            数据来源：{newsData.market === 'A' ? '东方财富' : 'Finnhub'} · 30 分钟缓存 · 主编综合时会引用
          </div>
        </div>
      )}
    </div>
  );
};
