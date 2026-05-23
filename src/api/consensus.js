/* ──────────────────────────────────────────────────────────────────
   CONSENSUS · 卖方共识数据
   - A 股：东方财富个股评级汇总（RPT_RESEARCHREPORT_RATINGRECENT）
   - 美股：Finnhub /stock/recommendation + /stock/price-target
   - 缓存：6 小时 TTL（卖方调整较频繁）

   返回的统一形态：
   {
     overall: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell',
     overallLabel: '买入/卖出/...',
     buyCount, holdCount, sellCount,    // 多少家投行
     targetPrice: number | null,         // 共识目标价
     targetUpside: number | null,        // (targetPrice - currentPrice) / currentPrice
     latestDate: 'YYYY-MM-DD',           // 最新评级日期
     market: 'A' | 'US'
   }
   ────────────────────────────────────────────────────────────────── */

import { fetchEastmoney, fetchWithTimeout } from './jsonp';

const CONS_CACHE_PREFIX = 'dispatch:cons:v1:';
const CONS_TTL_MS = 6 * 60 * 60 * 1000;

function cacheGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(CONS_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > CONS_TTL_MS) {
      window.sessionStorage.removeItem(CONS_CACHE_PREFIX + key);
      return null;
    }
    return entry.v;
  } catch { return null; }
}
function cacheSet(key, value) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(CONS_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

/* ──────────────────────────────────────────────────────────────
   A 股：东方财富研报评级
   ────────────────────────────────────────────────────────────── */
async function fetchAShareConsensus(code, currentPrice) {
  // 拉最近 90 天的研报评级
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?sortColumns=PUBLISH_DATE&sortTypes=-1&pageSize=30&pageNumber=1` +
    `&reportName=RPT_RESEARCHREPORT_RATINGRECENT&columns=ALL` +
    `&filter=(SECURITY_CODE%3D%22${encodeURIComponent(code)}%22)`;
  try {
    const r = await fetchEastmoney(url);
    const d = await r.json();
    const rows = d?.result?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // 过滤最近 90 天
    const cutoff = Date.now() - 90 * 86400000;
    const recent = rows.filter((row) => {
      const t = new Date(row.PUBLISH_DATE || '').getTime();
      return !isNaN(t) && t >= cutoff;
    });

    if (recent.length === 0) return null;

    // 评级映射
    let buyCount = 0, holdCount = 0, sellCount = 0;
    const targets = [];
    recent.forEach((row) => {
      const rating = (row.EMRATING_NAME || row.EMRATING || '').toLowerCase();
      if (rating.includes('买入') || rating.includes('增持') || rating.includes('强烈推荐')) buyCount++;
      else if (rating.includes('中性') || rating.includes('持有') || rating.includes('观望')) holdCount++;
      else if (rating.includes('卖出') || rating.includes('减持')) sellCount++;
      // 目标价：东方财富个别字段不稳定，能拿到就拿
      const tp = Number(row.TARGET_PRICE);
      if (!isNaN(tp) && tp > 0) targets.push(tp);
    });

    const total = buyCount + holdCount + sellCount;
    if (total === 0) return null;

    const overall = determineOverall(buyCount, holdCount, sellCount);
    const targetPrice = targets.length > 0
      ? targets.reduce((s, x) => s + x, 0) / targets.length
      : null;
    const targetUpside = (targetPrice && currentPrice)
      ? (targetPrice - currentPrice) / currentPrice
      : null;
    const latestDate = (recent[0].PUBLISH_DATE || '').slice(0, 10);

    return {
      overall,
      overallLabel: overallLabel(overall),
      buyCount,
      holdCount,
      sellCount,
      targetPrice,
      targetUpside,
      latestDate,
      market: 'A',
    };
  } catch (e) {
    console.debug('[consensus] A股 评级拉取失败:', e?.message);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────
   美股：Finnhub recommendation + price-target
   ────────────────────────────────────────────────────────────── */
async function fetchUSConsensus(symbol, finnhubKey, currentPrice) {
  if (!finnhubKey) return { _needsKey: true };

  // 并行拉评级 + 目标价
  const [recRes, tpRes] = await Promise.allSettled([
    fetchWithTimeout(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
      8000
    ),
    fetchWithTimeout(
      `https://finnhub.io/api/v1/stock/price-target?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
      8000
    ),
  ]);

  let buyCount = 0, holdCount = 0, sellCount = 0, latestDate = '';

  if (recRes.status === 'fulfilled' && recRes.value.ok) {
    try {
      const recData = await recRes.value.json();
      if (Array.isArray(recData) && recData.length > 0) {
        // 取最新一条（数组按时间降序）
        const latest = recData[0];
        buyCount = (latest.strongBuy || 0) + (latest.buy || 0);
        holdCount = latest.hold || 0;
        sellCount = (latest.strongSell || 0) + (latest.sell || 0);
        latestDate = latest.period || '';
      }
    } catch (e) {
      console.debug('[consensus] US rec parse 失败:', e?.message);
    }
  }

  let targetPrice = null;
  if (tpRes.status === 'fulfilled' && tpRes.value.ok) {
    try {
      const tpData = await tpRes.value.json();
      if (tpData && typeof tpData.targetMean === 'number' && tpData.targetMean > 0) {
        targetPrice = tpData.targetMean;
      }
    } catch (e) {
      console.debug('[consensus] US tp parse 失败:', e?.message);
    }
  }

  const total = buyCount + holdCount + sellCount;
  if (total === 0 && !targetPrice) return null;

  const overall = total > 0 ? determineOverall(buyCount, holdCount, sellCount) : null;
  const targetUpside = (targetPrice && currentPrice)
    ? (targetPrice - currentPrice) / currentPrice
    : null;

  return {
    overall,
    overallLabel: overall ? overallLabel(overall) : null,
    buyCount,
    holdCount,
    sellCount,
    targetPrice,
    targetUpside,
    latestDate: typeof latestDate === 'string' ? latestDate.slice(0, 10) : '',
    market: 'US',
  };
}

