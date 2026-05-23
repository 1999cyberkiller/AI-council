/* ──────────────────────────────────────────────────────────────────
   JSONP + CORS-AWARE FETCH · 跨域请求兜底
   东方财富部分接口禁止跨域；优先 JSONP（绕开 CORS）+ 公共代理回退
   ────────────────────────────────────────────────────────────────── */

const CORS_PROXIES = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
];

function parseJsonOrJsonp(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text || '').trim().match(/^[\w$.]+\(([\s\S]*)\);?$/);
    if (!match) throw new Error('返回不是 JSON/JSONP');
    return JSON.parse(match[1]);
  }
}

function jsonResult(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  };
}

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

async function fetchTextAsJson(url, ms) {
  const r = await fetchWithTimeout(url, ms);
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return jsonResult(parseJsonOrJsonp(text), r.status);
}

// 用于东方财富：VPS 同源代理优先 → JSONP → CORS 代理 → 直连
export async function fetchEastmoney(url) {
  // 路径 1: 线上同源代理，避免浏览器 CORS 和公共代理不稳定。
  try {
    if (typeof window !== 'undefined') {
      return await fetchTextAsJson(`/api/market/eastmoney?url=${encodeURIComponent(url)}`, 10000);
    }
  } catch { /* 进入 JSONP 回退 */ }

  // 路径 2: JSONP（适用于浏览器直连东方财富）
  try {
    const data = await fetchJsonp(url, 'cb', 8000);
    return jsonResult(data);
  } catch { /* 进入代理回退 */ }

  // 路径 3: CORS 代理
  let lastErr = null;
  for (const proxyFn of CORS_PROXIES) {
    try {
      return await fetchTextAsJson(proxyFn(url), 9000);
    } catch (e) { lastErr = e; }
  }

  // 路径 4: 直连兜底
  try {
    return await fetchTextAsJson(url, 4000);
  } catch (e) { lastErr = e; }

  const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
  throw new Error(`东方财富 (${host}) 不可达：${lastErr?.message || '所有路径失败'}`);
}
