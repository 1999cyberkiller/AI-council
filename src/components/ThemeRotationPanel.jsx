import React, { useMemo } from 'react';

const fmt = (value, suffix = '') => (
  typeof value === 'number' && Number.isFinite(value) ? `${value}${suffix}` : '—'
);

const stateClass = (state) => {
  if (state === 2 || state === 1) return 'theme-rotation-state--good';
  if (state === 3) return 'theme-rotation-state--hot';
  if (state < 0) return 'theme-rotation-state--bad';
  return 'theme-rotation-state--neutral';
};

export const ThemeRotationPanel = ({ snapshot }) => {
  const themes = Array.isArray(snapshot?.themes) ? snapshot.themes : [];
  const leaders = useMemo(
    () => themes
      .filter((t) => t.available && typeof t.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
    [themes]
  );
  if (!snapshot || themes.length === 0) return null;

  return (
    <section className="theme-rotation-panel fade-up">
      <div className="theme-rotation-head">
        <div>
          <div className="mono small-caps theme-rotation-kicker">◆ THEME ROTATION · 科 技 主 题 轮 动 ◆</div>
          <h3 className="display-serif theme-rotation-title">科技主题轮动快照</h3>
        </div>
        <div className="mono theme-rotation-meta">
          {snapshot.as_of || '—'} · 基准 {snapshot.benchmark || 'QQQ'}
        </div>
      </div>

      {leaders.length > 0 && (
        <div className="theme-rotation-leaders">
          {leaders.map((item) => (
            <div className="theme-rotation-leader" key={item.name}>
              <span>{item.name}</span>
              <strong>{item.score}</strong>
              <em>{item.state_label}</em>
            </div>
          ))}
        </div>
      )}

      <div className="theme-rotation-table-wrap">
        <table className="theme-rotation-table">
          <thead>
            <tr>
              <th>主题</th>
              <th>代理</th>
              <th>评分</th>
              <th>状态</th>
              <th>5D</th>
              <th>20D</th>
              <th>量比</th>
              <th>广度</th>
              <th>覆盖</th>
            </tr>
          </thead>
          <tbody>
            {themes.map((item) => (
              <tr key={`${item.kind}-${item.name}`}>
                <td>{item.name}</td>
                <td className="mono">{item.proxy}</td>
                <td className="theme-rotation-score">{fmt(item.score)}</td>
                <td>
                  <span className={`theme-rotation-state ${stateClass(item.state)}`}>
                    {item.state_label || '无数据'}
                  </span>
                </td>
                <td>{fmt(item.rel5, '%')}</td>
                <td>{fmt(item.rel20, '%')}</td>
                <td>{fmt(item.vol_ratio, 'x')}</td>
                <td>
                  {fmt(item.breadth, '%')}
                  {item.breadth_is_proxy && <sup>*</sup>}
                </td>
                <td className="mono">{item.coverage || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="theme-rotation-signals">
        <div className="display-serif theme-rotation-signals-title">内部张力信号</div>
        {(snapshot.disagreement_signals?.length ? snapshot.disagreement_signals : ['本快照未检测到明显内部张力信号']).slice(0, 4).map((signal) => (
          <div className="theme-rotation-signal" key={signal}>▸ {signal}</div>
        ))}
        <div className="theme-rotation-note">* ETF 广度为 70/30 代理，不等于真实成分股广度。</div>
      </div>
    </section>
  );
};
