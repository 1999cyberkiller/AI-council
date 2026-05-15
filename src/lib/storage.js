/* ──────────────────────────────────────────────────────────────────
   STORAGE · localStorage 包装（配置 + 历史 + 自选股 + 事件）
   ────────────────────────────────────────────────────────────────── */

const STORAGE_KEY  = 'dispatch:config:v1';
const HISTORY_KEY  = 'dispatch:history:v1';
const WATCHLIST_KEY = 'dispatch:watchlist:v1';
const TABS_KEY     = 'dispatch:tabs:v1';
const EVENTS_KEY   = 'dispatch:events:v1';

export const HISTORY_MAX = 50;
export const WATCHLIST_MAX = 30;
export const TABS_MAX = 12;
export const EVENTS_MAX = 500;

// 检测 localStorage 是否可用（隐私模式或某些 WebView 下可能禁用）
export const storageAvailable = () => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const probe = '__dispatch_storage_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

const safeGet = (key) => {
  if (!storageAvailable()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const safeSet = (key, value) => {
  if (!storageAvailable()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
};

const safeRemove = (key) => {
  if (!storageAvailable()) return false;
  try { window.localStorage.removeItem(key); return true; } catch { return false; }
};

// ── Config ──
export async function loadConfig() { return safeGet(STORAGE_KEY); }
export async function saveConfig(config) { return safeSet(STORAGE_KEY, config); }
export async function clearStoredConfig() { return safeRemove(STORAGE_KEY); }

// ── History ──
export async function loadHistory() {
  const v = safeGet(HISTORY_KEY);
  return Array.isArray(v) ? v : [];
}
export async function saveHistory(list) {
  const trimmed = list.slice(0, HISTORY_MAX);
  if (safeSet(HISTORY_KEY, trimmed)) return true;
  // 配额满，对半削减再试
  return safeSet(HISTORY_KEY, list.slice(0, Math.floor(HISTORY_MAX / 2)));
}
export async function clearStoredHistory() { return safeRemove(HISTORY_KEY); }

// ── Watchlist ──
export async function loadWatchlist() {
  const v = safeGet(WATCHLIST_KEY);
  return Array.isArray(v) ? v : [];
}
export async function saveWatchlist(list) {
  return safeSet(WATCHLIST_KEY, list.slice(0, WATCHLIST_MAX));
}

// ── Tabs (轻量索引：只存 ticker 和 timestamp，回填时从 history 找) ──
export async function loadTabIndex() {
  const v = safeGet(TABS_KEY);
  return Array.isArray(v) ? v : [];
}
export async function saveTabIndex(list) {
  return safeSet(TABS_KEY, list.slice(0, TABS_MAX));
}

// ── Events (telemetry) ──
export async function loadEvents() {
  const v = safeGet(EVENTS_KEY);
  return Array.isArray(v) ? v : [];
}
export async function appendEvent(evt) {
  const list = await loadEvents();
  list.push({ ...evt, t: Date.now() });
  return safeSet(EVENTS_KEY, list.slice(-EVENTS_MAX));
}
export async function clearEvents() { return safeRemove(EVENTS_KEY); }
