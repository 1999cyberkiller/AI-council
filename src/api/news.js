/* ──────────────────────────────────────────────────────────────────
   NEWS · 最近 3 天个股新闻
   - A 股：东方财富 search-api（基于 AKShare stock_news_em endpoint pattern）
   - 美股：Finnhub /company-news
   - 缓存：30 分钟 TTL（新闻流动快）
   - 失败静默降级
   - 注入主编 prompt 增加时效性判断

   返回的统一形态：
   {
     items: [
       { datetime: 'YYYY-MM-DD HH:mm', source, headline, summary, url },
       ...
     ],
     hasMissingKey: bool,   // 美股缺 Finnhub key 时为 true
     market: 'A' | 'US',
   }
   ────────────────────────────────────────────────────────────────── */

import { fetchEastmoney, fetchWithTimeout } from './jsonp';

const NEWS_CACHE_PREFIX = 'dispatch:news:v1:';
const NEWS_TTL_MS = 30 * 60 * 1000;  // 30 分钟
const LOOKBACK_DAYS = 3;
const MAX_ITEMS = 3;

function cacheGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(NEWS_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > NEWS_TTL_MS) {
      window.sessionStorage.removeItem(NEWS_CACHE_PREFIX + key);
      return null;
    }
    return entry.v;
  } catch { return null; }
}
function cacheSet(key, value) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(NEWS_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

function fmtDateLocal(dt) {
  // dt: Date 或 timestamp 或 ISO 字符串
  const d = typeof dt === 'number' ? new Date(dt) : (dt instanceof Date ? dt : new Date(dt));
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function withinLookback(timestamp) {
  if (!timestamp) return false;
  const t = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  if (isNaN(t)) return false;
  return (Date.now() - t) <= LOOKBACK_DAYS * 86400 * 1000;
}

/* ──────────────────────────────────────────────────────────────
   A 股：东方财富搜索 API
   - 模拟 so.eastmoney.com 的后端调用
   - 端点和字段名基于 AKShare stock_news_em 实践
   ────────────────────────────────────────────────────────────── */
async function fetchAShareNews(code, name) {
  // 东方财富搜索 endpoint —— 这里基于 AKShare 实践使用 search-api 模式
  // 注意：endpoint 路径和字段名可能随东方财富改造变化，失败时静默返回 null
  const url =
    `https://search-api-web.eastmoney.com/search/jsonp?` +
    `param=${encodeURIComponent(JSON.stringify({
      uid: '',
      keyword: name || code,
      type: ['cmsArticleWebOld'],
      client: 'web',
      clientType: 'web',
      clientVersion: 'curr',
      param: {
        cmsArticleWebOld: {
          searchScope: 'default',
          sort: 'default',
          pageIndex: 1,
          pageSize: 20,
          preTag: '',
          postTag: '',
        }
      }
    }))}`;

  try {
    const r = await fetchEastmoney(url);
    const d = await r.json();

    // 兼容多种返回结构
    const bucket = d?.result?.cmsArticleWebOld
      || d?.result?.data
      || d?.data?.cmsArticleWebOld
      || d?.data
      || [];
    const rows = Array.isArray(bucket)
      ? bucket
      : (bucket.data || bucket.list || bucket.items || bucket.result || []);
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // 过滤近 3 天，按时间倒序，取前 MAX_ITEMS
    const filtered = rows
      .map((row) => {
        // 字段名兼容性
        const date = row.date || row.publishTime || row.showTime || row.time;
        const title = row.title || row.headline;
        const summary = row.content || row.summary || row.contentDesc || '';
        const source = row.mediaName || row.source || row.publisher || '';
        const articleUrl = row.url || row.articleUrl || '';
        if (!date || !title) return null;
        const ts = new Date(date).getTime();
        if (isNaN(ts)) return null;
        return {
          datetime: fmtDateLocal(ts),
          timestamp: ts,
          source: stripHtml(source),
          headline: stripHtml(title),
          summary: stripHtml(summary).slice(0, 120),
          url: articleUrl,
        };
      })
      .filter(Boolean)
      .filter((x) => withinLookback(x.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ITEMS);

    if (filtered.length === 0) return null;
    return { items: filtered };
  } catch (e) {
    console.debug('[news] A股 拉取失败:', e?.message);
    return null;
  }
}

function stripHtml(s) {
  if (!s || typeof s !== 'string') return '';
  return s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

/* ──────────────────────────────────────────────────────────────
   美股：Finnhub /company-news
   ────────────────────────────────────────────────────────────── */
async function fetchUSNews(symbol, finnhubKey) {
  if (!finnhubKey) return { _needsKey: true };
  const today = new Date();
  const start = new Date(today.getTime() - LOOKBACK_DAYS * 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(start)}&to=${fmt(today)}&token=${finnhubKey}`;

  try {
    const r = await fetchWithTimeout(url, 8000);
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new Error('Finnhub key 无效');
      if (r.status === 429) throw new Error('Finnhub 频率限制');
      throw new Error(`Finnhub HTTP ${r.status}`);
    }
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;

    // Finnhub 默认时间倒序，取前 MAX_ITEMS
    const filtered = arr
      .map((row) => {
        const tsSeconds = row.datetime;
        const tsMs = typeof tsSeconds === 'number' ? tsSeconds * 1000 : null;
        if (!tsMs || !row.headline) return null;
        return {
          datetime: fmtDateLocal(tsMs),
          timestamp: tsMs,
          source: row.source || '',
          headline: row.headline,
          summary: (row.summary || '').slice(0, 140),
          url: row.url || '',
        };
      })
      .filter(Boolean)
      .filter((x) => withinLookback(x.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_ITEMS);

    if (filtered.length === 0) return null;
    return { items: filtered };
  } catch (e) {
    console.debug('[news] US 拉取失败:', e?.message);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────
   公开 API
   ────────────────────────────────────────────────────────────── */
export async function resolveNews(stockData, finnhubKey, opts = {}) {
  if (!stockData || !stockData.code) {
    return { items: [], hasMissingKey: false, market: null };
  }
  const cacheKey = `${stockData.market}:${stockData.code}`;
  if (!opts.bypassCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  let items = [];
  let hasMissingKey = false;

  if (stockData.market === 'A') {
    const r = await fetchAShareNews(stockData.code, stockData.name);
    if (r) items = r.items;
  } else if (stockData.market === 'US') {
    const r = await fetchUSNews(stockData.code, finnhubKey);
    if (r?._needsKey) hasMissingKey = true;
    else if (r) items = r.items;
  }

  const result = { items, hasMissingKey, market: stockData.market };
  cacheSet(cacheKey, result);
  return result;
}

/**
 * 把新闻格式化为简洁的中文文本，注入主编 prompt
 * @param {Object} newsData
 * @returns {string} 约 300-450 token
 */
export function formatNewsForPrompt(newsData) {
  if (!newsData || !Array.isArray(newsData.items) || newsData.items.length === 0) {
    return '';
  }
  const lines = [`【近期资讯·过去 ${LOOKBACK_DAYS} 天】`];
  newsData.items.forEach((item) => {
    if (!item.headline) return;
    const date = item.datetime || '';
    const source = item.source ? ` · ${item.source}` : '';
    lines.push(`${date}${source}`);
    lines.push(`  ${item.headline}`);
    if (item.summary && item.summary.length > 10) {
      lines.push(`  ${item.summary}`);
    }
  });
  if (lines.length === 1) return '';
  return lines.join('\n');
}
