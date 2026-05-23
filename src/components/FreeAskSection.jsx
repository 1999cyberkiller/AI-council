/* ──────────────────────────────────────────────────────────────────
   FREE ASK SECTION · 用户自由追问
   - 输入框 + 分析师 chip 多选（1-2 位）
   - 提交后 1-2 位并行回应
   - 选了 ≥2 位时主编综合
   - 多次追问累积显示
   ────────────────────────────────────────────────────────────────── */

import React, { useState } from 'react';

const VERDICT_LABEL = { BUY: '买入', HOLD: '持有', SELL: '卖出' };

const AnswerCard = ({ answer }) => {
  if (!answer) return null;
  if (answer.status === 'pending') {
    return (
      <div className="fa-answer fa-answer--pending">
        <div className="fa-answer-head">
          <span className="fa-answer-name">{answer.analystName}</span>
          <span className="fa-answer-loading">正在回答…</span>
        </div>
      </div>
    );
  }
  if (answer.status === 'error') {
    return (
      <div className="fa-answer fa-answer--error">
        <div className="fa-answer-head">
          <span className="fa-answer-name">{answer.analystName}</span>
          <span className="fa-answer-err">未交稿：{answer.error}</span>
        </div>
      </div>
    );
  }
  const d = answer.data;
  if (!d) return null;
  const shifted = d.stance_shift && d.stance_shift !== 'unchanged';
  return (
    <div className={`fa-answer ${shifted ? 'fa-answer--shifted' : ''}`}>
      <div className="fa-answer-head">
        <span className="fa-answer-name">{answer.analystName}</span>
        <span className="fa-answer-meta">
          {shifted && (
            <span className="fa-shift-badge" title={`立场调整为 ${VERDICT_LABEL[d.stance_shift] || d.stance_shift}`}>
              ⚡ 立场调整 → {d.stance_shift}
            </span>
          )}
          <span className="fa-confidence">信心 {d.confidence}/5</span>
        </span>
      </div>
      <div className="fa-answer-body body-serif">{d.answer}</div>
    </div>
  );
};

export const FreeAskSection = ({
  analysts,           // [{ id, cnName, ... }] from ANALYSTS
  analyses,           // current state (with done/pending/error)
  threads,            // accumulated free-ask threads: [{ question, picks: [id..], answers, editorFinal }]
  onSubmit,           // (question, pickedIds) => Promise
  isRunning,
}) => {
  const [question, setQuestion] = useState('');
  const [pickedIds, setPickedIds] = useState([]);

  // 只允许已完成的分析师被选
  const eligibleAnalysts = analysts.filter((a) => analyses[a.id]?.status === 'done');

  const togglePick = (id) => {
    setPickedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev; // 上限 2 位
      return [...prev, id];
    });
  };

  const canSubmit =
    !isRunning && question.trim().length >= 4 && pickedIds.length >= 1;

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(question.trim(), pickedIds);
    setQuestion('');
    setPickedIds([]);
  };

  return (
    <section className="free-ask-wrap">
      <div className="free-ask-header">
        <div>
          <div className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', letterSpacing: '0.12em' }}>
            FREE ASK · 自 由 追 问
          </div>
          <div className="display-serif" style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: 4 }}>
            向作者直接提问
          </div>
        </div>
      </div>

      <div className="free-ask-body">
        {/* 累积的追问轨迹 */}
        {threads.length > 0 && (
          <div className="fa-threads">
            {threads.map((thread, idx) => (
              <div key={idx} className="fa-thread">
                <div className="fa-question">
                  <span className="fa-q-marker">问</span>
                  <span className="fa-q-text">{thread.question}</span>
                  <span className="fa-q-picks">
                    （问 {thread.picks.map((id) => analysts.find((a) => a.id === id)?.cnName).filter(Boolean).join('、')}）
                  </span>
                </div>
                <div className="fa-answers">
                  {(thread.answers || []).map((a, i) => (
                    <AnswerCard key={i} answer={a} />
                  ))}
                </div>
                {thread.editorFinal && (
                  <div className="fa-editor">
                    {thread.editorFinal.status === 'pending' && (
                      <span className="fa-editor-loading">主编正在综合…</span>
                    )}
                    {thread.editorFinal.status === 'error' && (
                      <span className="fa-editor-err">主编综合失败：{thread.editorFinal.error}</span>
                    )}
                    {thread.editorFinal.status === 'done' && (
                      <>
                        <div className="fa-editor-head">
                          <span className="mono small-caps" style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', letterSpacing: '0.12em' }}>
                            ◆ 主 编 综 合
                          </span>
                          {thread.editorFinal.data.consensus && (
                            <span className="fa-editor-consensus">{thread.editorFinal.data.consensus}</span>
                          )}
                        </div>
                        <div className="body-serif fa-editor-synthesis">
                          {thread.editorFinal.data.synthesis}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 新追问输入区 */}
        {eligibleAnalysts.length === 0 ? (
          <div className="fa-empty body-serif">
            议会还没完成。等所有作者交稿后即可在这里提问。
          </div>
        ) : (
          <div className="fa-input-block">
            <textarea
              className="fa-textarea"
              placeholder="问个具体问题——比如：『PE 计算是否考虑了摊薄股本？』"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              maxLength={300}
              disabled={isRunning}
            />
            <div className="fa-controls">
              <div className="fa-picks-row">
                <span className="fa-picks-label">问谁？</span>
                <span className="fa-picks-chips">
                  {eligibleAnalysts.map((a) => (
                    <button
                      key={a.id}
                      className={`fa-pick-chip ${pickedIds.includes(a.id) ? 'fa-pick-chip--active' : ''}`}
                      onClick={() => togglePick(a.id)}
                      disabled={isRunning}
                    >
                      {a.cnName}
                    </button>
                  ))}
                </span>
                <span className="fa-picks-hint">
                  选 1-2 位 · 已选 {pickedIds.length}/2
                </span>
              </div>
              <button
                className="fa-submit-btn"
                onClick={submit}
                disabled={!canSubmit}
              >
                {isRunning ? '议会回应中…' : '▶ 提交追问'}
              </button>
            </div>
            <div className="fa-cost-note">
              {pickedIds.length >= 2 ? '约 3 次模型调用（2 位回答 + 1 位主编综合）' : '约 1 次模型调用'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
