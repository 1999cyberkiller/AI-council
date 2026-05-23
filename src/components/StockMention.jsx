/* ──────────────────────────────────────────────────────────────────
   STOCK MENTION · 议会文本中的可跳转股票名 chip
   - hover/focus 显示预览（市场标签 + "召集议会"按钮）
   - 点击不立即触发，避免误触；明确"召集"按钮才执行
   - 当前正在分析的股票名不渲染成 chip（避免自我引用循环）
   ────────────────────────────────────────────────────────────────── */

import React, { useState, useRef, useEffect } from 'react';
import { tokenizeWithMentions } from '../lib/stockMentions';

export const StockMention = ({ code, name, market, label, onSummon, currentCode }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 当前正在分析的股票，不弹预览，仅显示为普通强调
  const isSelf = currentCode && String(currentCode).toUpperCase() === String(code).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('touchstart', onClickOutside);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('touchstart', onClickOutside);
    };
  }, [open]);

  if (isSelf) {
    return <span className="stock-mention stock-mention--self">{label}</span>;
  }

  return (
    <span className="stock-mention-wrap" ref={ref}>
      <button
        className="stock-mention"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {label}
      </button>
      {open && (
        <span className="stock-mention-popover" role="dialog">
          <span className="stock-mention-popover-row">
            <span className="stock-mention-popover-name">{name}</span>
            <span className="stock-mention-popover-code">{code}</span>
          </span>
          <span className="stock-mention-popover-meta">
            {market === 'A' ? 'A 股' : '美股'}
          </span>
          <button
            className="stock-mention-summon-btn"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              if (onSummon) onSummon(code);
            }}
          >
            ▶ 召集本期议会
          </button>
        </span>
      )}
    </span>
  );
};

/**
 * 把一个字符串里的股票名标注出来，渲染成 React 节点数组
 * @param {string} text       原文
 * @param {Array} dictionary  字典（已构建好）
 * @param {string} currentCode 当前正在分析的代码（用于避免自引用）
 * @param {Function} onSummon callback(code)
 * @returns React 节点数组
 */
export function renderWithMentions(text, dictionary, currentCode, onSummon) {
  if (!text || !dictionary || dictionary.length === 0) return text;
  const tokens = tokenizeWithMentions(text, dictionary);
  return tokens.map((t, i) => {
    if (t.type === 'mention') {
      return (
        <StockMention
          key={`m-${i}`}
          code={t.code}
          name={t.name}
          market={t.market}
          label={t.value}
          onSummon={onSummon}
          currentCode={currentCode}
        />
      );
    }
    return <React.Fragment key={`t-${i}`}>{t.value}</React.Fragment>;
  });
}
