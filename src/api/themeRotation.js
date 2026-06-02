/* ──────────────────────────────────────────────────────────────────
   THEME ROTATION · 科技主题轮动快照
   JS port of the package's theme_rotation.py for the React app.
   It is evidence for all seats, not a separate analyst.
   ────────────────────────────────────────────────────────────────── */

const CONFIG = {
  benchmark: 'QQQ',
  trendLen: 20,
  slowLen: 50,
  volLen: 20,
  volConfirm: 1.3,
  crowdRel60: 18,
  crowdDist50: 8,
  range: '1y',
};

const ETF_THEMES = [
  ['半导体', 'SMH'],
  ['软件', 'IGV'],
  ['云计算', 'SKYY'],
  ['网络安全', 'CIBR'],
  ['机器人', 'BOTZ'],
  ['AI 综合', 'AIQ'],
];

const BASKET_THEMES = [
  ['光模块', ['ANET', 'CIEN', 'COHR', 'LITE', 'AAOI']],
  ['储存', ['MU', 'WDC', 'STX']],
  ['数据中心电力散热', ['VRT', 'ETN', 'PWR', 'CEG', 'GEV']],
  ['云巨头', ['MSFT', 'AMZN', 'GOOGL', 'META']],
  ['AI 硬件卖方', ['NVDA', 'AVGO', 'AMD', 'ANET']],
];

const STATE_LABEL = {
  3: '拥挤主升',
  2: '确认进入',
  1: '早期轮动',
  0: '中性观察',
  '-1': '资金撤出',
  '-2': '派发/撤出',
  9: '无数据',
};

const TREND_LABEL = {
  2: '强',
  1: '偏强',
  '-1': '偏弱',
  '-2': '弱',
  0: '中性',
};

const finite = (v) => Number.isFinite(v);
const round = (v, n = 0) => (finite(v) ? Number(v.toFixed(n)) : null);
const gt = (a, b) => finite(a) && finite(b) && a > b;
const pctChange = (arr, i, len) => (
  i >= len && finite(arr[i]) && finite(arr[i - len]) && arr[i - len] !== 0
    ? (arr[i] / arr[i - len] - 1) * 100
    : null
);

function allSymbols() {
  const set = new Set([CONFIG.benchmark]);
  ETF_THEMES.forEach(([, symbol]) => set.add(symbol));
  BASKET_THEMES.forEach(([, members]) => members.forEach((s) => set.add(s)));
  return Array.from(set).sort();
}

function rollingMean(arr, len) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    if (finite(arr[i])) { sum += arr[i]; count += 1; }
    if (i >= len && finite(arr[i - len])) { sum -= arr[i - len]; count -= 1; }
    if (i >= len - 1 && count === len) out[i] = sum / len;
  }
  return out;
}

function alignSeries(rows, dates, field) {
  const byDate = new Map((rows || []).map((r) => [r.date, r[field]]));
  const out = [];
  let last = null;
  dates.forEach((date) => {
    const v = byDate.get(date);
    if (finite(v)) last = v;
    out.push(last);
  });
  return out;
}

function etfBreadth(close) {
  const ma20 = rollingMean(close, CONFIG.trendLen);
  return close.map((v, i) => (finite(v) ? (gt(v, ma20[i]) ? 70 : 30) : null));
}

function basketIndex(closes) {
  const out = new Array(closes[0]?.length || 0).fill(100);
  for (let i = 1; i < out.length; i++) {
    const rets = closes
      .map((c) => (finite(c[i]) && finite(c[i - 1]) && c[i - 1] !== 0 ? c[i] / c[i - 1] - 1 : null))
      .filter(finite);
    const avgRet = rets.length ? rets.reduce((s, v) => s + v, 0) / rets.length : 0;
    out[i] = out[i - 1] * (1 + avgRet);
  }
  return out;
}

function basketBreadth(closes) {
  const mas = closes.map((c) => rollingMean(c, CONFIG.trendLen));
  const n = closes[0]?.length || 0;
  return Array.from({ length: n }, (_, i) => {
    let present = 0;
    let above = 0;
    closes.forEach((c, j) => {
      if (!finite(c[i])) return;
      present += 1;
      if (gt(c[i], mas[j][i])) above += 1;
    });
    return present ? (100 * above) / present : null;
  });
}

function dollarVol(close, volume) {
  return close.map((c, i) => (finite(c) && finite(volume[i]) ? c * volume[i] : null));
}

