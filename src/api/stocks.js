/* ──────────────────────────────────────────────────────────────────
   STOCK DATA · 行情 + K 线（东方财富 + Alpha Vantage）
   ────────────────────────────────────────────────────────────────── */

import { fetchEastmoney } from './jsonp';

// ── 输入识别与代码归一化 ──
export function classifyTicker(input) {
  const s = input.trim().toUpperCase();
  if (/^\d{6}$/.test(s)) return 'a-numeric';
  if (/^(SH|SZ)\d{6}$/.test(s) || /^\d{6}\.(SH|SZ)$/.test(s)) return 'a-prefixed';
  if (/^[A-Z]{1,6}(\.US)?$/.test(s)) return 'us';
  if (/[\u4e00-\u9fa5]/.test(input)) return 'cn-name';
  return 'unknown';
}

export function aShareSecid(code) {
  const c = code.replace(/[^\d]/g, '');
  if (/^[69]/.test(c)) return `1.${c}`;
  if (/^[03]/.test(c)) return `0.${c}`;
  return `1.${c}`;
}

function extractCnSixDigitCode(input) {
  const match = input.match(/(?:^|[^\d])(\d{6})(?:[^\d]|$)/);
  return match ? match[1] : '';
}

/**
 * 给定原始输入，若我们能在不发请求的情况下推断 { market, code }，则返回；否则 null
 * 用于"投机式提前启动"：当输入是 6 位数字或 US 代码时，无需等 resolveStock 完成就可以预先发起 K 线/基准请求
 */
export function speculateMarketCode(input) {
  const trimmed = input.trim().toUpperCase();
  const kind = classifyTicker(trimmed);
  if (kind === 'a-numeric') {
    return { market: 'A', code: trimmed };
  }
  if (kind === 'a-prefixed') {
    return { market: 'A', code: trimmed.replace(/[^\d]/g, '') };
  }
  if (kind === 'us') {
    return { market: 'US', code: trimmed.replace(/\.US$/, '') };
  }
  return null; // 中文名或未知 → 必须等 resolveStock 把代码搜出来
}

