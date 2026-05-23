import React, { useEffect, useState } from 'react';

const FIELDS = [
  { key: 'thesis', label: '核心判断', rows: 2 },
  { key: 'bullCase', label: '买入理由', rows: 4 },
  { key: 'bearCase', label: '反方理由', rows: 4 },
  { key: 'catalysts', label: '关键催化', rows: 3 },
  { key: 'invalidation', label: '失效条件', rows: 3 },
  { key: 'notes', label: '手记', rows: 3 },
];

export const InvestmentMemoSection = ({
  stockData,
  memo,
  draft,
  onSave,
  onReset,
  onExport,
}) => {
  const [localMemo, setLocalMemo] = useState(memo || draft);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLocalMemo(memo || draft);
    setDirty(false);
  }, [memo, draft, stockData?.code]);

  if (!stockData || !localMemo) return null;

  const update = (key, value) => {
    setLocalMemo((prev) => ({ ...prev, [key]: value, updatedAt: Date.now() }));
    setDirty(true);
  };

  const save = () => {
    onSave(localMemo);
    setDirty(false);
  };

  const reset = () => {
    setLocalMemo(draft);
    onReset(draft);
    setDirty(false);
  };

  return (
    <section className="investment-memo fade-up">
      <div className="investment-memo-head">
        <div>
          <div className="mono small-caps investment-memo-kicker">MEMO · 研 究 闭 环</div>
          <h3 className="display-serif investment-memo-title">投资备忘录</h3>
        </div>
        <div className="investment-memo-actions">
          <label className="memo-date">
            <span>下次复盘</span>
            <input
              type="date"
              value={localMemo.nextReview || ''}
              onChange={(e) => update('nextReview', e.target.value)}
            />
          </label>
          <button className="btn-ghost" onClick={reset}>重生成</button>
          <button className="btn-ghost" onClick={onExport}>导出</button>
          <button className="btn-primary memo-save" onClick={save} disabled={!dirty}>
            {dirty ? '保存备忘录' : '已保存'}
          </button>
        </div>
      </div>

      <div className="investment-memo-grid">
        {FIELDS.map((field) => (
          <label key={field.key} className={`memo-field memo-field--${field.key}`}>
            <span>{field.label}</span>
            <textarea
              value={localMemo[field.key] || ''}
              rows={field.rows}
              onChange={(e) => update(field.key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </section>
  );
};