function sumDollarVol(pairs) {
  const n = pairs[0]?.close?.length || 0;
  return Array.from({ length: n }, (_, i) => {
    const values = pairs
      .map((p) => (finite(p.close[i]) && finite(p.volume[i]) ? p.close[i] * p.volume[i] : null))
      .filter(finite);
    return values.length ? values.reduce((s, v) => s + v, 0) : null;
  });
}

function computeMetrics(index, dollarVolume, breadth, benchmark) {
  const ratio = index.map((v, i) => (finite(v) && finite(benchmark[i]) && benchmark[i] !== 0 ? v / benchmark[i] : null));
  const ma20 = rollingMean(ratio, CONFIG.trendLen);
  const ma50 = rollingMean(ratio, CONFIG.slowLen);
  const volMa = rollingMean(dollarVolume, CONFIG.volLen);
  const last = ratio.length - 1;

  const score = [];
  const rel1 = [];
  const rel5 = [];
  const rel20 = [];
  const rel60 = [];
  const volRatio = [];
  const dist50 = [];
  const overextended = [];
  const distribution = [];
  const components = [];

  for (let i = 0; i < ratio.length; i++) {
    const r1 = pctChange(ratio, i, 1);
    const r5 = pctChange(ratio, i, 5);
    const r20 = pctChange(ratio, i, 20);
    const r60 = pctChange(ratio, i, 60);
    const vr = finite(dollarVolume[i]) && finite(volMa[i]) && volMa[i] !== 0 ? dollarVolume[i] / volMa[i] : null;
    const d50 = finite(ratio[i]) && finite(ma50[i]) && ma50[i] !== 0 ? (ratio[i] / ma50[i] - 1) * 100 : null;

    const trend =
      (gt(ratio[i], ma20[i]) ? 10 : 0) +
      (gt(ratio[i], ma50[i]) ? 10 : 0) +
      (i >= 5 && gt(ma20[i], ma20[i - 5]) ? 10 : 0);
    const acc =
      (finite(r5) && r5 > 0 ? 8 : 0) +
      (finite(r5) && finite(r20) && r5 > r20 / 4 ? 9 : 0) +
      (i >= 5 && finite(r5) && finite(rel5[i - 5]) && r5 > rel5[i - 5] ? 8 : 0);
    const vol =
      finite(r1) && r1 > 0 && finite(vr) && vr >= CONFIG.volConfirm
        ? 20
        : finite(r1) && r1 > 0 && finite(vr) && vr >= 1
          ? 10
          : 0;
    const br = finite(breadth[i]) && breadth[i] >= 70 ? 15 : finite(breadth[i]) && breadth[i] >= 50 ? 8 : 0;
    const crowd = finite(r60) && r60 > CONFIG.crowdRel60 || finite(d50) && d50 > CONFIG.crowdDist50 ? 0 : 10;
    const valid = finite(ratio[i]) && finite(benchmark[i]);

    rel1.push(r1);
    rel5.push(r5);
    rel20.push(r20);
    rel60.push(r60);
    volRatio.push(vr);
    dist50.push(d50);
    overextended.push(crowd === 0);
    distribution.push(valid && gt(ma20[i], ratio[i]) && finite(r5) && r5 < 0 && finite(vr) && vr > CONFIG.volConfirm && finite(r1) && r1 < 0);
    components.push({ trend, acc, vol, breadth: br, crowd });
    score.push(valid ? trend + acc + vol + br + crowd : null);
  }

  const valid = finite(ratio[last]) && finite(benchmark[last]);
  let trendCode = 0;
  if (!valid) trendCode = 0;
  else if (gt(ratio[last], ma20[last]) && gt(ratio[last], ma50[last])) trendCode = 2;
  else if (gt(ratio[last], ma20[last])) trendCode = 1;
  else if (finite(ratio[last]) && finite(ma20[last]) && finite(ma50[last]) && ratio[last] < ma20[last] && ratio[last] < ma50[last]) trendCode = -2;
  else if (finite(ratio[last]) && finite(ma20[last]) && ratio[last] < ma20[last]) trendCode = -1;

  let state = 0;
  if (!valid) state = 9;
  else if (distribution[last]) state = -2;
  else if (overextended[last] && (score[last] || 0) >= 60) state = 3;
  else if ((score[last] || 0) >= 75) state = 2;
  else if ((score[last] || 0) >= 60) state = 1;
  else if ((score[last] || 0) < 45 && (rel5[last] || 0) < 0 && (rel20[last] || 0) < 0) state = -1;

  const prevScore = score[last - 1];
  const currScore = score[last];
  const crossUp = (level) => finite(prevScore) && finite(currScore) && prevScore < level && currScore > level;
  const crossDown = (level) => finite(prevScore) && finite(currScore) && prevScore > level && currScore < level;

  return {
    score: round(score[last], 0),
    rel1: round(rel1[last], 2),
    rel5: round(rel5[last], 2),
    rel20: round(rel20[last], 2),
    rel60: round(rel60[last], 2),
    vol_ratio: round(volRatio[last], 2),
    breadth: round(breadth[last], 1),
    dist50: round(dist50[last], 2),
    components: components[last] || {},
    overextended: !!overextended[last],
    distribution: !!distribution[last],
    trend_code: trendCode,
    state,
    early_rotation_cross: crossUp(60),
    confirmed_in_cross: crossUp(75),
    weakening_cross: crossDown(45),
    valid,
  };
}

