import { getFundamentals, getMarketData, getWebResearch } from "./data-tools.js";

export const tools = [
  {
    id: "scenario_matrix",
    name: "情景概率矩阵",
    description: "构建乐观、基准、悲观三类情景概率。"
  },
  {
    id: "risk_register",
    name: "风险登记表",
    description: "列出主要决策风险和潜在缓释方式。"
  },
  {
    id: "position_sizing",
    name: "仓位测算",
    description: "根据置信度和回撤容忍度，给出初步风险预算。"
  },
  {
    id: "valuation_sanity",
    name: "估值一致性检查",
    description: "在出现价格、EPS、增长率或利润率线索时，检查估值逻辑。"
  },
  {
    id: "market_data",
    name: "实时行情",
    description: "使用免费行情源拉取 ticker 的最新行情、涨跌幅和交易信息。"
  },
  {
    id: "fundamentals",
    name: "财报与基本面",
    description: "使用免费 SEC Company Facts 读取上市公司最新财报指标。"
  },
  {
    id: "web_research",
    name: "Web research",
    description: "使用免费 web 检索源查找研究材料、新闻和公开信息，并保留来源链接。"
  }
];

export async function runFinanceTools({ question, context, enabledTools = tools.map((tool) => tool.id) }) {
  const text = `${question}\n${context || ""}`.toLowerCase();
  const enabled = new Set(enabledTools);
  const outputs = [];

  if (enabled.has("scenario_matrix")) outputs.push(scenarioMatrix(text));
  if (enabled.has("risk_register")) outputs.push(riskRegister(text));

  if (enabled.has("position_sizing") && mentionsPosition(text)) {
    outputs.push(positionSizing(text));
  }

  if (enabled.has("valuation_sanity") && mentionsValuation(text)) {
    outputs.push(valuationSanity(text));
  }

  if (enabled.has("market_data")) outputs.push(await getMarketData({ question, context }));
  if (enabled.has("fundamentals")) outputs.push(await getFundamentals({ question, context }));
  if (enabled.has("web_research")) outputs.push(await getWebResearch({ question, context }));

  return outputs;
}

function scenarioMatrix(text) {
  const defensive = /recession|衰退|降息|避险|risk|风险|drawdown|回撤/.test(text);
  const growth = /ai|growth|增长|科技|semiconductor|芯片|earnings|利润/.test(text);

  let base = 0.5;
  if (growth) base += 0.06;
  if (defensive) base -= 0.05;

  return {
    id: "scenario_matrix",
    name: "情景概率矩阵",
    result: {
      bull: round(1 - base - 0.22),
      base: round(base),
      bear: 0.22,
      note: "当前为本地先验判断。接入实时宏观和市场数据后，可替换该模块。"
    }
  };
}

function riskRegister(text) {
  const risks = [
    "叙事风险：投资故事可能跑在基本面兑现之前。",
    "流动性风险：拥挤持仓可能放大阶段性回撤。",
    "证据风险：缺少一手数据时，漂亮的 thesis 也可能只是穿了西装的猜测。"
  ];

  if (/china|中国|政策/.test(text)) {
    risks.push("政策风险：监管方向可能压过常规估值逻辑。");
  }

  if (/rate|rates|fed|利率|美联储/.test(text)) {
    risks.push("利率风险：折现率变化会快速重估长久期资产。");
  }

  return {
    id: "risk_register",
    name: "风险登记表",
    result: { risks }
  };
}

function positionSizing(text) {
  const aggressive = /高风险|aggressive|杠杆|leverage/.test(text);
  return {
    id: "position_sizing",
    name: "仓位测算",
    result: {
      starter: aggressive ? "0.5% 至 1.5%" : "1% 至 3%",
      full_size: aggressive ? "2% 至 4%" : "4% 至 8%",
      stop_rule: "当悲观情景变成基准情景时，降低仓位或重新评估。"
    }
  };
}

function valuationSanity(text) {
  const numbers = [...text.matchAll(/\b\d+(?:\.\d+)?%?\b/g)].slice(0, 12).map((m) => m[0]);
  return {
    id: "valuation_sanity",
    name: "估值一致性检查",
    result: {
      extracted_numbers: numbers,
      check: numbers.length
        ? "已识别数值信息。模型应把每个数值对应到估值、增长或风险假设。"
        : "未识别明确估值输入。模型应避免虚假精确。"
    }
  };
}

function mentionsPosition(text) {
  return /position|仓位|买多少|配置|allocation|weight|权重/.test(text);
}

function mentionsValuation(text) {
  return /valuation|估值|pe|p\/e|eps|dcf|price|价格|市盈率|利润|revenue|收入/.test(text);
}

function round(value) {
  return Math.max(0.05, Math.min(0.9, Number(value.toFixed(2))));
}
