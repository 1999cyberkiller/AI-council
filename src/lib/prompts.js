/* ──────────────────────────────────────────────────────────────────
   PROMPTS · 系统提示与用户提示构建（v10 瘦身版）
   设计原则：
   - 系统提示：稳定不变的写作风格 + 输出格式约束（可被 provider 缓存）
   - 用户提示：仅本次调用相关的动态数据
   - JSON schema 用紧凑符号而非散文
   ────────────────────────────────────────────────────────────────── */

export const ANALYSTS = [
  {
    id: 'value',
    cnName: '价值派',
    enName: 'The Value Investor',
    byline: '基本面专栏 · 格雷厄姆—巴菲特一脉',
    monogram: 'V',
    section: 'I',
    persona:
      '资深价值投资分析师，奉行格雷厄姆与巴菲特学派。重视护城河、自由现金流、ROIC、内在价值与安全边际。对热点和概念保持警觉，不为讲故事买单。',
    focus: '估值（PE/PB/EV-EBITDA）、ROE/ROIC、自由现金流、护城河、管理层资本配置、安全边际',
    stages: [
      '调阅最近三年年报与季报',
      '计算自由现金流与内在价值',
      '比对行业可比公司估值',
      '审视管理层资本配置历史',
      '撰写专栏',
    ],
  },
  {
    id: 'tech',
    cnName: '技术派',
    enName: 'The Technician',
    byline: '图表与动量专栏 · 量价不会撒谎',
    monogram: 'T',
    section: 'II',
    persona:
      '资深技术分析师，相信价格已反映一切。专注图表形态、量价关系、技术指标和资金流向。语言冷静、克制，不预测、只读图。',
    focus: '趋势线、20/60/200 日均线、MACD/RSI、成交量、突破回踩、支撑阻力位、相对强弱',
    stages: [
      '调取日线与周线 K 图',
      '标注关键均线与趋势通道',
      '计算 MACD、RSI、量能指标',
      '识别支撑阻力与形态',
      '撰写专栏',
    ],
  },
  {
    id: 'macro',
    cnName: '宏观派',
    enName: 'The Macro Hawk',
    byline: '宏观策略专栏 · 不见树木，先见森林',
    monogram: 'M',
    section: 'III',
    persona:
      '资深宏观策略师，习惯把个股放进宏观框架——利率周期、流动性、汇率、地缘政治、行业景气与资金风格切换。强调"对的时候做对的事"。',
    focus: '美联储/央行政策、十年期国债收益率、汇率、地缘政治、行业景气周期、风格切换',
    stages: [
      '读取近期央行声明与会议纪要',
      '观察利率曲线与流动性',
      '评估行业所处景气周期',
      '比对资金风格与板块轮动',
      '撰写专栏',
    ],
  },
  {
    id: 'risk',
    cnName: '风险派',
    enName: "The Devil's Advocate",
    byline: '看空研究专栏 · 总要有人提那个问题',
    monogram: 'R',
    section: 'IV',
    persona:
      '专业的看空研究分析师，工作就是挖掘风险、漏洞、利空与潜在黑天鹅。不为唱空而唱空，但绝不放过任何被市场忽视的隐患。语气冷峻而克制。',
    focus: '财务结构、监管/合规风险、竞争威胁、估值过高、管理层信号、行业逆风、应收存货异常',
    stages: [
      '排查财务报表异常项',
      '检索监管处罚与诉讼',
      '评估竞争格局逆风',
      '推演下行情景与压力测试',
      '撰写专栏',
    ],
  },
];

/* ── 共享输出格式约束（稳定不变，放进 system prompt） ─────────── */
const ANALYST_OUTPUT_RULES = `
输出严格 JSON（{...}），无前言、无 markdown、无解释。模式：
{
  "verdict": "BUY"|"HOLD"|"SELL",
  "conviction": 1-5 整数,
  "headline": "≤26 字核心观点，有流派语气",
  "analysis": "正文 280-380 字，2-3 段，专栏笔法，可引用数据",
  "key_points": ["≤24 字", "≤24 字", "≤24 字"],
  "risk": "≤32 字风险或反方观点",
  "data_gaps": ["≤30 字缺失公开数据"]
}
data_gaps：1-3 条，列出做出更可靠结论还缺什么具体数据；若已足够写 ["无明显数据缺口"]。`;

