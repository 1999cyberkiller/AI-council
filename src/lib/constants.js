/* ──────────────────────────────────────────────────────────────────
   DOMAIN CONSTANTS · 跨组件共享
   ────────────────────────────────────────────────────────────────── */

import { ANALYSTS } from './prompts';

export const ANALYSTS_COUNT = ANALYSTS.length;

// 分歧根因（来自主编归因）→ 中文短标签
export const ROOT_CAUSE_CN = {
  data_interpretation: '数据解读',
  reasoning_path: '推理路径',
  risk_appetite: '风险偏好',
  framework_choice: '框架差异',
};

// "无数据缺口"语义判定 —— 出现在分析师/主编 data_gaps 数组里时跳过聚合
export const NO_GAP_PATTERN = /^(无|没有|无明显|四方一致|公开数据.*足够|信息.*足够|不存在|未列出|—|-)/i;
