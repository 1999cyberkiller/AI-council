/* ──────────────────────────────────────────────────────────────────
   PREWARM SCHEDULER · 静默预拉行情/K线/基准到缓存
   - 不抢主流程：议会运行时自动暂停，结束后续上
   - 并发限制：默认 2，避免一次发太多请求
   - 自动去重：同一 key 5 分钟内不重复入队
   - 错误静默：预热失败不打扰用户
   ────────────────────────────────────────────────────────────────── */

import { resolveStock, resolveKlineByCode, fetchBenchmarkSpot } from '../api/stocks';

const MAX_CONCURRENT = 2;
const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 同一 key 5 分钟内只预热一次
const PRIORITY = { hover: 100, auto: 10 };

let activeCount = 0;
let paused = false; // 议会运行时设为 true
const queue = []; // { key, fn, priority, ts }
const recentlyEnqueued = new Map(); // key → timestamp（用于去重）

function purgeStale() {
  const now = Date.now();
  for (const [key, ts] of recentlyEnqueued) {
    if (now - ts > DEDUPE_WINDOW_MS) recentlyEnqueued.delete(key);
  }
}

function pump() {
  if (paused) return;
  while (activeCount < MAX_CONCURRENT && queue.length > 0) {
    queue.sort((a, b) => b.priority - a.priority);
    const job = queue.shift();
    activeCount += 1;
    job.fn()
      .catch(() => {}) // 预热失败静默
      .finally(() => {
        activeCount -= 1;
        // 调度下一轮（如果还没暂停）
        if (!paused) pump();
      });
  }
}

function enqueue(key, fn, priority = PRIORITY.auto) {
  purgeStale();
  if (recentlyEnqueued.has(key)) return; // 5 分钟内已入队过
  recentlyEnqueued.set(key, Date.now());
  queue.push({ key, fn, priority, ts: Date.now() });
  pump();
}

/**
 * 暂停预热——议会启动时调用。已在飞行中的请求会自然完成。
 */
export function pausePrewarm() {
  paused = true;
}

/**
 * 恢复预热——议会结束时调用。
 */
export function resumePrewarm() {
  paused = false;
  pump();
}

/**
 * 预热单只股票的行情。市场推断不出来（中文名）的不预热。
 * @param {object} item watchlist 条目 { code, name, market }
 * @param {boolean} hover true=用户 hover 触发，优先级更高
 */
export function prewarmWatchlistItem(item, alphaKey, { hover = false } = {}) {
  if (!item || !item.code) return;
  const priority = hover ? PRIORITY.hover : PRIORITY.auto;

  // 第一步：行情
  enqueue(
    `spot:${item.code}`,
    () => resolveStock(item.code, alphaKey).then(() => null),
    priority
  );

  // K 线：A 股自动预热；美股只在 hover 时预热（节省 Alpha Vantage 配额）
  const isAShare = item.market === 'A' || /^\d{6}$/.test(item.code);
  if (isAShare || hover) {
    const market = isAShare ? 'A' : 'US';
    enqueue(
      `kline:${market}:${item.code}:90`,
      () => resolveKlineByCode(market, item.code, alphaKey, 90).then(() => null),
      priority
    );
  }
}

/**
 * 自动预热一批自选股（页面加载时调用）
 * - A 股全部入队（自动）
 * - 美股只预热行情，不预热 K 线（节省 Alpha Vantage 配额）
 */
export function prewarmWatchlistBatch(watchlist, alphaKey) {
  if (!Array.isArray(watchlist) || watchlist.length === 0) return;
  watchlist.forEach((item) => prewarmWatchlistItem(item, alphaKey, { hover: false }));
}

/**
 * 预热基准指数（A 股和美股各一次）—— 通常组合 watchlist 一起调用
 */
export function prewarmBenchmarks(watchlist, alphaKey) {
  if (!Array.isArray(watchlist)) return;
  const markets = new Set();
  watchlist.forEach((item) => {
    if (item.market === 'A' || /^\d{6}$/.test(item.code)) markets.add('A');
    else markets.add('US');
  });
  markets.forEach((m) => {
    enqueue(
      `baseline:${m}`,
      () => fetchBenchmarkSpot(m, alphaKey).then(() => null).catch(() => null),
      PRIORITY.auto
    );
  });
}

/**
 * 调试用：返回当前队列状态
 */
export function prewarmStatus() {
  return {
    queued: queue.length,
    active: activeCount,
    paused,
    keys: queue.map((j) => j.key),
  };
}