export function buildSystemPrompt(analyst, personaSignal = null) {
  const signalBlock = personaSignal
    ? `\n\n【你的过往表现】\n${personaSignal}\n本次请基于以上历史记录，更审慎地下判断——但保持你流派的风格和独立判断。`
    : '';

  return `你是《AI 议会》（The AI Council Gazette）的常驻专栏作者 · ${analyst.cnName}（${analyst.enName}）。
${analyst.persona}
分析视角：${analyst.focus}${signalBlock}

写作要求：
1. 中文专栏笔法，参考财新/WSJ 中文版风格
2. 观点鲜明但承认不确定性
3. 严格基于公开信息；不确定时标注"据公开资料估算"
4. 你的 verdict 是专栏观点，不构成投资建议
${ANALYST_OUTPUT_RULES}`;
}

export function buildUserPrompt(stockData, klineData, analystId, extras = {}) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}） · ${stockData.market === 'A' ? 'A股' : '美股'}`);

  const facts = [];
  if (stockData.price != null) {
    const ccy = stockData.market === 'A' ? '元' : 'USD';
    facts.push(`现价 ${stockData.price.toFixed(2)}${ccy}`);
  }
  if (stockData.changePct != null) {
    facts.push(`今日 ${stockData.changePct >= 0 ? '+' : ''}${stockData.changePct.toFixed(2)}%`);
  }
  if (stockData.pe != null) facts.push(`PE ${stockData.pe.toFixed(1)}`);
  if (stockData.pb != null) facts.push(`PB ${stockData.pb.toFixed(2)}`);
  if (stockData.marketCap) {
    facts.push(stockData.market === 'A'
      ? `市值 ${(stockData.marketCap / 1e8).toFixed(0)}亿`
      : `市值 ${(stockData.marketCap / 1e9).toFixed(1)}B`);
  }
  if (stockData.high52 && stockData.low52) {
    facts.push(`52周 ${stockData.low52.toFixed(1)}-${stockData.high52.toFixed(1)}`);
  }
  if (stockData.sector) facts.push(`板块 ${stockData.sector}${stockData.industry ? '/' + stockData.industry : ''}`);
  if (facts.length) lines.push(facts.join('；'));

  if (stockData.description) {
    lines.push(`简介：${stockData.description.slice(0, 200)}`);
  }

  // 技术派额外注入 K 线技术指标
  if (analystId === 'tech' && klineData && klineData.length > 0) {
    const last = klineData[klineData.length - 1];
    const first = klineData[0];
    const periodChange = ((last.close - first.close) / first.close) * 100;
    const periodHigh = Math.max(...klineData.map((k) => k.high));
    const periodLow = Math.min(...klineData.map((k) => k.low));
    const ma20Now = last.ma20;
    const ma60Now = last.ma60;
    const aboveMA20 = ma20Now ? ((last.close / ma20Now - 1) * 100).toFixed(1) : 'NA';
    const aboveMA60 = ma60Now ? ((last.close / ma60Now - 1) * 100).toFixed(1) : 'NA';

    const recent5 = klineData.slice(-5).reduce((s, k) => s + k.close, 0) / 5;
    const prev5 = klineData.slice(-10, -5).reduce((s, k) => s + k.close, 0) / 5;
    const shortTrend = recent5 > prev5 ? '5日均价↑' : '5日均价↓';

    let maOrder = '均线交织';
    if (ma20Now && ma60Now) {
      if (last.close > ma20Now && ma20Now > ma60Now) maOrder = '多头排列';
      else if (last.close < ma20Now && ma20Now < ma60Now) maOrder = '空头排列';
    }

    lines.push(
      `K线(${klineData.length}日)：区间${periodChange.toFixed(1)}%；` +
        `高${periodHigh.toFixed(1)}低${periodLow.toFixed(1)}；` +
        `MA20=${ma20Now?.toFixed(1) || 'NA'}(偏${aboveMA20}%)；` +
        `MA60=${ma60Now?.toFixed(1) || 'NA'}(偏${aboveMA60}%)；` +
        `${shortTrend}；${maOrder}`
    );
  }

  // V20 注入财务 + 卖方共识（技术派除外，不污染 K 线分析）
  if (analystId !== 'tech') {
    if (extras.financialsText) {
      lines.push('');
      lines.push(extras.financialsText);
    }
    if (extras.consensusText) {
      lines.push('');
      lines.push(extras.consensusText);
    }
  }

  return lines.join('\n');
}

/* ── 主编共享输出格式约束 ────────────────────────────────────── */
const EDITOR_OUTPUT_RULES = `
输出严格 JSON，无前言、无 markdown、无解释。模式：
{
  "verdict": "BUY"|"HOLD"|"SELL",
  "conviction": 1-5,
  "headline": "≤30 字主编最终判断",
  "key_sentence": "≤45 字 整篇札记的核心句——主编最想让读者带走的一句话，必须是 review 中已有的或自然提炼的，斩钉截铁",
  "review": "约 320-380 字三段式：共识/分歧/主编倾向",
  "consensus_areas": [
    { "point": "≤30 字共识", "supporters": ["分析师中文名", ...] }
  ],
  "dissent_areas": [
    {
      "topic": "≤24 字分歧主题",
      "positions": { "分析师中文名": "≤18 字立场" },
      "root_cause": "data_interpretation|reasoning_path|risk_appetite|framework_choice"
    }
  ],
  "unique_contributions": [{ "analyst": "中文名", "point": "≤30 字独有观察" }],
  "aggregated_data_gaps": ["≤32 字共同数据缺口"],
  "watchpoint": "≤40 字关注点",
  "grades": { "<分析师中文名>": { "grade": "A|B|C|D", "comment": "≤24 字评语" } }
}

