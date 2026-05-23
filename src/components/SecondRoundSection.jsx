/* ──────────────────────────────────────────────────────────────────
   SECOND ROUND SECTION · 议会二次审稿展示
   - 主编札记下方追加，默认展开
   - 显示两位对立分析师的回应 + 主编的综合
   - 主编立场变化时高亮 shifted 徽章
   ────────────────────────────────────────────────────────────────── */

import React, { useState } from 'react';

const VERDICT_LABEL = {
  BUY: '建议买入',
  SELL: '建议卖出',
  HOLD: '建议持有',
};

const VerdictPill = ({ verdict, conviction, size = 'sm' }) => {
  if (!verdict) return null;
  const cls =
    verdict === 'BUY' ? 'sr-pill sr-pill--buy'
    : verdict === 'SELL' ? 'sr-pill sr-pill--sell'
    : 'sr-pill sr-pill--hold';
  return (
    <span className={`${cls} sr-pill--${size}`}>
      {verdict}
      {conviction != null && <span className="sr-pill-conv">·{conviction}</span>}
    </span>
  );
};

const RebuttalCard = ({ rebuttal }) => {
  if (!rebuttal) return null;
  if (rebuttal.status === 'pending') {
    return (
      <div className="sr-rebut sr-rebut--pending">
        <div className="sr-rebut-head">
          <span className="sr-rebut-name">{rebuttal.analystName}</span>
          <span className="sr-rebut-loading">正在回应…</span>
        </div>
      </div>
    );
  }
  if (rebuttal.status === 'error') {
    return (
      <div className="sr-rebut sr-rebut--error">
        <div className="sr-rebut-head">
          <span className="sr-rebut-name">{rebuttal.analystName}</span>
          <span className="sr-rebut-err">未交稿：{rebuttal.error}</span>
        </div>
      </div>
    );
  }
  const d = rebuttal.data;
  if (!d) return null;
  return (
    <div className="sr-rebut">
      <div className="sr-rebut-head">
        <span className="sr-rebut-name">{rebuttal.analystName}</span>
        <VerdictPill verdict={d.refined_verdict} conviction={d.refined_conviction} />
      </div>
      <div className="sr-rebut-body body-serif">{d.rebuttal}</div>
    </div>
  );
};

export const SecondRoundSection = ({ secondRound }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (!secondRound || !Array.isArray(secondRound.topics) || secondRound.topics.length === 0) {
    return null;
  }

  return (
    <section className="second-round-wrap">
      <div className="second-round-header">
        <div>
          <div className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)' }}>
            ROUND TWO · 二 次 审 稿
          </div>
          <div className="display-serif" style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: 4 }}>
            {secondRound.topics.length === 1 ? '追问主要分歧' : `追问已展开 ${secondRound.topics.length} 个分歧`}
          </div>
        </div>
        <button
          className="sr-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          {collapsed ? '展开' : '收起'} {collapsed ? '▾' : '▴'}
        </button>
      </div>

      {!collapsed && (
        <div className="second-round-body">
          {secondRound.topics.map((topic, idx) => (
            <div key={idx} className="sr-topic">
              <div className="sr-topic-label">
                <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--ink-faded)', letterSpacing: '0.1em' }}>
                  分歧 #{idx + 1}
                </span>
                <span className="sr-topic-title">{topic.topic}</span>
              </div>

              <div className="sr-rebuttals">
                {(topic.rebuttals || []).map((r, i) => (
                  <RebuttalCard key={i} rebuttal={r} />
                ))}
              </div>

              {topic.editorFinal && topic.editorFinal.status === 'pending' && (
                <div className="sr-editor sr-editor--pending">
                  <div className="sr-editor-loading">主编正在综合两位回应…</div>
                </div>
              )}
              {topic.editorFinal && topic.editorFinal.status === 'error' && (
                <div className="sr-editor sr-editor--error">
                  主编综合失败：{topic.editorFinal.error}
                </div>
              )}
              {topic.editorFinal && topic.editorFinal.status === 'done' && (
                <div className={`sr-editor ${topic.editorFinal.data.shifted ? 'sr-editor--shifted' : ''}`}>
                  <div className="sr-editor-head">
                    <span className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', letterSpacing: '0.12em' }}>
                      ◆ 主 编 二 审
                    </span>
                    <div className="sr-editor-verdict">
                      <VerdictPill
                        verdict={topic.editorFinal.data.verdict}
                        conviction={topic.editorFinal.data.conviction}
                        size="md"
                      />
                      {topic.editorFinal.data.shifted && (
                        <span className="sr-shifted-badge" title={topic.editorFinal.data.shift_reason || ''}>
                          ⚡ 立场调整
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="display-serif sr-editor-headline">
                    {topic.editorFinal.data.headline}
                  </div>
                  <div className="body-serif sr-editor-synthesis">
                    {topic.editorFinal.data.synthesis}
                  </div>
                  {topic.editorFinal.data.shifted && topic.editorFinal.data.shift_reason && (
                    <div className="sr-shift-reason">
                      <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--accent)', letterSpacing: '0.08em' }}>
                        调整原因
                      </span>
                      <span className="body-serif" style={{ fontSize: '0.86rem', fontStyle: 'italic' }}>
                        {topic.editorFinal.data.shift_reason}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
