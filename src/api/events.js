/* ──────────────────────────────────────────────────────────────────
   EVENTS · 财报 / 分红 / 解禁等公司事件
   - A 股：东方财富 datacenter-web（基于 AKShare 公开 endpoint 模式）
   - 美股：Finnhub（免费 60 次/分钟，需用户提供 key）
   - 缓存：6 小时 TTL（事件信息变化慢）
   - 优雅降级：拿不到就返回 null，不打扰用户

   返回的统一 Event 形态：
   { type: 'earnings'|'dividend'|'lockup', date: 'YYYY-MM-DD', daysUntil: number, label?: string, meta?: object }
   ────────────────────────────────────────────────────────────────── */

import { fetchEastmoney, fetchWithTimeout } from './jsonp';

const EVENTS_CACHE_PREFIX = 'dispatch:events:v1:';
const EVENTS_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时

// ── 本地缓存（独立于 stockCache，TTL 更长） ──
function cacheGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(EVENTS_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > EVENTS_TTL_MS) {
      window.sessionStorage.removeItem(EVENTS_CACHE_PREFIX + key);
      return null;
    }
    return entry.v;
  } catch { return null; }
}
function cacheSet(key, value) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(EVENTS_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

// ── 工具：把 'YYYY-MM-DD' 或 ISO 转成相对天数 ──
function daysUntilDate(dateStr) {
  if (!dateStr) return null;
  try {
    const t = new Date(dateStr).getTime();
    if (isNaN(t)) return null;
    const days = Math.ceil((t - Date.now()) / 86400000);
    return days;
  } catch { return null; }
}

function normalizeDate(s) {
  if (!s || typeof s !== 'string') return null;
  // 接受 'YYYY-MM-DD'、'YYYY-MM-DD HH:mm:ss'、'YYYY/MM/DD' 等
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

/* ──────────────────────────────────────────────────────────────
   A 股：东方财富 datacenter-web endpoints
   注意：endpoint schema 是基于公开实践，未来 EM 改造可能失效
   ────────────────────────────────────────────────────────────── */

// 业绩预告（业绩快报）—— 用 RPT_PUBLIC_OP_NEWPREDICT
// 注意：实际生产中 RPT 名称可能略不同；如果失败会被外层捕获并跳过
async function fetchAShareEarningsHint(code) {
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?sortColumns=NOTICE_DATE&sortTypes=-1&pageSize=10&pageNumber=1` +
    `&reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=ALL` +
    `&filter=(SECURITY_CODE%3D%22${encodeURIComponent(code)}%22)`;
  try {
    const r = await fetchEastmoney(url);
    const d = await r.json();
    const rows = d?.result?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // 找未来日期的 NOTICE_DATE；没有则取最近一条（用 REPORT_DATE 推算下一季）
    const upcoming = rows.find((row) => {
      const dt = normalizeDate(row.NOTICE_DATE);
      const days = daysUntilDate(dt);
      return days != null && days >= 0;
    });
    if (upcoming) {
      const date = normalizeDate(upcoming.NOTICE_DATE);
      return {
        type: 'earnings',
        date,
        daysUntil: daysUntilDate(date),
        label: '业绩预告',
        meta: { reportDate: upcoming.REPORT_DATE, ePS: upcoming.PREDICT_FINANCE_CODE },
      };
    }
    return null;
  } catch (e) {
    console.debug('[events] A股 earnings 拉取失败:', e?.message);
    return null;
  }
}

// 分红派息 —— RPT_SHAREBONUS_DET
// 注意：endpoint 和列名尚未完全验证。东方财富改造频繁，与其给错数据，不如先停用。
// 等手头有真实抓包样本后再开启。
async function fetchAShareDividend(code) {
  // 暂时返回 null。下方实现保留作未来 reference。
  return null;

  /* eslint-disable no-unreachable */
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?sortColumns=NOTICE_DATE&sortTypes=-1&pageSize=10&pageNumber=1` +
    `&reportName=RPT_SHAREBONUS_DET&columns=ALL` +
    `&filter=(SECURITY_CODE%3D%22${encodeURIComponent(code)}%22)`;
  try {
    const r = await fetchEastmoney(url);
    const d = await r.json();
    const rows = d?.result?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const upcoming = rows.find((row) => {
      const dt = normalizeDate(row.EX_DIVIDEND_DATE || row.REGIST_DATE);
      const days = daysUntilDate(dt);
      return days != null && days >= 0;
    });
    if (upcoming) {
      const date = normalizeDate(upcoming.EX_DIVIDEND_DATE || upcoming.REGIST_DATE);
      return {
        type: 'dividend',
        date,
        daysUntil: daysUntilDate(date),
        label: '分红除权',
        meta: { plan: upcoming.IMPL_PLAN_PROFILE, dvdRatio: upcoming.PRETAX_BONUS_RMB },
      };
    }
    return null;
  } catch (e) {
    console.debug('[events] A股 dividend 拉取失败:', e?.message);
    return null;
  }
  /* eslint-enable no-unreachable */
}

/* ──────────────────────────────────────────────────────────────
   美股：Finnhub
   ────────────────────────────────────────────────────────────── */

async function fetchUSEarnings(symbol, finnhubKey) {
  if (!finnhubKey) return { _needsKey: true };
  // 查未来 90 天
  const today = new Date();
  const future = new Date(today.getTime() + 90 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${fmt(today)}&to=${fmt(future)}&symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`;
  try {
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new Error('Finnhub key 无效');
      if (r.status === 429) throw new Error('Finnhub 频率限制');
      throw new Error(`Finnhub HTTP ${r.status}`);
    }
    const d = await r.json();
    const rows = d?.earningsCalendar;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    // 取最近一条（数组本身按日期升序）
    const upcoming = rows.find((row) => {
      const days = daysUntilDate(row.date);
      return days != null && days >= 0;
    });
    if (upcoming) {
      return {
        type: 'earnings',
        date: upcoming.date,
        daysUntil: daysUntilDate(upcoming.date),
        label: 'Earnings',
        meta: {
          epsEstimate: upcoming.epsEstimate,
          quarter: upcoming.quarter,
          year: upcoming.year,
          hour: upcoming.hour, // 'bmo' (before market open) / 'amc' (after market close)
        },
      };
    }
    return null;
  } catch (e) {
    console.debug('[events] US earnings 拉取失败:', e?.message);
    return null;
  }
}

async function fetchUSDividend(symbol, finnhubKey) {
  if (!finnhubKey) return { _needsKey: true };
  const today = new Date();
  const future = new Date(today.getTime() + 90 * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/stock/dividend?symbol=${encodeURIComponent(symbol)}&from=${fmt(today)}&to=${fmt(future)}&token=${finnhubKey}`;
  try {
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) return null;
    const d = await r.json();
    if (!Array.isArray(d) || d.length === 0) return null;
    // 取最近一条 ex-date
    const upcoming = d.find((row) => {
      const days = daysUntilDate(row.date);
      return days != null && days >= 0;
    });
    if (upcoming) {
      return {
        type: 'dividend',
        date: upcoming.date,
        daysUntil: daysUntilDate(upcoming.date),
        label: 'Dividend',
        meta: {
          amount: upcoming.amount,
          adjustedAmount: upcoming.adjustedAmount,
          payDate: upcoming.payDate,
        },
      };
    }
    return null;
  } catch (e) {
    console.debug('[events] US dividend 拉取失败:', e?.message);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────
   公开 API：resolveEvents
   返回 { events: Event[], hasMissingKey: boolean, market: 'A'|'US' }
   events 按 daysUntil 升序排列；最近的最前面
   ────────────────────────────────────────────────────────────── */

export async function resolveEvents(stockData, finnhubKey, opts = {}) {
  if (!stockData || !stockData.code) {
    return { events: [], hasMissingKey: false, market: null };
  }
  const cacheKey = `${stockData.market}:${stockData.code}`;
  if (!opts.bypassCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  let events = [];
  let hasMissingKey = false;

  if (stockData.market === 'A') {
    // 并行拉两种事件
    const [earnings, dividend] = await Promise.all([
      fetchAShareEarningsHint(stockData.code),
      fetchAShareDividend(stockData.code),
    ]);
    if (earnings) events.push(earnings);
    if (dividend) events.push(dividend);
  } else if (stockData.market === 'US') {
    const [earnings, dividend] = await Promise.all([
      fetchUSEarnings(stockData.code, finnhubKey),
      fetchUSDividend(stockData.code, finnhubKey),
    ]);
    if (earnings?._needsKey || dividend?._needsKey) {
      hasMissingKey = true;
    } else {
      if (earnings) events.push(earnings);
      if (dividend) events.push(dividend);
    }
  }

  // 按 daysUntil 升序
  events.sort((a, b) => (a.daysUntil ?? Infinity) - (b.daysUntil ?? Infinity));

  const result = { events, hasMissingKey, market: stockData.market };
  cacheSet(cacheKey, result);
  return result;
}

/**
 * 简便函数：从一个 events 数组里挑最近的财报
 */
export function nextEarnings(events) {
  if (!Array.isArray(events)) return null;
  return events.find((e) => e?.type === 'earnings') || null;
}

/**
 * 简便函数：从 events 里挑最近的分红
 */
export function nextDividend(events) {
  if (!Array.isArray(events)) return null;
  return events.find((e) => e?.type === 'dividend') || null;
}