// ── 名称搜索（多端点回退） ──
async function searchEastmoney(query) {
  const attempts = [
    async () => {
      const url = `https://search-codetable.eastmoney.com/codetable/search/web/quote?count=10&keyword=${encodeURIComponent(query)}&secids=`;
      const r = await fetchEastmoney(url);
      const d = await r.json();
      const list = d?.result?.quoteList || [];
      return list.map((x) => ({
        code: x.code || x.Code || '',
        name: x.name || x.Name || '',
        market: String(x.market ?? x.MktNum ?? ''),
        secid: x.QuoteID || '',
        type: x.SecurityTypeName || x.Classify || '',
      }));
    },
    async () => {
      const url = `https://searchadapter.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=10`;
      const r = await fetchEastmoney(url);
      const d = await r.json();
      const list = d?.QuotationCodeTable?.Data || [];
      return list.map((x) => ({
        code: x.Code || '',
        name: x.Name || '',
        market: String(x.MktNum ?? ''),
        secid: x.QuoteID || '',
        type: x.SecurityTypeName || x.Classify || '',
      }));
    },
    async () => {
      const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(query)}&type=14&count=10`;
      const r = await fetchEastmoney(url);
      const d = await r.json();
      const list = d?.QuotationCodeTable?.Data || d?.result?.quoteList || [];
      return list.map((x) => ({
        code: x.Code || x.code || '',
        name: x.Name || x.name || '',
        market: String(x.MktNum ?? x.market ?? ''),
        secid: x.QuoteID || '',
        type: x.SecurityTypeName || x.Classify || '',
      }));
    },
  ];

  for (const attempt of attempts) {
    try {
      const list = await attempt();
      if (!list || list.length === 0) continue;
      const isAShareCode = (code) => /^\d{6}$/.test(code);
      const isAMarket = (m) => m === '0' || m === '1' || m === '105' || m === '106';

      const exact = list.find((x) => x.name === query && isAShareCode(x.code) && isAMarket(x.market));
      if (exact) return { code: exact.code, name: exact.name, secid: exact.secid, type: exact.type };

      const partial = list.find((x) => isAShareCode(x.code) && isAMarket(x.market) && x.name.includes(query));
      if (partial) return { code: partial.code, name: partial.name, secid: partial.secid, type: partial.type };

      const anyAShare = list.find((x) => isAShareCode(x.code));
      if (anyAShare) return { code: anyAShare.code, name: anyAShare.name, secid: anyAShare.secid, type: anyAShare.type };
    } catch { continue; }
  }
  return null;
}

function inferCnInstrumentType(code, meta = {}) {
  if ((meta.type || '').includes('指数') || /^399/.test(code)) return 'A 股指数';
  return 'A 股';
}

// ── A 股行情 ──
async function fetchAStockData(secid, meta = {}) {
  const fields = 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f161,f162,f167,f168,f169,f170,f171,f172,f173,f174,f175';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=${fields}`;
  const r = await fetchEastmoney(url);
  const d = await r.json();
  if (!d.data) throw new Error('未找到该 A 股代码');

  const div100 = (v) => (typeof v === 'number' ? v / 100 : null);

  return {
    market: 'A',
    secid: meta.secid || secid,
    code: d.data.f57,
    name: d.data.f58,
    instrumentType: inferCnInstrumentType(d.data.f57, meta),
    price: div100(d.data.f43),
    open: div100(d.data.f46),
    high: div100(d.data.f44),
    low: div100(d.data.f45),
    prevClose: div100(d.data.f60),
    change: div100(d.data.f169),
    changePct: typeof d.data.f170 === 'number' ? d.data.f170 / 100 : null,
    volume: d.data.f47,
    turnover: typeof d.data.f50 === 'number' ? d.data.f50 / 100 : null,
    pe: typeof d.data.f162 === 'number' ? d.data.f162 / 100 : null,
    pb: typeof d.data.f167 === 'number' ? d.data.f167 / 100 : null,
    marketCap: d.data.f116,
    floatCap: d.data.f117,
    high52: div100(d.data.f174),
    low52: div100(d.data.f175),
  };
}

// ── 美股行情（Alpha Vantage） ──
async function fetchUSStockData(symbol, alphaKey) {
  if (!alphaKey || !alphaKey.trim()) {
    throw new Error('未配置 Alpha Vantage Key（美股需要）');
  }
  const sym = symbol.replace(/\.US$/i, '');
  const [quoteR, overviewR] = await Promise.all([
    fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${alphaKey}`),
    fetch(`https://www.alphavantage.co/query?function=OVERVIEW&symbol=${sym}&apikey=${alphaKey}`),
  ]);
  const quoteD = await quoteR.json();
  const overviewD = await overviewR.json();
  const q = quoteD['Global Quote'];
  if (!q || !q['05. price']) {
    if (quoteD.Note) throw new Error('Alpha Vantage 频率限制（免费层 25/日）');
    throw new Error(`未找到美股代码 ${sym}`);
  }
  const num = (s) => (s == null || s === 'None' || s === '-' ? null : parseFloat(s));
  return {
    market: 'US',
    code: sym,
    name: overviewD?.Name || sym,
    price: num(q['05. price']),
    open: num(q['02. open']),
    high: num(q['03. high']),
    low: num(q['04. low']),
    prevClose: num(q['08. previous close']),
    change: num(q['09. change']),
    changePct: parseFloat((q['10. change percent'] || '0').replace('%', '')),
    volume: num(q['06. volume']),
    pe: num(overviewD?.PERatio),
    pb: num(overviewD?.PriceToBookRatio),
    eps: num(overviewD?.EPS),
    dividend: num(overviewD?.DividendYield),
    marketCap: num(overviewD?.MarketCapitalization),
    high52: num(overviewD?.['52WeekHigh']),
    low52: num(overviewD?.['52WeekLow']),
    sector: overviewD?.Sector,
    industry: overviewD?.Industry,
    description: overviewD?.Description,
  };
}

// 内部未缓存版本（直接打外部 API）
async function resolveStockUncached(input, alphaKey) {
  const kind = classifyTicker(input);
  const trimmed = input.trim();
  const embeddedCnCode = extractCnSixDigitCode(trimmed);

  if (embeddedCnCode && /[\u4e00-\u9fa5]/.test(trimmed)) {
    const foundByCode = await searchEastmoney(embeddedCnCode);
    return fetchAStockData(foundByCode?.secid || aShareSecid(embeddedCnCode), foundByCode || {});
  }

  if (kind === 'a-numeric') {
    return fetchAStockData(aShareSecid(trimmed));
  }
  if (kind === 'a-prefixed') {
    const code = trimmed.replace(/[^\d]/g, '');
    const market = /SH/i.test(trimmed) ? 'sh' : 'sz';
    return fetchAStockData(market === 'sh' ? `1.${code}` : `0.${code}`);
  }
  if (kind === 'us') {
    return fetchUSStockData(trimmed, alphaKey);
  }
  if (kind === 'cn-name') {
    const found = await searchEastmoney(trimmed);
    if (!found) {
      throw new Error(
        `未找到「${trimmed}」对应的 A 股代码或指数代码。可尝试：①直接输入 6 位代码（如 002448、399967）；②确认名称是否准确；③检查浏览器 Network 选项卡看真实错误。`
      );
    }
    return fetchAStockData(found.secid || aShareSecid(found.code), found);
  }
  const found = await searchEastmoney(trimmed);
  if (found) return fetchAStockData(found.secid || aShareSecid(found.code), found);
  return fetchUSStockData(trimmed, alphaKey);
}

import { withCache, stockKey, klineKey, baselineKey } from '../lib/stockCache';

// 公开 API：带 sessionStorage 缓存（5 分钟 TTL）
// 返回值多了一个 _fromCache 标记，便于 UI 显示缓存状态
export async function resolveStock(input, alphaKey, opts = {}) {
  const { value, hit } = await withCache(
    stockKey(input),
    () => resolveStockUncached(input, alphaKey),
    { bypass: !!opts.bypassCache }
  );
  return value ? { ...value, _fromCache: hit } : value;
}

// ── K 线 ──
function calcMA(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

async function fetchAStockKline(secid, days = 100) {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`;
  const r = await fetchEastmoney(url);
  const d = await r.json();
  const klines = d?.data?.klines || [];
  if (!klines.length) throw new Error(d?.message || `未取到 K 线数据（${secid}）`);
  return klines.map((line) => {
    const [date, open, close, high, low, volume] = line.split(',');
    return {
      date,
      open: parseFloat(open),
      close: parseFloat(close),
      high: parseFloat(high),
      low: parseFloat(low),
      volume: parseFloat(volume),
    };
  }).filter((row) =>
    row.date &&
    Number.isFinite(row.open) &&
    Number.isFinite(row.close) &&
    Number.isFinite(row.high) &&
    Number.isFinite(row.low)
  );
}

async function fetchUSKline(symbol, alphaKey, days = 100) {
  if (!alphaKey || !alphaKey.trim()) throw new Error('需要 Alpha Vantage Key');
  const sym = symbol.replace(/\.US$/i, '');
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${sym}&outputsize=${days > 100 ? 'full' : 'compact'}&apikey=${alphaKey}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`K线 ${r.status}`);
  const d = await r.json();
  const series = d['Time Series (Daily)'];
  if (!series) {
    if (d.Note) throw new Error('Alpha Vantage 频率限制');
    throw new Error(`未取到 ${sym} 的历史数据`);
  }
  const rows = Object.entries(series)
    .map(([date, v]) => ({
      date,
      open: parseFloat(v['1. open']),
      high: parseFloat(v['2. high']),
      low: parseFloat(v['3. low']),
      close: parseFloat(v['4. close']),
      volume: parseFloat(v['5. volume']),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return rows.slice(-days);
}

function enrichKline(klines) {
  if (!klines || klines.length === 0) return klines;
  const closes = klines.map((k) => k.close);
  const ma20 = calcMA(closes, 20);
  const ma60 = calcMA(closes, 60);
  return klines.map((k, i) => ({ ...k, ma20: ma20[i], ma60: ma60[i] }));
}

// 内部未缓存版本
async function resolveKlineUncached(market, code, alphaKey, days) {
  const fetchDays = Math.min(Math.max(days + 60, 100), 500); // 多取一些以保 MA60 稳定
  let raw;
  if (market === 'A') {
    const secid = aShareSecid(code);
    raw = await fetchAStockKline(secid, fetchDays);
  } else {
    raw = await fetchUSKline(code, alphaKey, fetchDays);
  }
  return enrichKline(raw).slice(-days);
}

async function resolveKlineUncachedForStock(stockData, alphaKey, days) {
  const fetchDays = Math.min(Math.max(days + 60, 100), 500);
  let raw;
  if (stockData.market === 'A') {
    raw = await fetchAStockKline(stockData.secid || aShareSecid(stockData.code), fetchDays);
  } else {
    raw = await fetchUSKline(stockData.code, alphaKey, fetchDays);
  }
  return enrichKline(raw).slice(-days);
}

// 接受 days 参数（30/90/180/365）—— 缓存版
export async function resolveKline(stockData, alphaKey, days = 90, opts = {}) {
  const keyCode = stockData.market === 'A'
    ? (stockData.secid || stockData.code)
    : stockData.code;
  const { value } = await withCache(
    klineKey(stockData.market, keyCode, days),
    () => resolveKlineUncachedForStock(stockData, alphaKey, days),
    { bypass: !!opts.bypassCache }
  );
  return value;
}

// 投机式 K 线：只需 market + code 就能调用（用于 resolveStock 还没完成前提前发起）
export async function resolveKlineByCode(market, code, alphaKey, days = 90, opts = {}) {
  const { value } = await withCache(
    klineKey(market, code, days),
    () => resolveKlineUncached(market, code, alphaKey, days),
    { bypass: !!opts.bypassCache }
  );
  return value;
}

/* ──────────────────────────────────────────────────────────────────
   基 准 指 数  ·  用于"超额收益"判定
   A 股 → 沪深300（1.000300）  美股 → SPY
   ────────────────────────────────────────────────────────────────── */

export const BENCHMARK = {
  A:  { code: '000300', name: '沪深300', secid: '1.000300' },
  US: { code: 'SPY',    name: '标普500 (SPY)' },
};

// 内部未缓存版本
async function fetchBenchmarkSpotUncached(market, alphaKey) {
  if (market === 'A') {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${BENCHMARK.A.secid}&fields=f43,f57,f58,f60`;
    const r = await fetchEastmoney(url);
    const d = await r.json();
    if (!d.data) throw new Error('沪深300 行情获取失败');
    return {
      market: 'A',
      code: BENCHMARK.A.code,
      name: BENCHMARK.A.name,
      price: d.data.f43 / 100,
    };
  }
  if (!alphaKey || !alphaKey.trim()) {
    throw new Error('美股基准需要 Alpha Vantage Key');
  }
  const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=SPY&apikey=${alphaKey}`);
  const d = await r.json();
  const q = d['Global Quote'];
  if (!q || !q['05. price']) {
    if (d.Note) throw new Error('Alpha Vantage 频率限制');
    throw new Error('SPY 行情获取失败');
  }
  return {
    market: 'US',
    code: BENCHMARK.US.code,
    name: BENCHMARK.US.name,
    price: parseFloat(q['05. price']),
  };
}

// 拉基准指数当前价 —— 缓存版
export async function fetchBenchmarkSpot(market, alphaKey, opts = {}) {
  const { value } = await withCache(
    baselineKey(market),
    () => fetchBenchmarkSpotUncached(market, alphaKey),
    { bypass: !!opts.bypassCache }
  );
  return value;
}

// 拉某 ticker 在某个日期附近的收盘价（用于 t+30 回填）
// 返回 { date, close }；找不到就抛错
// strategy: 拉最近 N 天 K 线，找 ≤ targetDate 的最大日期
export async function fetchPriceAtDate(market, code, alphaKey, targetDateMs, lookback = 60) {
  let rows;
  if (market === 'A') {
    rows = await fetchAStockKline(String(code).includes('.') ? code : aShareSecid(code), lookback);
  } else {
    rows = await fetchUSKline(code, alphaKey, lookback);
  }
  if (!rows || rows.length === 0) {
    throw new Error(`${code} 历史 K 线为空`);
  }
  // 找 ≤ targetDate 的最近一个交易日
  const targetStr = new Date(targetDateMs).toISOString().slice(0, 10);
  const candidates = rows
    .filter((r) => r.date <= targetStr)
    .sort((a, b) => b.date.localeCompare(a.date));
  if (candidates.length === 0) {
    throw new Error(`${code} 在 ${targetStr} 前无可用交易日`);
  }
  return { date: candidates[0].date, close: candidates[0].close };
}

// 拉基准指数在某日期的收盘价
export async function fetchBenchmarkAtDate(market, alphaKey, targetDateMs, lookback = 60) {
  if (market === 'A') {
    const rows = await fetchAStockKline(BENCHMARK.A.secid, lookback);
    const targetStr = new Date(targetDateMs).toISOString().slice(0, 10);
    const candidates = rows.filter((r) => r.date <= targetStr).sort((a, b) => b.date.localeCompare(a.date));
    if (candidates.length === 0) throw new Error(`沪深300 在 ${targetStr} 前无可用交易日`);
    return { date: candidates[0].date, close: candidates[0].close };
  }
  return fetchPriceAtDate('US', BENCHMARK.US.code, alphaKey, targetDateMs, lookback);
}