/* ──────────────────────────────────────────────────────────────
   工具
   ────────────────────────────────────────────────────────────── */
function determineOverall(buy, hold, sell) {
  const total = buy + hold + sell;
  if (total === 0) return null;
  const buyRatio = buy / total;
  const sellRatio = sell / total;
  if (buyRatio >= 0.7) return 'strong_buy';
  if (buyRatio >= 0.5) return 'buy';
  if (sellRatio >= 0.5) return 'sell';
  if (sellRatio >= 0.3) return 'sell';
  return 'hold';
}

function overallLabel(o) {
  return {
    strong_buy: '强烈买入',
    buy: '买入',
    hold: '中性',
    sell: '卖出',
    strong_sell: '强烈卖出',
  }[o] || o;
}

/* ──────────────────────────────────────────────────────────────
   公开 API
   ────────────────────────────────────────────────────────────── */
export async function resolveConsensus(stockData, finnhubKey, opts = {}) {
  if (!stockData || !stockData.code) {
    return { data: null, hasMissingKey: false };
  }
  const cacheKey = `${stockData.market}:${stockData.code}`;
  if (!opts.bypassCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  let data = null;
  let hasMissingKey = false;

  if (stockData.market === 'A') {
    data = await fetchAShareConsensus(stockData.code, stockData.price);
  } else if (stockData.market === 'US') {
    const r = await fetchUSConsensus(stockData.code, finnhubKey, stockData.price);
    if (r?._needsKey) hasMissingKey = true;
    else data = r;
  }

  const result = { data, hasMissingKey };
  cacheSet(cacheKey, result);
  return result;
}

/**
 * 把共识数据格式化为简洁的中文文本，注入到 LLM prompt
 */
export function formatConsensusForPrompt(consensusData) {
  if (!consensusData || !consensusData.data) return '';
  const c = consensusData.data;
  const total = (c.buyCount || 0) + (c.holdCount || 0) + (c.sellCount || 0);
  if (total === 0 && !c.targetPrice) return '';

  const lines = ['【卖方共识】'];
  if (c.overallLabel && total > 0) {
    lines.push(`最近 90 天评级（${total} 家）：${c.overallLabel} · 买${c.buyCount}/持${c.holdCount}/卖${c.sellCount}`);
  }
  if (c.targetPrice) {
    const upside = c.targetUpside != null
      ? `（${c.targetUpside >= 0 ? '+' : ''}${(c.targetUpside * 100).toFixed(1)}% 空间）`
      : '';
    const ccy = c.market === 'A' ? '元' : 'USD';
    lines.push(`共识目标价 ${c.targetPrice.toFixed(2)}${ccy}${upside}`);
  }
  if (c.latestDate) {
    lines.push(`最新评级 ${c.latestDate}`);
  }
  return lines.join('\n');
}
