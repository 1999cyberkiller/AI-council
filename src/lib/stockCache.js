/* ──────────────────────────────────────────────────────────────────
   STOCK CACHE · 5 分钟 sessionStorage 缓存
   - resolveStock / resolveKline / fetchBenchmarkSpot 走 cache
   - 缓存命中：0 网络请求
   - sessionStorage 仅当前 tab；不污染长期 localStorage
   ────────────────────────────────────────────────────────────────── */

const CACHE_PREFIX = 'dispatch:cache:v1:';
export const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟

function isStorageAvailable() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    const probe = '__cache_probe__';
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function cacheGet(key) {
  if (!isStorageAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || typeof entry.t !== 'number') return null;
    if (Date.now() - entry.t > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.v;
  } catch {
    return null;
  }
}

function cacheSet(key, value) {
  if (!isStorageAvailable()) return;
  try {
    window.sessionStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ t: Date.now(), v: value })
    );
  } catch {
    // quota 满或其他错误，静默放弃
  }
}

export function cacheClear() {
  if (!isStorageAvailable()) return;
  const keys = [];
  for (let i = 0; i < window.sessionStorage.length; i++) {
    const k = window.sessionStorage.key(i);
    if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
  }
  keys.forEach((k) => window.sessionStorage.removeItem(k));
}

/**
 * 缓存包装器：promise-aware
 * @param {string} key cache key
 * @param {() => Promise<any>} fetcher 实际拉取函数
 * @param {object} opts { bypass: boolean — 跳过缓存读取，结果仍写入 }
 */
export async function withCache(key, fetcher, opts = {}) {
  if (!opts.bypass) {
    const hit = cacheGet(key);
    if (hit != null) return { value: hit, hit: true };
  }
  const value = await fetcher();
  if (value != null) cacheSet(key, value);
  return { value, hit: false };
}

// ── 标准 cache key 构造 ──
export function stockKey(input) {
  return `stock:${String(input).trim().toUpperCase()}`;
}
export function klineKey(market, code, days) {
  return `kline:${market}:${code}:${days}`;
}
export function baselineKey(market) {
  return `baseline:${market}`;
}