function packTheme({ name, proxy, kind, metrics, coverage, breadthIsProxy }) {
  return {
    name,
    proxy,
    kind,
    available: !!metrics.valid,
    score: metrics.score,
    state: metrics.state,
    state_label: STATE_LABEL[metrics.state] || '无数据',
    trend_code: metrics.trend_code,
    trend_label: TREND_LABEL[metrics.trend_code] || '中性',
    rel1: metrics.rel1,
    rel5: metrics.rel5,
    rel20: metrics.rel20,
    rel60: metrics.rel60,
    vol_ratio: metrics.vol_ratio,
    breadth: metrics.breadth,
    breadth_is_proxy: breadthIsProxy,
    dist50: metrics.dist50,
    overextended: metrics.overextended,
    distribution: metrics.distribution,
    components: metrics.components,
    early_rotation_cross: metrics.early_rotation_cross,
    confirmed_in_cross: metrics.confirmed_in_cross,
    weakening_cross: metrics.weakening_cross,
    coverage,
  };
}

function rankedThemes(themes) {
  return themes
    .filter((t) => t.available && t.score != null)
    .sort((a, b) => b.score - a.score);
}

function disagreementSignals(themes) {
  const out = [];
  rankedThemes(themes).forEach((t) => {
    if (t.state === 3) {
      out.push(`【动量 vs 均值回归】${t.name} 评分 ${t.score}/拥挤主升(rel60=${t.rel60}%, dist50=${t.dist50}%)，续涨派与获利回吐派对立。`);
    }
    if (t.distribution) {
      out.push(`【派发警示】${t.name} 价跌加放量(量比 ${t.vol_ratio}x, rel5=${t.rel5}%)，疑似机构派发。`);
    }
    if ((t.score || 0) >= 60 && (t.components?.vol || 0) === 0) {
      out.push(`【价 vs 量】${t.name} 评分 ${t.score} 但量分为 0，领涨真实性存疑。`);
    }
    if ((t.score || 0) >= 60 && t.breadth != null && t.breadth < 50 && !t.breadth_is_proxy) {
      out.push(`【窄幅领涨】${t.name} 评分 ${t.score} 但广度仅 ${Math.round(t.breadth)}%，领导力基础脆弱。`);
    }
    if (t.rel5 != null && t.rel20 != null && t.rel5 > 0 && t.rel20 < 0) {
      out.push(`【快慢背离】${t.name} 短期相对转强(rel5 ${t.rel5}%)但中期仍弱(rel20 ${t.rel20}%)。`);
    }
  });
  return out;
}

function markdownTable(themes) {
  const rows = themes.map((t) => {
    if (!t.available || t.score == null) {
      return `| ${t.name} | ${t.proxy} | n/a | 无数据 | - | - | - | - | - | - | ${t.coverage || ''} |`;
    }
    const vol = t.vol_ratio == null ? 'n/a' : `${t.vol_ratio.toFixed(2)}x`;
    const breadth = t.breadth == null ? 'n/a' : `${Math.round(t.breadth)}%${t.breadth_is_proxy ? '*' : ''}`;
    return `| ${t.name} | ${t.proxy} | ${t.score} | ${t.state_label} | ${t.trend_label} | ${t.rel5?.toFixed(1) ?? '-'}% | ${t.rel20?.toFixed(1) ?? '-'}% | ${vol} | ${breadth} | ${t.dist50?.toFixed(1) ?? '-'}% | ${t.coverage || ''} |`;
  });
  return [
    '| 主题 | 代理 | 评分 | 状态 | 趋势 | 5D相对 | 20D相对 | 量比 | 广度 | Dist50 | 覆盖 |',
    '|---|---|---:|---|---|---:|---:|---:|---:|---:|---|',
    ...rows,
  ].join('\n');
}