约束:
- key_sentence 是整篇精华，单独提炼出来要能立住，比 headline 详细一些
- consensus_areas ≤4 条，supporters ≥3 位才算共识
- dissent_areas ≤3 条，positions 的 value 是具体立场不是"看多/看空"，root_cause 四选一
- unique_contributions ≤3 条，仅一位提出且有价值
- aggregated_data_gaps ≤3 条，至少 2 位提到的优先；都说无则 ["四方一致认为公开数据已足够"]
- grades 评分严格不老好人；只为成功交稿的分析师评分
- 所有引用分析师姓名仅限本期实际交稿的中文名，严禁编造`;

export function buildEditorSystemPrompt() {
  return `你是《AI 议会》（The AI Council Gazette）的主编（Editor-in-Chief），资深财经评论人。

风格：
1. 不重复罗列各篇观点，从更高视角抽象共识与分歧
2. 敢于在分歧时表态，措辞克制
3. 财新/WSJ 中文版社论笔法，避免"综合各位老师"水文
4. 中文，不构成投资建议

应对缺稿：若某位分析师未交稿，简单提及一笔（"X 派今日未能交稿，所议三家声音"），不要花篇幅猜测原因。grades 不评未交稿者。基于已有稿件正常综合。

近期资讯运用：若 user prompt 提供了【近期资讯·过去 N 天】信息，请评估这些事件是否改变议会判断。引用必须精确——不要发明新闻、不要曲解标题；如果新闻与分析师论点冲突或印证，在 review 中明确指出（"近期 X 事件印证了价值派对 Y 的判断"或"风险派未注意到 X 报道的 Y 变化"）。如果新闻与议题无关，不必强行提及。
${EDITOR_OUTPUT_RULES}`;
}

export function buildEditorUserPrompt(stockData, analystOutputs, extras = {}) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}）`);

  const facts = [];
  if (stockData.price != null) {
    const ccy = stockData.market === 'A' ? '元' : 'USD';
    facts.push(`现价 ${stockData.price.toFixed(2)}${ccy}`);
  }
  if (stockData.changePct != null) {
    facts.push(`${stockData.changePct >= 0 ? '+' : ''}${stockData.changePct.toFixed(2)}%`);
  }
  if (stockData.pe != null) facts.push(`PE ${stockData.pe.toFixed(1)}`);
  if (stockData.pb != null) facts.push(`PB ${stockData.pb.toFixed(2)}`);
  if (facts.length) lines.push(facts.join('；'));

  // V20 注入财务 + 卖方共识（主编全部注入）
  if (extras.financialsText) {
    lines.push('');
    lines.push(extras.financialsText);
  }
  if (extras.consensusText) {
    lines.push('');
    lines.push(extras.consensusText);
  }
  // V21 注入近期新闻（仅主编）
  if (extras.newsText) {
    lines.push('');
    lines.push(extras.newsText);
  }

  lines.push('\n本期专栏：');
  const submitted = analystOutputs.filter((o) => o.data);
  const missing = analystOutputs.filter((o) => !o.data);

  submitted.forEach((o) => {
    lines.push(
      `▸ ${o.name}（${o.data.verdict}/${o.data.conviction}）${o.data.headline}\n` +
      `  论点：${(o.data.key_points || []).join('｜')}\n` +
      `  风险：${o.data.risk}\n` +
      `  缺口：${(o.data.data_gaps || []).join('｜') || '未列'}\n` +
      `  摘要：${(o.data.analysis || '').slice(0, 180)}…`
    );
  });

  if (missing.length > 0) {
    lines.push(`\n未交稿：${missing.map((o) => o.name).join('、')}（不要花篇幅猜测原因，简单提一笔即可）`);
  }

  const submittedNames = submitted.map((o) => o.name);
  lines.push(`\n本期交稿分析师：${submittedNames.join('、') || '无'}（引用姓名仅限这些；grades 仅评他们）`);

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────
   SECOND ROUND · 议会二次审稿（追问分歧）
   - 用户点"追问"按钮后触发
   - 两位对立分析师就一个具体分歧主题各写 100-150 字反驳
   - 主编再综合一段（可能修正最终判断）
   ────────────────────────────────────────────────────────────────── */

