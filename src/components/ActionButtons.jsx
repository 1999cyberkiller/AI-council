/* ──────────────────────────────────────────────────────────────────
   ACTION BUTTONS · 顶部六枚功能按钮（主题/自选股/对比/历史/准确率/配置）
   - 默认嵌在 masthead 第一行（不会遮挡）
   - 滚动后切到 sticky 浮窗（保持触达）
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect } from 'react';

const STICKY_THRESHOLD_PX = 180; // 滚过 masthead 高度后切到浮动

export const ActionButtons = ({
  theme, onToggleTheme,
  watchlistCount, onOpenWatchlist,
  tabsCount, onOpenCompare, compareDisabled,
  historyCount, onOpenHistory,
  hasOverdue, onOpenCredibility,
  hasAnyConfig, onOpenSettings,
}) => {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = window.scrollY > STICKY_THRESHOLD_PX;
      setScrolled((current) => (current === next ? current : next));
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={`action-bar ${scrolled ? 'action-bar--sticky' : ''}`}>
      <button
        className="action-btn"
        onClick={onToggleTheme}
        aria-label={theme === 'dark' ? '切换到日光' : '切换到夜读'}
        aria-pressed={theme === 'dark'}
        title={theme === 'dark' ? '切换到日光版' : '切换到夜读版'}
      >
        <span className="action-btn__label">{theme === 'dark' ? '日光' : '夜读'}</span>
      </button>

      <button
        className="action-btn"
        onClick={onOpenWatchlist}
        aria-label="自选股"
        title="自选股 · Watchlist"
      >
        <span className="action-btn__label">自选</span>
        {watchlistCount > 0 && (
          <span className="action-btn-badge">
            {watchlistCount > 99 ? '99+' : watchlistCount}
          </span>
        )}
      </button>

      <button
        className="action-btn"
        onClick={onOpenCompare}
        aria-label="横向对比"
        title="横向对比 · Cross Compare"
        disabled={compareDisabled}
      >
        <span className="action-btn__label">对比</span>
        {tabsCount >= 2 && (
          <span className="action-btn-badge">
            {Math.min(tabsCount, 99)}
          </span>
        )}
      </button>

      <button
        className="action-btn"
        onClick={onOpenHistory}
        aria-label="历史档案"
        title="历史档案 · Archive"
      >
        <span className="action-btn__label">档案</span>
        {historyCount > 0 && (
          <span className="action-btn-badge">
            {historyCount > 99 ? '99+' : historyCount}
          </span>
        )}
      </button>

      <button
        className="action-btn"
        onClick={onOpenCredibility}
        aria-label="准确率档案"
        title="准确率档案 · Credibility"
      >
        <span className="action-btn__label">胜率</span>
        {hasOverdue && <span className="action-btn-dot" />}
      </button>

      <button
        className="action-btn"
        onClick={onOpenSettings}
        aria-label="编辑部配置"
        title="编辑部配置 · Editorial Setup"
      >
        <span className="action-btn__label">设置</span>
        {!hasAnyConfig && <span className="action-btn-dot" />}
      </button>
    </div>
  );
};