function renderSeatContext(snapshot) {
  const leaders = rankedThemes(snapshot.themes).slice(0, 3);
  const top = leaders.map((t) => `${t.name}(${t.score}/${t.state_label})`).join(', ') || 'n/a';
  const signals = snapshot.disagreement_signals.length
    ? snapshot.disagreement_signals.map((s) => `- ${s}`).join('\n')
    : '- 本快照未检测到明显内部张力信号';
  return `## 科技主题轮动快照 (as of ${snapshot.as_of}, 基准 ${snapshot.benchmark})

评分=相对 ${snapshot.benchmark} 的轮动综合分 [0-100] = 趋势(30)+加速(25)+量(20)+广度(15)+非拥挤(10)。
状态: 确认进入≥75 / 早期轮动≥60 / 拥挤主升=高分但过热 / 派发=价跌放量 / 资金撤出=低分多周期转弱。
广度列标 * 者为 ETF 的 70/30 代理，非真实成分广度。

当前领先: ${top}

${markdownTable(snapshot.themes)}

### 内部张力信号
${signals}`;
}

async function fetchYahooBundle(symbols) {
  const url = `/api/market/yahoo-chart?symbols=${encodeURIComponent(symbols.join(','))}&range=${encodeURIComponent(CONFIG.range)}&interval=1d`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`主题轮动数据 ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

export async function resolveThemeRotation(stockData) {
  if (stockData?.market !== 'US') {
    return {
      skipped: true,
      reason: '科技主题轮动当前用于美股和 ETF 议题',
    };
  }

  const symbols = allSymbols();
  const bundle = await fetchYahooBundle(symbols);
  const frames = bundle?.symbols || {};
  const qqq = frames[CONFIG.benchmark]?.rows || [];
  if (!qqq.length) throw new Error('QQQ 基准日线不可用，无法计算主题轮动');
  const dates = qqq.map((r) => r.date);
  const qqqClose = alignSeries(qqq, dates, 'close');
  const themes = [];

  ETF_THEMES.forEach(([name, symbol]) => {
    const rows = frames[symbol]?.rows || [];
    if (!rows.length) {
      themes.push({ name, proxy: symbol, kind: 'etf', available: false, score: null, state: 9, state_label: '无数据', coverage: `0/1 (${symbol})` });
      return;
    }
    const close = alignSeries(rows, dates, 'close');
    const volume = alignSeries(rows, dates, 'volume');
    themes.push(packTheme({
      name,
      proxy: symbol,
      kind: 'etf',
      metrics: computeMetrics(close, dollarVol(close, volume), etfBreadth(close), qqqClose),
      coverage: `1/1 (${symbol})`,
      breadthIsProxy: true,
    }));
  });

  BASKET_THEMES.forEach(([name, members]) => {
    const have = [];
    const closes = [];
    const pairs = [];
    members.forEach((symbol) => {
      const rows = frames[symbol]?.rows || [];
      if (!rows.length) return;
      const close = alignSeries(rows, dates, 'close');
      const volume = alignSeries(rows, dates, 'volume');
      have.push(symbol);
      closes.push(close);
      pairs.push({ close, volume });
    });
    if (!closes.length) {
      themes.push({ name, proxy: 'Basket', kind: 'basket', available: false, score: null, state: 9, state_label: '无数据', coverage: `0/${members.length}` });
      return;
    }
    themes.push(packTheme({
      name,
      proxy: 'Basket',
      kind: 'basket',
      metrics: computeMetrics(basketIndex(closes), sumDollarVol(pairs), basketBreadth(closes), qqqClose),
      coverage: `${have.length}/${members.length}`,
      breadthIsProxy: false,
    }));
  });

  const snapshot = {
    as_of: dates[dates.length - 1],
    benchmark: CONFIG.benchmark,
    config: CONFIG,
    themes,
  };
  snapshot.leaders = rankedThemes(themes).slice(0, 3).map((t) => t.name);
  snapshot.disagreement_signals = disagreementSignals(themes);
  snapshot.rendered = renderSeatContext(snapshot);
  return snapshot;
}

export function formatThemeRotationForPrompt(snapshot) {
  if (!snapshot || snapshot.skipped) return '';
  return snapshot.rendered || '';
}