const REBUTTAL_OUTPUT_RULES = `
输出严格 JSON（{...}），无前言、无 markdown。模式：
{
  "rebuttal": "100-150 字回应，分两步：先承认对方有道理的一点，再阐述你为什么仍坚持自己立场，可引用新论据。语气克制而坚定。",
  "refined_verdict": "BUY"|"HOLD"|"SELL",
  "refined_conviction": 1-5
}
refined_verdict 可以与初轮相同（坚持立场），也可以让步（被对方说服）；refined_conviction 反映你听完对方后的信心。`;

export function buildRebuttalSystemPrompt(analyst) {
  return `你是《AI 议会》（The AI Council Gazette）的 ${analyst.cnName}（${analyst.enName}）。
${analyst.persona}

【议会进入二次审稿环节】
你和另一位分析师在某点上有明显分歧。主编要求你回应对方的论点。
你的任务不是简单复述初轮观点，而是：
- 真诚审视对方论据中合理的部分
- 阐述你为何仍坚持原立场（或可承认让步）
- 在必要时引入初轮没涉及的新角度
${REBUTTAL_OUTPUT_RULES}`;
}

/**
 * @param {object} stockData
 * @param {string} topic     主编点出的分歧主题
 * @param {string} ownStance 我方初轮在这点上的立场（短句）
 * @param {object} opponent  { name, stance, headline, key_points, risk } 对方初轮要点
 */
export function buildRebuttalUserPrompt(stockData, topic, ownStance, opponent) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}）`);

  const facts = [];
  if (stockData.price != null) {
    const ccy = stockData.market === 'A' ? '元' : 'USD';
    facts.push(`现价 ${stockData.price.toFixed(2)}${ccy}`);
  }
  if (stockData.pe != null) facts.push(`PE ${stockData.pe.toFixed(1)}`);
  if (stockData.pb != null) facts.push(`PB ${stockData.pb.toFixed(2)}`);
  if (facts.length) lines.push(facts.join('；'));

  lines.push('');
  lines.push(`【分歧主题】${topic}`);
  lines.push(`【你的初轮立场】${ownStance || '（初轮未明确表态）'}`);
  lines.push('');
  lines.push(`【对方 ${opponent.name} 的立场】${opponent.stance || '（未明确）'}`);
  if (opponent.headline) lines.push(`其头条：${opponent.headline}`);
  if (opponent.key_points && opponent.key_points.length) {
    lines.push(`其论点：${opponent.key_points.join('｜')}`);
  }
  if (opponent.risk) lines.push(`其点出的风险：${opponent.risk}`);

  return lines.join('\n');
}

const SECOND_ROUND_EDITOR_RULES = `
输出严格 JSON，无前言、无 markdown：
{
  "headline": "≤30 字 二次审稿后的最新判断",
  "synthesis": "约 180-240 字 总结：哪方更有道理 / 双方在哪一点真正分歧不可调和 / 你的最终倾向",
  "verdict": "BUY"|"HOLD"|"SELL",
  "conviction": 1-5,
  "shifted": true|false,
  "shift_reason": "≤30 字 如果 shifted=true，简述什么因素让你改变初轮立场；否则为空字符串"
}
shifted=true 当你的 verdict 或 conviction 比初轮发生实质变化时。
保持评论员风格：不和稀泥，敢表态。`;

export function buildSecondRoundEditorSystemPrompt() {
  return `你是《AI 议会》（The AI Council Gazette）的主编。议会进入二次审稿环节。
