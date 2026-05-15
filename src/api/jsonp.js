/* ──────────────────────────────────────────────────────────────────
   JSONP + CORS-AWARE FETCH · 跨域请求兜底
   东方财富部分接口禁止跨域；优先 JSONP（绕开 CORS）+ 公共代理回退
   ────────────────────────────────────────────────────────────────── */

const CORS_PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

export async function fetchWithTimeout(url, ms = 6000, signal) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), ms);
  // 如果外部传入 signal，串联 abort
  if (signal) {
    if (signal.aborted) ctrl.abort();
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

// JSONP：用 <script> 标签加载，绕开 CORS（适用于东方财富）
export function fetchJsonp(url, paramName = 'cb', timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('JSONP 仅在浏览器环境可用'));
      return;
    }
    const cbName = `__dispatch_jsonp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    let timeoutId = null;
    let scriptEl = null;

    const cleanup = () => {
      try { delete window[cbName]; } catch { window[cbName] = undefined; }
      if (scriptEl && scriptEl.parentNode) scriptEl.parentNode.removeChild(scriptEl);
      if (timeoutId) clearTimeout(timeoutId);
    };

    window[cbName] = (data) => { cleanup(); resolve(data); };

    scriptEl = document.createElement('script');
    const sep = url.includes('?') ? '&' : '?';
    scriptEl.src = `${url}${sep}${paramName}=${cbName}`;
    scriptEl.onerror = () => {
      cleanup();
      reject(new Error('JSONP script 加载失败'));
    };
    document.head.appendChild(scriptEl);

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP 超时'));
    }, timeoutMs);
  });
}

// 用于东方财富：JSONP 优先 → CORS 代理回退 → 直连
export async function fetchEastmoney(url) {
  // 路径 1: VPS 同源代理。生产环境优先走它，避免公共 CORS 代理不稳定。
  try {
    const r = await fetchWithTimeout(`/api/market/eastmoney?url=${encodeURIComponent(url)}`, 10000);
    if (r.headers.get('x-dispatch-proxy') === '1') {
      if (r.ok) return r;
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || `行情代理 HTTP ${r.status}`);
    }
  } catch (e) {
    if (String(e.message || '').includes('行情代理')) throw e;
  }

  // 路径 2: JSONP（本地 dev 没有代理时，绕开 CORS）
  try {
    const data = await fetchJsonp(url, 'cb', 8000);
    return { ok: true, json: async () => data };
  } catch { /* 进入代理回退 */ }

  // 路径 3: CORS 代理
  let lastErr = null;
  for (const proxyFn of CORS_PROXIES) {
    try {
      const r = await fetchWithTimeout(proxyFn(url), 9000);
      if (r.ok) return r;
      lastErr = new Error(`代理 HTTP ${r.status}`);
    } catch (e) { lastErr = e; }
  }

  // 路径 4: 直连兜底
  try {
    const r = await fetchWithTimeout(url, 4000);
    if (r.ok) return r;
    lastErr = new Error(`直连 HTTP ${r.status}`);
  } catch (e) { lastErr = e; }

  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  throw new Error(`东方财富 (${host}) 不可达：${lastErr?.message || '所有路径失败'}`);
}
