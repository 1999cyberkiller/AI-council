/* ──────────────────────────────────────────────────────────────────
   DATA GAP PANEL · 数据缺口面板
   汇总四位分析师 + 主编对"做出更可靠结论还缺少哪些公开数据"的标注。
   优先用主编的 aggregated_data_gaps（已做跨人去重）；如果主编未完成或
   未给出，回退到客户端聚类（共同长子串匹配）。
   ────────────────────────────────────────────────────────────────── */

import React, { useMemo } from 'react';
import { ANALYSTS } from '../lib/prompts';
import { NO_GAP_PATTERN } from '../lib/constants';

// 共同子串匹配：判断两条缺口是否谈的是同一回事
function gapsSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // 剥离常见前缀 + 中文数字（"一季度" / "二季度" 不应阻碍匹配）
  const strip = (s) =>
    s.replace(/^(缺少|没有|缺乏|未见|没找到)\s*/, '')
     .replace(/[一二三四五六七八九十零]/g, '');
  const ac = strip(a);
  const bc = strip(b);
  if (!ac || !bc) return false;
  // 短串：4 字前缀完全相同即视为同主题
  if (ac.slice(0, 4) === bc.slice(0, 4) && ac.length >= 4) return true;
  // 长串：任意 5 字连续子串在对方里出现即视为同主题
  const short = ac.length <= bc.length ? ac : bc;
  const long = ac.length <= bc.length ? bc : ac;
  for (let i = 0; i <= short.length - 5; i++) {
    if (long.includes(short.slice(i, i + 5))) return true;
  }
  return false;
}

export const DataGapPanel = ({ analyses, editorState }) => {
  // 客户端聚合：按共同子串聚类，统计每条缺口被几位提到
  const clusteredGaps = useMemo(() => {
    const clusters = []; // [{ text, by: Set<string> }]
    ANALYSTS.forEach((a) => {
      const st = analyses?.[a.id];
      const gaps = st?.status === 'done' ? st.data?.data_gaps : null;
      if (!Array.isArray(gaps)) return;
      gaps.forEach((g) => {
        if (!g || typeof g !== 'string') return;
        if (NO_GAP_PATTERN.test(g.trim())) return;
        const existing = clusters.find((c) => gapsSimilar(c.text, g));
        if (existing) {
          existing.by.add(a.cnName);
          // 取更长的描述作为代表（信息量大）
          if (g.length > existing.text.length) existing.text = g;
        } else {
          clusters.push({ text: g.trim(), by: new Set([a.cnName]) });
        }
      });
    });
    return clusters
      .map((c) => ({ text: c.text, by: Array.from(c.by) }))
      .sort((x, y) => y.by.length - x.by.length);
  }, [analyses]);

  const editorGaps = editorState?.status === 'done'
    ? editorState.data?.aggregated_data_gaps || []
    : [];

  // 主编版优先；如果主编版给的就是"无明显缺口"语义，就让位给客户端聚合
  const editorGapsValid = editorGaps.filter((g) => !NO_GAP_PATTERN.test(g));
  const useEditorSource = editorGapsValid.length > 0;

  // 客户端聚合中只展示被 ≥1 位提到的；若主编版可用，则只补充主编没覆盖的"≥2 位提到"的项
  const clientGaps = useEditorSource
    ? clusteredGaps.filter((c) => c.by.length >= 2 && !editorGapsValid.some((eg) =>
        gapsSimilar(eg, c.text)
      ))
    : clusteredGaps;

  if (editorGapsValid.length === 0 && clientGaps.length === 0) return null;

  return (
    <section className="data-gap-panel fade-up">
      <div className="data-gap-header">
        <div
          className="mono small-caps"
          style={{
            fontSize: '0.7rem',
            letterSpacing: '0.28em',
            color: 'var(--accent-soft)',
          }}
        >
          ◆ DATA GAPS · 数 据 缺 口 ◆
        </div>
        <div
          className="body-serif"
          style={{
            fontSize: '0.78rem',
            color: 'var(--ink-soft)',
            fontStyle: 'italic',
            marginTop: 4,
          }}
        >
          做出更可靠结论还缺少这些公开数据。这是行动指引，比结论本身更值得追问。
        </div>
      </div>

      <div className="data-gap-body">
        {/* 主编综合视角（如果有） */}
        {useEditorSource && editorGapsValid.length > 0 && (
          <div className="data-gap-block">
            <div className="data-gap-source">
              <span className="cd-chip cd-chip--editor">主编综合</span>
            </div>
            <ul className="data-gap-list">
              {editorGapsValid.map((g, i) => (
                <li key={i}>
                  <span style={{ color: 'var(--accent-soft)', marginRight: 6 }}>▸</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 客户端聚合（≥2 位提到的；或主编未启用时全部） */}
        {clientGaps.length > 0 && (
          <div className="data-gap-block">
            <div className="data-gap-source">
              <span className="cd-chip cd-chip--neutral">
                {useEditorSource ? '其他高频缺口' : '四篇专栏聚合'}
              </span>
            </div>
            <ul className="data-gap-list">
              {clientGaps.map((c, i) => (
                <li key={i}>
                  <span style={{ color: 'var(--accent-soft)', marginRight: 6 }}>▸</span>
                  {c.text}
                  <span className="data-gap-attribution">
                    {c.by.length >= 2 && <strong>{c.by.length} 位提到 · </strong>}
                    {c.by.join('、')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};