你已读完初轮所有专栏并写了第一份札记。现在两位分析师就一个具体分歧互相回应了对方。
请基于这次"对话"，写一份精炼的二次审稿，并明确你的最终倾向是否因此发生改变。
${SECOND_ROUND_EDITOR_RULES}`;
}

export function buildSecondRoundEditorUserPrompt(
  stockData, firstRoundEditor, topic, rebuttals
) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}）`);
  lines.push('');
  lines.push(`【初轮你的札记结论】${firstRoundEditor.verdict}/${firstRoundEditor.conviction}：${firstRoundEditor.headline}`);
  lines.push('');
  lines.push(`【追问的分歧主题】${topic}`);
  lines.push('');
  lines.push('【两位分析师的二次回应】');
  rebuttals.forEach((r) => {
    if (!r || !r.data) return;
    lines.push(`▸ ${r.analystName}（${r.data.refined_verdict}/${r.data.refined_conviction}）`);
    lines.push(`  ${r.data.rebuttal}`);
  });

  return lines.join('\n');
}

/* ──────────────────────────────────────────────────────────────────
   FREE ASK · 用户自由追问
   - 用户输入任意问题
   - 选 1-2 位分析师回应
   - 主编综合（如果选了 ≥2 位）
   ────────────────────────────────────────────────────────────────── */

const FREE_ASK_OUTPUT_RULES = `
输出严格 JSON（{...}），无前言、无 markdown。模式：
{
  "answer": "150-250 字 直接回答用户问题。保持你流派的视角，不和稀泥，承认不确定时明确说明。",
  "stance_shift": "BUY"|"HOLD"|"SELL"|"unchanged",
  "confidence": 1-5
}
stance_shift: 如果你的回答让你想修正初轮 verdict，写新的；否则写 "unchanged"。
confidence: 你对自己这个回答的把握程度。`;

export function buildFreeAskSystemPrompt(analyst) {
  return `你是《AI 议会》（The AI Council Gazette）的 ${analyst.cnName}（${analyst.enName}）。
${analyst.persona}

【议会进入自由追问环节】
读者就你刚才的专栏或本期议题提了一个具体问题，请基于你的流派视角直接回答。
- 直击问题，不绕弯子
- 如果问题超出你的视角能力，坦言"这个问题更适合 X 派"，但仍尝试从你的角度给出有限观察
- 不重复你初轮专栏的内容，假设读者已读过
${FREE_ASK_OUTPUT_RULES}`;
}

export function buildFreeAskUserPrompt(stockData, userQuestion, ownFirstRound) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}）`);

  const facts = [];
  if (stockData.price != null) {
    const ccy = stockData.market === 'A' ? '元' : 'USD';
    facts.push(`现价 ${stockData.price.toFixed(2)}${ccy}`);
  }
  if (stockData.pe != null) facts.push(`PE ${stockData.pe.toFixed(1)}`);
  if (facts.length) lines.push(facts.join('；'));

  lines.push('');
  if (ownFirstRound) {
    lines.push(`【你的初轮立场】${ownFirstRound.verdict}/${ownFirstRound.conviction}：${ownFirstRound.headline}`);
  }
  lines.push('');
  lines.push(`【读者问题】${userQuestion}`);

  return lines.join('\n');
}

const FREE_ASK_EDITOR_RULES = `
输出严格 JSON：
{
  "synthesis": "100-180 字 综合两位分析师对此问题的回答，指出他们的共同点和差异，给一个主编自己的简短判断",
  "consensus": "一句话总结他们一致的地方（如有），≤30 字"
}`;

export function buildFreeAskEditorSystemPrompt() {
  return `你是《AI 议会》（The AI Council Gazette）的主编。读者提了一个问题，两位分析师给了答案。
请简短地综合一下，告诉读者两人的共识和分歧，并给出你自己的简短判断。
${FREE_ASK_EDITOR_RULES}`;
}

export function buildFreeAskEditorUserPrompt(stockData, userQuestion, answers) {
  const lines = [];
  lines.push(`${stockData.name}（${stockData.code}）`);
  lines.push('');
  lines.push(`【读者问题】${userQuestion}`);
  lines.push('');
  lines.push('【两位分析师的回答】');
  answers.forEach((a) => {
    if (!a || !a.data) return;
    lines.push(`▸ ${a.analystName}（信心 ${a.data.confidence}/5${a.data.stance_shift !== 'unchanged' ? ', 立场调整为 ' + a.data.stance_shift : ''}）`);
    lines.push(`  ${a.data.answer}`);
  });

  return lines.join('\n');
}
