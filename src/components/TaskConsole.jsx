import React from 'react';

const STATUS_CN = {
  idle: '待命',
  pending: '进行中',
  ok: '完成',
  warning: '降级',
  error: '失败',
  stopped: '已停止',
};

function fmtMs(ms) {
  if (typeof ms !== 'number') return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const TaskConsole = ({ tasks = {}, running, onStop, onRetryFailed }) => {
  const items = Object.entries(tasks || {}).map(([id, task]) => ({ id, ...task }));
  if (items.length === 0) return null;

  const retryableFailed = items.filter((t) => t.id.startsWith('analyst:') && t.status === 'error').length;
  const active = items.filter((t) => t.status === 'pending').length;
  const done = items.filter((t) => ['ok', 'warning', 'error', 'stopped'].includes(t.status)).length;

  return (
    <section className="task-console fade-up">
      <div className="task-console-head">
        <div>
          <div className="mono small-caps task-console-kicker">◆ RUN CONSOLE · 分 析 任 务 控 制 台</div>
          <div className="body-serif task-console-sub">
            每个模型独立计时。单个模型失败不会拖死整场。
          </div>
        </div>
        <div className="task-console-actions">
          <span className="mono task-console-count">
            {done}/{items.length} · {active > 0 ? `${active} 进行中` : '已稳定'}
          </span>
          {retryableFailed > 0 && onRetryFailed && (
            <button className="btn-ghost task-console-btn" onClick={onRetryFailed} disabled={running}>
              重试失败
            </button>
          )}
          {running && onStop && (
            <button className="btn-ghost task-console-btn task-console-stop" onClick={onStop}>
              停止本次
            </button>
          )}
        </div>
      </div>
      <div className="task-console-grid">
        {items.map((task) => (
          <div className={`task-card task-card--${task.status || 'idle'}`} key={task.id}>
            <div className="task-card-top">
              <span className="display-serif task-card-title">{task.label || task.id}</span>
              <span className="task-card-pill">{STATUS_CN[task.status] || task.status || '待命'}</span>
            </div>
            <div className="mono task-card-meta">
              {task.modelName || '—'}
              {task.variant ? ` · ${task.variant}` : ''}
              {task.ms ? ` · ${fmtMs(task.ms)}` : ''}
            </div>
            {task.fallbackFrom && (
              <div className="mono task-card-fallback">
                已从 {task.fallbackFrom} 降级
              </div>
            )}
            {task.error && (
              <div className="mono task-card-error">{task.error}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
