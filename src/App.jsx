import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import {
  loadConfig, saveConfig, clearStoredConfig,
  loadHistory, saveHistory, clearStoredHistory,
  loadWatchlist, saveWatchlist,
  loadInvestmentMemos, saveInvestmentMemos,
  loadTabIndex, saveTabIndex,
  appendEvent,
  HISTORY_MAX, WATCHLIST_MAX,
} from './lib/storage';
import { cleanTickerInput } from './lib/parser';
import { ANALYSTS } from './lib/prompts';
import { resolveStock, fetchPriceAtDate, fetchBenchmarkAtDate } from './api/stocks';
import { DEFAULT_MODELS, resolveVariant, callModel } from './api/models';
import {
  aggregateScores,
  isDueForBackfill, backfillStatus,
  TRACK_WINDOW_DAYS,
} from './lib/scoring';

import { useDispatchSession } from './hooks/useDispatchSession';
import { STY_TOAST } from './lib/styles';
import { useConfirm } from './hooks';
import { TickerTape } from './components/atoms';
import { AnalystColumn } from './components/AnalystColumn';
import { EditorSection } from './components/EditorSection';
import { DataGapPanel } from './components/DataGapPanel';
import { CredibilityPanel } from './components/CredibilityPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { WatchlistPanel } from './components/WatchlistPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ComparePanel } from './components/ComparePanel';
import { ActionButtons } from './components/ActionButtons';
import { EventsBadge } from './components/EventsBadge';
import { FinancialsBadge } from './components/FinancialsBadge';
import { NewsBadge } from './components/NewsBadge';
import { ThemeRotationPanel } from './components/ThemeRotationPanel';
import { SecondRoundSection } from './components/SecondRoundSection';
import { FreeAskSection } from './components/FreeAskSection';
import { EvolutionTimeline } from './components/EvolutionTimeline';
import { TaskConsole } from './components/TaskConsole';
import { InvestmentMemoSection } from './components/InvestmentMemoSection';
import { QVMRPanel } from './components/QVMRPanel';
import { buildMentionDictionary } from './lib/stockMentions';
import { buildInvestmentMemoDraft, memoToMarkdown } from './lib/investmentMemo';
import {
  prewarmWatchlistBatch, prewarmBenchmarks, prewarmWatchlistItem,
  pausePrewarm, resumePrewarm,
} from './lib/prewarm';

const errText = (e) => String(e?.message || e || '未知错误').slice(0, 160);

export default function App() {
  const [confirm, confirmDialog] = useConfirm();

  /* ── 配置状态（持久化）─────────────────────────────────── */
  const [models, setModels] = useState(DEFAULT_MODELS);
  const [apiKeys, setApiKeys] = useState({});
  const [alphaKey, setAlphaKey] = useState('');
  const [finnhubKey, setFinnhubKey] = useState('');
  const [assignments, setAssignments] = useState({
    value: 'deepseek', tech: 'grok', macro: 'gemini', risk: 'minimax', editor: 'deepseek',
  });
  const [modelVariants, setModelVariants] = useState({});
  const [theme, setTheme] = useState('light');
  const [personaSignalsEnabled, setPersonaSignalsEnabled] = useState(true);
  const [modelHealth, setModelHealth] = useState({});
  const [modelHealthRunning, setModelHealthRunning] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const saveTimerRef = useRef(null);

  /* ── 用户数据 ──────────────────────────────────────────── */
  const [history, setHistory] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [investmentMemos, setInvestmentMemos] = useState({});
  const [watchScan, setWatchScan] = useState({ running: false, done: 0, total: 0, items: {}, lastRunAt: null });

  /* ── tabs ──────────────────────────────────────────────── */
  const [tabs, setTabs] = useState([]);
  const [activeTabId, setActiveTabId] = useState(null);

  /* ── UI ────────────────────────────────────────────────── */
  const [tickerInput, setTickerInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [credibilityOpen, setCredibilityOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [evolutionOpen, setEvolutionOpen] = useState(false);
  const tickerInputRef = useRef(null);

  /* ── Esc 关闭演化弹窗（与其他面板一致）─────────────────── */
  useEffect(() => {
    if (!evolutionOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setEvolutionOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [evolutionOpen]);

  /* ── 快捷键：按 / 聚焦问询输入框 ─────────────────────────── */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      e.preventDefault();
      tickerInputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── 准确率回填 ────────────────────────────────────────── */
  const [backfillState, setBackfillState] = useState('idle');
  const [backfillProgress, setBackfillProgress] = useState(null);
  const backfillTimerRef = useRef(null);

  /* ── toast ─────────────────────────────────────────────── */
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  }, []);

  /* ── 派生：准确率统计 + mention 字典 ───────────────────── */
  const credibilityStats = useMemo(() => aggregateScores(history), [history]);
  const mentionDict = useMemo(
    () => buildMentionDictionary(watchlist, history),
    [watchlist, history]
  );

  /* ── Session Hook ──────────────────────────────────────── */
  const handleSessionEvent = useCallback((evt) => {
    if (evt.type === 'session_complete') {
      // 1) 写历史档案
      const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        ticker: evt.ticker,
        stockData: evt.stockData,
        klineData: evt.klineData,
        analyses: evt.analyses,
        editorState: evt.editorState,
        eventsData: evt.eventsData,
        financialsData: evt.financialsData,
        consensusData: evt.consensusData,
        newsData: evt.newsData,
        themeRotationData: evt.themeRotationData,
        dataHealth: evt.dataHealth,
        freeAskThreads: [],
        secondRound: null,
        assignments: { ...assignments },
        modelLabels: ANALYSTS.reduce((acc, a) => {
          const m = models.find((x) => x.id === assignments[a.id]);
          const v = m ? resolveVariant(m, modelVariants[m.id]) : null;
          acc[a.id] = m ? `${m.name} · ${v?.label || ''}` : '';
          return acc;
        }, {}),
        priceAt0: typeof evt.stockData.price === 'number' ? evt.stockData.price : null,
        marketBaseline: evt.baseline,
        outcome: null,
        outcomeAttempts: [],
      };
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, HISTORY_MAX);
        saveHistory(next);
        return next;
      });

      // 2) 写 tab（以 ticker 作为 tab id；同 ticker 覆盖）
      const tabRecord = {
        id: evt.ticker,
        ticker: evt.ticker,
        stockData: evt.stockData,
        klineData: evt.klineData,
        analyses: evt.analyses,
        editorState: evt.editorState,
        secondRound: null,
        eventsData: evt.eventsData,
        financialsData: evt.financialsData,
        consensusData: evt.consensusData,
        newsData: evt.newsData,
        themeRotationData: evt.themeRotationData,
        dataHealth: evt.dataHealth,
        freeAskThreads: [],
      };
      setTabs((prev) => {
        const existing = prev.findIndex((t) => t.id === evt.ticker);
        const next = existing >= 0
          ? prev.map((t, i) => (i === existing ? tabRecord : t))
          : [...prev, tabRecord];
        saveTabIndex(next.map((t) => ({ id: t.id, ticker: t.ticker })));
        return next;
      });
      setActiveTabId(evt.ticker);

      appendEvent({ type: 'analysis_done', ticker: evt.ticker, market: evt.market, hasEditor: !!evt.editorState });
    } else if (evt.type === 'second_round_done' || evt.type === 'free_ask_done') {
      appendEvent(evt);
    }
  }, [assignments, models, modelVariants]);

  const { state: session, actions } = useDispatchSession({
    models, apiKeys, modelVariants, assignments,
    alphaKey, finnhubKey,
    modelHealth, personaSignalsEnabled, credibilityStats,
    onEvent: handleSessionEvent,
  });

  /* ── 配置加载 ──────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadConfig();
      if (cancelled) return;
      if (stored && typeof stored === 'object') {
        if (stored.apiKeys) setApiKeys(stored.apiKeys);
        if (typeof stored.alphaKey === 'string') setAlphaKey(stored.alphaKey);
        if (typeof stored.finnhubKey === 'string') setFinnhubKey(stored.finnhubKey);
        if (Array.isArray(stored.models)) {
          const customs = stored.models.filter((m) => m.custom);
          const defaultIds = new Set(DEFAULT_MODELS.map((m) => m.id));
          setModels([...DEFAULT_MODELS, ...customs.filter((m) => !defaultIds.has(m.id))]);
        }
        if (stored.assignments) setAssignments((prev) => ({ ...prev, ...stored.assignments }));
        if (stored.modelVariants) setModelVariants(stored.modelVariants);
        if (stored.theme === 'dark' || stored.theme === 'light') setTheme(stored.theme);
        if (typeof stored.personaSignalsEnabled === 'boolean') setPersonaSignalsEnabled(stored.personaSignalsEnabled);
      }
      setConfigLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, wl, tabIdx, memos] = await Promise.all([
        loadHistory(), loadWatchlist(), loadTabIndex(), loadInvestmentMemos(),
      ]);
      if (cancelled) return;
      setHistory(list);
      setWatchlist(wl);
      setInvestmentMemos(memos);
      if (Array.isArray(tabIdx) && tabIdx.length > 0) {
        const restored = [];
        for (const idx of tabIdx) {
          const matched = list.find((h) => h.ticker === idx.ticker);
          if (matched) {
            restored.push({
              id: idx.id || matched.ticker,
              ticker: matched.ticker,
              stockData: matched.stockData,
              klineData: matched.klineData,
              analyses: matched.analyses,
              editorState: matched.editorState,
              secondRound: matched.secondRound || null,
              eventsData: matched.eventsData || null,
              financialsData: matched.financialsData || null,
              consensusData: matched.consensusData || null,
              newsData: matched.newsData || null,
              themeRotationData: matched.themeRotationData || null,
              dataHealth: matched.dataHealth || {},
              freeAskThreads: matched.freeAskThreads || [],
            });
          }
        }
        if (restored.length > 0) setTabs(restored);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ── 自动预热自选股 ────────────────────────────────────── */
  useEffect(() => {
    if (!configLoaded) return;
    if (!watchlist || watchlist.length === 0) return;
    const t = setTimeout(() => {
      prewarmWatchlistBatch(watchlist, alphaKey);
      prewarmBenchmarks(watchlist, alphaKey);
    }, 2000);
    return () => clearTimeout(t);
  }, [configLoaded, watchlist, alphaKey]);

  /* ── 配置自动保存（防抖）──────────────────────────────── */
  useEffect(() => {
    if (!configLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      const ok = await saveConfig({
        version: 2,
        apiKeys, alphaKey, finnhubKey,
        models: models.filter((m) => m.custom),
        assignments, modelVariants, theme, personaSignalsEnabled,
      });
      setSaveStatus(ok ? 'saved' : 'error');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1800);
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [apiKeys, alphaKey, finnhubKey, models, assignments, modelVariants, theme, personaSignalsEnabled, configLoaded]);

  /* ── 把 session 的 secondRound/freeAskThreads/数据流同步进 tab & history ─── */
  // 用单一 effect 统一同步，避免多源回环
  useEffect(() => {
    if (!activeTabId) return;
    if (session.ticker !== activeTabId) return;
    if (session.phase === 'idle' || session.phase === 'fetching') return;

    // 1) 同步 tab（防抖在外层做不必要，因为 React batch 已合并）
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return prev;
      const cur = prev[idx];
      const patched = {
        ...cur,
        secondRound: session.secondRound,
        freeAskThreads: session.freeAskThreads,
        eventsData: session.eventsData ?? cur.eventsData,
        financialsData: session.financialsData ?? cur.financialsData,
        consensusData: session.consensusData ?? cur.consensusData,
        newsData: session.newsData ?? cur.newsData,
        themeRotationData: session.themeRotationData ?? cur.themeRotationData,
        dataHealth: session.dataHealth ?? cur.dataHealth,
      };
      // 引用相等检查避免无意义 setState
      if (
        cur.secondRound === patched.secondRound &&
        cur.freeAskThreads === patched.freeAskThreads &&
        cur.eventsData === patched.eventsData &&
        cur.financialsData === patched.financialsData &&
        cur.consensusData === patched.consensusData &&
        cur.newsData === patched.newsData &&
        cur.themeRotationData === patched.themeRotationData &&
        cur.dataHealth === patched.dataHealth
      ) return prev;
      const next = [...prev];
      next[idx] = patched;
      return next;
    });
  }, [
    activeTabId, session.ticker, session.phase,
    session.secondRound, session.freeAskThreads,
    session.eventsData, session.financialsData, session.consensusData, session.newsData,
    session.themeRotationData, session.dataHealth,
  ]);

  // 等 session 静止后再写 history（避免 secondRound 跑一半就把中间态写盘）
  useEffect(() => {
    if (!activeTabId) return;
    if (session.ticker !== activeTabId) return;
    if (session.secondRoundRunning || session.freeAskRunning) return;
    const t = setTimeout(() => {
      setHistory((prev) => {
        const idx = prev.findIndex((e) => e.ticker === activeTabId);
        if (idx === -1) return prev;
        const cur = prev[idx];
        const patched = {
          ...cur,
          secondRound: session.secondRound ?? cur.secondRound,
          freeAskThreads: session.freeAskThreads ?? cur.freeAskThreads,
          eventsData: session.eventsData ?? cur.eventsData,
          financialsData: session.financialsData ?? cur.financialsData,
          consensusData: session.consensusData ?? cur.consensusData,
          newsData: session.newsData ?? cur.newsData,
          themeRotationData: session.themeRotationData ?? cur.themeRotationData,
          dataHealth: session.dataHealth ?? cur.dataHealth,
        };
        if (
          cur.secondRound === patched.secondRound &&
          cur.freeAskThreads === patched.freeAskThreads &&
          cur.eventsData === patched.eventsData &&
          cur.financialsData === patched.financialsData &&
          cur.consensusData === patched.consensusData &&
          cur.newsData === patched.newsData &&
          cur.themeRotationData === patched.themeRotationData &&
          cur.dataHealth === patched.dataHealth
        ) return prev;
        const next = [...prev];
        next[idx] = patched;
        saveHistory(next);
        return next;
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [
    activeTabId, session.ticker,
    session.secondRoundRunning, session.freeAskRunning,
    session.secondRound, session.freeAskThreads,
    session.eventsData, session.financialsData, session.consensusData, session.newsData,
    session.themeRotationData, session.dataHealth,
  ]);

  /* ── Handlers ──────────────────────────────────────────── */
  const handleSubmit = useCallback(() => {
    const ticker = cleanTickerInput(tickerInput);
    if (!ticker) return;
    actions.start(ticker);
  }, [tickerInput, actions]);

  const handleSubmitWith = useCallback((raw) => {
    const ticker = cleanTickerInput(raw);
    if (!ticker) return;
    setTickerInput(ticker);
    actions.start(ticker);
  }, [actions]);

  const handleSummonStock = useCallback((code) => {
    const busy = ['fetching', 'analysts', 'editor'].includes(session.phase);
    if (!code || busy) return;
    handleSubmitWith(code);
  }, [session.phase, handleSubmitWith]);

  const switchTab = useCallback((tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    actions.hydrate({
      ticker: tab.ticker,
      stockData: tab.stockData,
      klineData: tab.klineData,
      analyses: tab.analyses,
      editorState: tab.editorState,
      secondRound: tab.secondRound || null,
      eventsData: tab.eventsData || null,
      financialsData: tab.financialsData || null,
      consensusData: tab.consensusData || null,
      newsData: tab.newsData || null,
      themeRotationData: tab.themeRotationData || null,
      dataHealth: tab.dataHealth || {},
      freeAskThreads: tab.freeAskThreads || [],
    });
  }, [tabs, actions]);

  const closeTab = useCallback((tabId) => {
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    saveTabIndex(newTabs.map((t) => ({ id: t.id, ticker: t.ticker })));
    if (activeTabId === tabId) {
      if (newTabs.length > 0) {
        switchTab(newTabs[newTabs.length - 1].id);
      } else {
        setActiveTabId(null);
        actions.reset();
      }
    }
  }, [tabs, activeTabId, actions, switchTab]);

  const loadFromHistory = useCallback((entryId) => {
    const entry = history.find((h) => h.id === entryId);
    if (!entry) return;
    actions.hydrate({
      ticker: entry.ticker,
      stockData: entry.stockData,
      klineData: entry.klineData,
      analyses: entry.analyses,
      editorState: entry.editorState,
      secondRound: entry.secondRound || null,
      eventsData: entry.eventsData || null,
      financialsData: entry.financialsData || null,
      consensusData: entry.consensusData || null,
      newsData: entry.newsData || null,
      themeRotationData: entry.themeRotationData || null,
      dataHealth: entry.dataHealth || {},
      freeAskThreads: entry.freeAskThreads || [],
    });
    setHistoryOpen(false);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [history, actions]);

  /* ── 各种 modal 配置 ───────────────────────────────────── */
  const handleClearStorage = async () => {
    const ok = await confirm('确定清除所有已存储的 API 凭据和自定义模型吗？此操作不可撤销。', { danger: true, title: '清除凭据' });
    if (!ok) return;
    await clearStoredConfig();
    setApiKeys({}); setAlphaKey(''); setModels(DEFAULT_MODELS);
    setAssignments({ value: 'deepseek', tech: 'grok', macro: 'gemini', risk: 'minimax', editor: 'deepseek' });
    setSaveStatus('idle');
  };

  const addCustomModel = (model) => setModels((prev) => [...prev, model]);
  const removeModel = (id) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    setApiKeys((prev) => { const n = { ...prev }; delete n[id]; return n; });
    setAssignments((prev) => {
      const n = { ...prev };
      Object.keys(n).forEach((k) => { if (n[k] === id) n[k] = ''; });
      return n;
    });
  };

  /* ── Watchlist ─────────────────────────────────────────── */
  const isInWatchlist = (code) => watchlist.some((w) => w.code === code);
  const toggleWatchlist = () => {
    if (!session.stockData) return;
    const code = session.stockData.code;
    const newList = isInWatchlist(code)
      ? watchlist.filter((w) => w.code !== code)
      : [
          { code, name: session.stockData.name, market: session.stockData.market, addedAt: Date.now() },
          ...watchlist,
        ].slice(0, WATCHLIST_MAX);
    setWatchlist(newList);
    saveWatchlist(newList);
  };
  const removeFromWatchlist = async (code) => {
    const item = watchlist.find((w) => w.code === code);
    const ok = await confirm(`从自选股移除「${item?.name || code}」？`, { danger: true, title: '移除自选' });
    if (!ok) return;
    const newList = watchlist.filter((w) => w.code !== code);
    setWatchlist(newList);
    saveWatchlist(newList);
  };
  const analyzeFromWatchlist = (item) => {
    setWatchlistOpen(false);
    setTimeout(() => handleSubmitWith(item.code), 60);
  };

  const scanWatchlist = async () => {
    if (watchScan.running || watchlist.length === 0) return;
    const items = [...watchlist];
    pausePrewarm();
    const initial = Object.fromEntries(items.map((w) => [w.code, { status: 'pending', detail: '等待行情' }]));
    const next = { ...initial };
    setWatchScan({ running: true, done: 0, total: items.length, items: initial, lastRunAt: watchScan.lastRunAt });
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const data = await resolveStock(item.code, alphaKey);
          const pct = typeof data.changePct === 'number' ? data.changePct : null;
          const absPct = pct == null ? 0 : Math.abs(pct);
          const detail = absPct >= 5 ? '大幅波动，建议复盘' : absPct >= 3 ? '波动放大' : '平稳';
          next[item.code] = {
            status: absPct >= 3 ? 'warning' : 'ok',
            priceText: `${data.market === 'A' ? '¥' : '$'}${typeof data.price === 'number' ? data.price.toFixed(2) : '—'}`,
            changeText: pct == null ? '涨跌 —' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
            detail, scannedAt: Date.now(),
          };
        } catch (e) {
          next[item.code] = { status: 'error', detail: errText(e), scannedAt: Date.now() };
        }
        setWatchScan((prev) => ({ ...prev, running: true, done: i + 1, total: items.length, items: { ...next } }));
      }
    } finally {
      setWatchScan((prev) => ({ ...prev, running: false, total: items.length, items: { ...next }, lastRunAt: Date.now() }));
      resumePrewarm();
    }
  };

  /* ── 历史导出 / 删除 ──────────────────────────────────── */
  const deleteFromHistory = async (entryId) => {
    const entry = history.find((h) => h.id === entryId);
    const name = entry?.stockData?.name || entry?.ticker || '该条';
    const ok = await confirm(`删除「${name}」这条记录？`, { danger: true, title: '删除记录' });
    if (!ok) return;
    const newHistory = history.filter((h) => h.id !== entryId);
    setHistory(newHistory);
    saveHistory(newHistory);
  };
  const handleClearHistory = async () => {
    const ok = await confirm(`确定清除全部 ${history.length} 条历史记录吗？此操作不可撤销。`, { danger: true, title: '清空档案' });
    if (!ok) return;
    await clearStoredHistory();
    setHistory([]);
  };

  const fmtMdDate = (ts) => {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const buildHistoryMarkdown = (entry) => {
    const stock = entry.stockData || {};
    const lines = [`# ${stock.name || entry.ticker} AI议会`, ''];
    lines.push(`- 代码：${stock.code || entry.ticker || '—'}`);
    lines.push(`- 市场：${stock.market === 'A' ? 'A 股' : stock.market === 'US' ? '美股' : '—'}`);
    lines.push(`- 归档时间：${fmtMdDate(entry.timestamp)}`);
    if (typeof stock.price === 'number') lines.push(`- 分析时价格：${stock.price}`);
    lines.push('');
    const editor = entry.editorState?.data;
    if (editor) {
      lines.push('## 主编札记', '');
      lines.push(`- 最终建议：${editor.verdict || '—'}`);
      lines.push(`- 信心：${editor.conviction || '—'} / 5`);
      if (editor.headline) lines.push(`- 标题：${editor.headline}`);
      if (editor.key_sentence) lines.push(`- 核心句：${editor.key_sentence}`);
      if (editor.watchpoint) lines.push(`- 观察点：${editor.watchpoint}`);
      lines.push('');
    }
    lines.push('## 四位分析师', '');
    ANALYSTS.forEach((a) => {
      const st = entry.analyses?.[a.id];
      lines.push(`### ${a.cnName}`, '');
      if (st?.status !== 'done') { lines.push(`未完成：${st?.error || '无结果'}`, ''); return; }
      const d = st.data;
      lines.push(`- 建议：${d.verdict || '—'}`);
      lines.push(`- 信心：${d.conviction || '—'} / 5`);
      if (d.headline) lines.push(`- 标题：${d.headline}`);
      lines.push('');
      if (d.analysis) { lines.push(d.analysis, ''); }
      if (Array.isArray(d.key_points) && d.key_points.length) {
        lines.push('关键论点：');
        d.key_points.forEach((p) => lines.push(`- ${p}`));
        lines.push('');
      }
      if (d.risk) lines.push(`风险提示：${d.risk}`, '');
    });
    lines.push('---', '由 AI议会 导出。内容仅供研究，不构成投资建议。');
    return lines.join('\n');
  };

  const downloadTextFile = (filename, text, mime = 'text/markdown;charset=utf-8') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const exportHistoryEntry = (entryId) => {
    const entry = history.find((h) => h.id === entryId);
    if (!entry) return;
    const code = entry.stockData?.code || entry.ticker || 'dispatch';
    downloadTextFile(`${code}-ai-council-gazette.md`, buildHistoryMarkdown(entry));
  };

  /* ── 准确率回填 ────────────────────────────────────────── */
  const backfillSingleEntry = useCallback(async (entry) => {
    if (!entry || !entry.timestamp) throw new Error('条目缺少时间戳');
    if (!entry.priceAt0 || typeof entry.priceAt0 !== 'number') throw new Error('缺少初始价格');
    if (!entry.marketBaseline || typeof entry.marketBaseline.price !== 'number') throw new Error('缺少基准指数初始值');
    const targetDateMs = entry.timestamp + TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const market = entry.stockData?.market || 'A';
    const code = entry.stockData?.code;
    if (!code) throw new Error('条目缺少股票代码');

    // ★ Task 3 改进：用 T+30±2 窗口的中位数收盘价（而不是单点 T+30）
    const sampleOffsetsDays = [-2, -1, 0, 1, 2];
    const stockSamples = [];
    const benchSamples = [];
    for (const off of sampleOffsetsDays) {
      const ts = targetDateMs + off * 24 * 60 * 60 * 1000;
      try {
        const sp = await fetchPriceAtDate(market, code, alphaKey, ts, 75);
        stockSamples.push(sp);
      } catch {/* 单点失败容忍 */}
      try {
        const bp = await fetchBenchmarkAtDate(market, alphaKey, ts, 75);
        benchSamples.push(bp);
      } catch {/* 单点失败容忍 */}
      // 美股 Alpha Vantage 配额谨慎
      if (market === 'US') await new Promise((r) => setTimeout(r, 350));
    }
    if (stockSamples.length === 0) throw new Error('股票 T+30 窗口内无可用收盘价');
    if (benchSamples.length === 0) throw new Error('基准 T+30 窗口内无可用收盘价');

    const median = (arr) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const stockMedian = median(stockSamples.map((s) => s.close));
    const benchMedian = median(benchSamples.map((s) => s.close));

    const stockReturnPct = ((stockMedian - entry.priceAt0) / entry.priceAt0) * 100;
    const marketReturnPct = ((benchMedian - entry.marketBaseline.price) / entry.marketBaseline.price) * 100;
    const excessReturnPct = stockReturnPct - marketReturnPct;

    // ★ 同时记录最好/最差情况，让 UI 能展示判断的脆弱性
    const stockBest = Math.max(...stockSamples.map((s) => s.close));
    const stockWorst = Math.min(...stockSamples.map((s) => s.close));
    const stockBestPct = ((stockBest - entry.priceAt0) / entry.priceAt0) * 100;
    const stockWorstPct = ((stockWorst - entry.priceAt0) / entry.priceAt0) * 100;

    return {
      status: 'done',
      t30: Date.now(),
      stockDate: stockSamples[Math.floor(stockSamples.length / 2)].date,
      priceAt30: Number(stockMedian.toFixed(4)),
      marketDate: benchSamples[Math.floor(benchSamples.length / 2)].date,
      marketAt30: Number(benchMedian.toFixed(4)),
      stockReturnPct: Number(stockReturnPct.toFixed(2)),
      marketReturnPct: Number(marketReturnPct.toFixed(2)),
      excessReturnPct: Number(excessReturnPct.toFixed(2)),
      // 新增：窗口范围
      windowDays: sampleOffsetsDays.length,
      stockReturnBestPct: Number(stockBestPct.toFixed(2)),
      stockReturnWorstPct: Number(stockWorstPct.toFixed(2)),
      windowSpreadPct: Number((stockBestPct - stockWorstPct).toFixed(2)),
    };
  }, [alphaKey]);

  const backfillDueEntries = useCallback(async (opts = {}) => {
    const { maxPerRun = 6, force = false } = opts;
    if (backfillState === 'running') return { ran: 0, ok: 0, failed: 0, skipped: 'already running' };
    const due = history.filter((e) => force || isDueForBackfill(e));
    if (due.length === 0) { setBackfillProgress(null); return { ran: 0, ok: 0, failed: 0 }; }
    setBackfillState('running');
    const batch = due.slice(0, maxPerRun);
    setBackfillProgress({ current: 0, total: batch.length });
    let updated = [...history];
    let ok = 0, failed = 0;
    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i];
      const idx = updated.findIndex((h) => h.id === entry.id);
      if (idx === -1) continue;
      try {
        const outcome = await backfillSingleEntry(entry);
        updated[idx] = {
          ...entry, outcome,
          outcomeAttempts: [...(entry.outcomeAttempts || []), { at: Date.now(), ok: true }],
        };
        ok += 1;
      } catch (err) {
        updated[idx] = {
          ...entry,
          outcomeAttempts: [...(entry.outcomeAttempts || []), { at: Date.now(), ok: false, error: err.message }],
        };
        failed += 1;
      }
      setBackfillProgress({ current: i + 1, total: batch.length });
      if (entry.stockData?.market === 'US' && i < batch.length - 1) await new Promise((r) => setTimeout(r, 800));
    }
    setHistory(updated);
    await saveHistory(updated);
    setBackfillState('idle');
    setBackfillProgress(null);
    appendEvent({ type: 'backfill_run', ran: batch.length, ok, failed });
    return { ran: batch.length, ok, failed, remaining: due.length - batch.length };
  }, [history, backfillState, backfillSingleEntry]);

  useEffect(() => {
    if (history.length === 0) return;
    const tick = () => { backfillDueEntries({ maxPerRun: 6 }).catch(() => {}); };
    const initial = setTimeout(tick, 5000);
    backfillTimerRef.current = setInterval(tick, 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      if (backfillTimerRef.current) clearInterval(backfillTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length > 0]);

  /* ── 测试模型连通性 ─────────────────────────────────── */
  const testModelHealth = async () => {
    if (modelHealthRunning) return;
    const configured = models.filter((m) => apiKeys[m.id]?.trim());
    if (configured.length === 0) {
      showToast('先填至少一个模型 API Key');
      return;
    }
    const initial = {};
    models.forEach((m) => {
      initial[m.id] = apiKeys[m.id]?.trim()
        ? { status: 'pending', name: m.name, variant: resolveVariant(m, modelVariants[m.id])?.label || '', detail: '测试中' }
        : { status: 'missing', name: m.name, detail: '未配置 key' };
    });
    setModelHealth(initial);
    setModelHealthRunning(true);
    await Promise.all(configured.map(async (m) => {
      const variant = resolveVariant(m, modelVariants[m.id]);
      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const raw = await callModel(
          m, apiKeys[m.id],
          '你是模型连接测试。只做连通性验证。',
          '请只返回 JSON：{"ok":true}',
          modelVariants[m.id], controller.signal
        );
        clearTimeout(timer);
        const ms = Math.round(performance.now() - started);
        setModelHealth((prev) => ({
          ...prev,
          [m.id]: { status: 'ok', name: m.name, variant: variant?.label || '', ms, detail: String(raw || '').slice(0, 90) || '已返回' },
        }));
      } catch (e) {
        clearTimeout(timer);
        const ms = Math.round(performance.now() - started);
        setModelHealth((prev) => ({
          ...prev,
          [m.id]: { status: 'error', name: m.name, variant: variant?.label || '', ms, detail: e?.name === 'AbortError' ? '15 秒超时' : errText(e) },
        }));
      }
    }));
    setModelHealthRunning(false);
  };

  /* ── Investment Memo ───────────────────────────────────── */
  const investmentMemoDraft = useMemo(
    () => buildInvestmentMemoDraft(session.stockData, session.analyses, session.editorState),
    [session.stockData, session.analyses, session.editorState]
  );
  const currentInvestmentMemo = session.stockData?.code ? investmentMemos[session.stockData.code] : null;
  const saveCurrentInvestmentMemo = (memo) => {
    if (!session.stockData?.code) return;
    const next = { ...investmentMemos, [session.stockData.code]: { ...memo, stockCode: session.stockData.code, stockName: session.stockData.name, updatedAt: Date.now() } };
    setInvestmentMemos(next);
    saveInvestmentMemos(next);
    showToast('投资备忘录已保存');
  };
  const exportCurrentInvestmentMemo = () => {
    if (!session.stockData) return;
    const memo = currentInvestmentMemo || investmentMemoDraft;
    downloadTextFile(`${session.stockData.code || 'stock'}-investment-memo.md`, memoToMarkdown(session.stockData, memo));
  };

  /* ── 统计型综合意见（主编 fallback）───────────────────── */
  const consensus = useMemo(() => {
    const done = Object.values(session.analyses)
      .filter((a) => a?.status === 'done')
      .map((a) => a.data);
    if (done.length < 2) return null;
    const buy = done.filter((d) => d.verdict === 'BUY').length;
    const hold = done.filter((d) => d.verdict === 'HOLD').length;
    const sell = done.filter((d) => d.verdict === 'SELL').length;
    const avgConviction = done.reduce((s, d) => s + d.conviction, 0) / done.length;
    let mood;
    const total = done.length;
    if (buy >= total * 0.75) mood = '议会高度看多';
    else if (sell >= total * 0.75) mood = '议会高度看空';
    else if (buy > sell + hold) mood = '议会偏向看多';
    else if (sell > buy + hold) mood = '议会偏向看空';
    else if (buy > sell) mood = '温和看多，存在分歧';
    else if (sell > buy) mood = '谨慎为主，存在隐忧';
    else mood = '议会观点分化';
    return { buy, hold, sell, total, avgConviction, mood };
  }, [session.analyses]);

  const hasAnyConfig = useMemo(() => {
    return ANALYSTS.some((a) => {
      const m = models.find((x) => x.id === assignments[a.id]);
      return m && apiKeys[m.id] && apiKeys[m.id].trim();
    });
  }, [models, apiKeys, assignments]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const handlePrint = () => window.print();

  /* ── 同步 <meta name="theme-color">，让移动端状态栏跟随主题 ── */
  useEffect(() => {
    const pageColor = theme === 'dark' ? '#1B1612' : '#F0E8D6';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', pageColor);
    document.documentElement.style.backgroundColor = pageColor;
    document.body.style.backgroundColor = pageColor;
  }, [theme]);

  const running = session.phase === 'fetching' || session.phase === 'analysts' || session.phase === 'editor';
  const submittedTicker = session.ticker;
  const today = new Date();
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];
  const editionNo = String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');

  return (
    <>
      <div className="dispatch-root" data-theme={theme}>
        <HistoryPanel
          expanded={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
          history={history}
          onLoad={loadFromHistory}
          onDelete={deleteFromHistory}
          onClearAll={handleClearHistory}
          onExport={exportHistoryEntry}
        />

        <CredibilityPanel
          expanded={credibilityOpen}
          onToggle={() => setCredibilityOpen(!credibilityOpen)}
          stats={credibilityStats}
          history={history}
          onBackfillNow={backfillDueEntries}
          backfillState={backfillState}
          backfillProgress={backfillProgress}
        />

        <WatchlistPanel
          expanded={watchlistOpen}
          onToggle={() => setWatchlistOpen(!watchlistOpen)}
          watchlist={watchlist}
          onAnalyze={analyzeFromWatchlist}
          onRemove={removeFromWatchlist}
          onHover={(w) => prewarmWatchlistItem(w, alphaKey, { hover: true })}
          scanState={watchScan}
          onScan={scanWatchlist}
        />

        <ComparePanel
          expanded={compareOpen}
          onToggle={() => setCompareOpen(!compareOpen)}
          tabs={tabs}
          history={history}
          onSelectInMain={(ticker) => {
            const t = tabs.find((x) => x.ticker === ticker);
            if (t) switchTab(t.id);
          }}
        />

        {evolutionOpen && session.stockData && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => setEvolutionOpen(false)}>
            <div className="modal-container" style={{ maxWidth: 820 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div>
                  <div className="modal-title">
                    {session.stockData.name} · 演化时间线
                  </div>
                  <div className="modal-subtitle">
                    EVOLUTION · {session.stockData.code}
                  </div>
                </div>
                <button onClick={() => setEvolutionOpen(false)} className="modal-close" aria-label="关闭" title="关闭">✕</button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <EvolutionTimeline
                  history={history}
                  ticker={session.stockData.code}
                  mode="modal"
                  onLoadEntry={(id) => { loadFromHistory(id); setEvolutionOpen(false); }}
                />
              </div>
            </div>
          </div>
        )}

        <SettingsPanel
          expanded={settingsOpen}
          onToggle={() => setSettingsOpen(!settingsOpen)}
          models={models}
          apiKeys={apiKeys}
          onKeyChange={(id, v) => setApiKeys((prev) => ({ ...prev, [id]: v }))}
          alphaKey={alphaKey}
          onAlphaChange={setAlphaKey}
          finnhubKey={finnhubKey}
          onFinnhubChange={setFinnhubKey}
          assignments={assignments}
          onAssignmentChange={(aid, mid) => setAssignments((prev) => ({ ...prev, [aid]: mid }))}
          modelVariants={modelVariants}
          onVariantChange={(modelId, variantId) => {
            setModelVariants((prev) => ({ ...prev, [modelId]: variantId }));
            if (session.stockData && Object.keys(session.analyses).length > 0) {
              const m = models.find((mm) => mm.id === modelId);
              if (m) showToast(`${m.name} 已切换变体，下次召集议会生效`);
            }
          }}
          onAddCustomModel={addCustomModel}
          onRemoveModel={removeModel}
          saveStatus={saveStatus}
          onClearStorage={handleClearStorage}
          personaSignalsEnabled={personaSignalsEnabled}
          onPersonaSignalsToggle={setPersonaSignalsEnabled}
          modelHealth={modelHealth}
          modelHealthRunning={modelHealthRunning}
          onTestModels={testModelHealth}
        />

        <div className="dispatch-content" style={{ maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}>
          <div className="edition-strip">
            <div className="edition-meta">
              <span className="edition-year">MMXXVI</span>
              <span className="edition-sep">·</span>
              <span className="edition-weekday">{weekday}</span>
              <span className="edition-sep">·</span>
              <span className="edition-no">{editionNo}</span>
            </div>
            <div className="edition-tagline">独立刊行 · 不构成投资建议</div>
            <ActionButtons
              theme={theme}
              onToggleTheme={toggleTheme}
              watchlistCount={watchlist.length}
              onOpenWatchlist={() => setWatchlistOpen(true)}
              tabsCount={tabs.length}
              onOpenCompare={() => setCompareOpen(true)}
              compareDisabled={tabs.length === 0 && history.length === 0}
              historyCount={history.length}
              onOpenHistory={() => setHistoryOpen(true)}
              hasOverdue={history.some((e) => backfillStatus(e) === 'overdue')}
              onOpenCredibility={() => setCredibilityOpen(true)}
              hasAnyConfig={hasAnyConfig}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>

          <header className="gazette-masthead text-center">
            <h1 className="masthead-title">AI议会</h1>
            <div className="masthead-deck mono">
              四种投资框架，一份可追溯的研究裁决
            </div>
          </header>

          <section className="subject-panel">
            <div className="subject-panel__index mono" aria-hidden="true">01</div>
            <div className="flex flex-col md:flex-row items-stretch md:items-end gap-5">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="subject-kicker small-caps mono">
                  <span className="subject-kicker__en">TODAY'S SUBJECT OF INQUIRY</span>
                  <span className="subject-kicker__sep" aria-hidden="true">·</span>
                  <span className="subject-kicker__cn">本 期 问 询 主 题</span>
                </div>
                <input
                  ref={tickerInputRef}
                  className="input-field display-serif"
                  type="text"
                  placeholder="输入：600519 / 贵州茅台 / AAPL / NVDA ..."
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  onKeyDown={(e) => {
                    // 中文输入法组合中按 Enter 是在确认候选词，不应触发提交
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSubmit();
                  }}
                  disabled={running}
                  aria-label="股票代码或名称"
                />
              </div>
              <button
                className="btn-primary small-caps"
                onClick={handleSubmit}
                disabled={running || !tickerInput.trim()}
                aria-busy={running}
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                {running ? (() => {
                  const done = ANALYSTS.filter((a) => session.analyses[a.id]?.status === 'done').length;
                  return (
                    <>
                      <span style={{ position: 'relative', zIndex: 2 }}>
                        议程进行中… {done}/{ANALYSTS.length}
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${(done / ANALYSTS.length) * 100}%`,
                          background: 'rgba(139, 45, 31, 0.55)',
                          transition: 'width 0.4s ease',
                          zIndex: 1,
                        }}
                      />
                    </>
                  );
                })() : '召集议会 →'}
              </button>
            </div>
            <div className="subject-panel__hint body-serif">
              <span>支持 A 股代码 (600519) / A 股名称 (贵州茅台) / 美股代码 (AAPL)。</span>
              <span className="subject-panel__flow"> 系统将先抓取实时行情，再让四位作者分别撰稿。</span>
              <span>按 <span className="mono" style={{ border: '1px solid var(--ink-faded)', padding: '0 5px', fontSize: '0.72rem' }}>/</span> 可随时聚焦此输入框。</span>
            </div>
            {session.stockError && (
              <div className="stock-error-banner" role="alert">
                <span>{session.stockError}</span>
                {session.stockError.includes('配置') && (
                  <button type="button" onClick={() => setSettingsOpen(true)}>
                    立即配置 <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
            )}
          </section>

          {tabs.length > 0 && (
            <div className="symbol-tabs">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={`symbol-tab ${activeTabId === tab.id ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="symbol-tab__select"
                    aria-pressed={activeTabId === tab.id}
                    onClick={() => switchTab(tab.id)}
                  >
                    {tab.stockData?.name || tab.ticker}
                  </button>
                  <button
                    type="button"
                    className="symbol-tab-close"
                    aria-label={`关闭 ${tab.stockData?.name || tab.ticker}`}
                    onClick={() => closeTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {session.stockData && <TickerTape stockData={session.stockData} />}

          {session.stockData && Object.keys(session.dataHealth).length > 0 && (
            <DataGapPanel dataHealth={session.dataHealth} compact />
          )}

          {submittedTicker && session.stockData && Object.keys(session.taskConsole).length > 0 && (
            <TaskConsole
              tasks={session.taskConsole}
              running={running}
              onStop={actions.stop}
              onRetryFailed={actions.retryFailedTasks}
            />
          )}

          {session.stockData && (session.eventsData || session.consensusData) && (
            <EventsBadge eventsData={session.eventsData} consensusData={session.consensusData} />
          )}

          {submittedTicker && session.stockData && (
            <div className="text-center fade-up" style={{ margin: '32px 0' }}>
              <div className="small-caps mono" style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginBottom: '8px', letterSpacing: '0.25em' }}>
                本 期 焦 点 · TODAY'S SUBJECT
              </div>
              <h2 className="display-serif ink-bleed" style={{ fontSize: 'clamp(2.2rem, 5.5vw, 3.8rem)', fontWeight: 900, lineHeight: 1, color: 'var(--accent)', letterSpacing: '0.01em' }}>
                {session.stockData.name}
              </h2>
              <div className="mono" style={{ fontSize: '0.95rem', color: 'var(--ink-soft)', marginTop: '8px', letterSpacing: '0.12em' }}>
                {session.stockData.code} · {session.stockData.market === 'A' ? 'A 股' : 'NASDAQ/NYSE'}
              </div>
              <div className="body-serif" style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: '6px' }}>
                四位专栏作者 · 四个模型 · 同步撰稿
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
                <button
                  onClick={toggleWatchlist}
                  className={`subject-action-btn ${isInWatchlist(session.stockData.code) ? 'subject-action-btn--active' : 'subject-action-btn--accent'}`}
                  title={isInWatchlist(session.stockData.code) ? '从自选股移除' : '加入自选股'}
                >
                  {isInWatchlist(session.stockData.code) ? '已收藏' : '加入自选'}
                </button>
                <button
                  onClick={handlePrint}
                  className="subject-action-btn"
                  title="导出为 PDF（浏览器打印 → 选择保存为 PDF）"
                >
                  ⎙ 导出 PDF
                </button>
              </div>

              {(() => {
                const priorCount = history.filter((h) => h.ticker === session.stockData.code || h.stockData?.code === session.stockData.code).length;
                if (priorCount < 2) return null;
                return (
                  <div style={{ marginTop: 14 }}>
                    <button className="evo-trigger" onClick={() => setEvolutionOpen(true)} title="查看本股票历次议会的演化">
                      ◷ 此股已分析 {priorCount} 次 · 查看演化时间线
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {submittedTicker && session.stockData && session.financialsData && (
            <FinancialsBadge financialsData={session.financialsData} />
          )}
          {submittedTicker && session.stockData && session.newsData && (
            <NewsBadge newsData={session.newsData} />
          )}
          {submittedTicker && session.stockData && session.themeRotationData && !session.themeRotationData.skipped && (
            <ThemeRotationPanel snapshot={session.themeRotationData} />
          )}

          {submittedTicker && session.stockData && (
            <section className="news-grid">
              {ANALYSTS.map((a) => {
                const model = models.find((m) => m.id === assignments[a.id]);
                return (
                  <div key={a.id} className="news-cell">
                    <AnalystColumn
                      analyst={a}
                      model={model}
                      state={session.analyses[a.id]}
                      klineData={session.klineData}
                      klineLoading={session.klineLoading}
                      onRetry={() => actions.retryAnalyst(a.id)}
                      onRetryWithModel={(newId) => actions.retryAnalystWithModel(a.id, newId)}
                      availableModels={models.filter((m) => apiKeys[m.id]?.trim())}
                      grade={session.editorState?.data?.grades?.[a.cnName]}
                      klineRange={session.klineRange}
                      onKlineRangeChange={actions.changeKlineRange}
                      mentionDict={mentionDict}
                      currentCode={session.stockData?.code}
                      onSummonStock={handleSummonStock}
                    />
                  </div>
                );
              })}
            </section>
          )}

          {submittedTicker && session.stockData && (
            <DataGapPanel analyses={session.analyses} editorState={session.editorState} />
          )}

          {session.editorState && (() => {
            const doneAnalysts = ANALYSTS.filter((a) => session.analyses[a.id]?.status === 'done').map((a) => a.cnName);
            const failedAnalysts = ANALYSTS.filter((a) => session.analyses[a.id]?.status === 'error').map((a) => a.cnName);
            const progress = { done: doneAnalysts.length + failedAnalysts.length, total: ANALYSTS.length, doneAnalysts, failedAnalysts };
            return (
              <EditorSection
                state={session.editorState}
                model={models.find((m) => m.id === assignments.editor)}
                voteStats={consensus}
                onRetry={session.editorState.status === 'error' ? actions.retryEditor : null}
                analystProgress={progress}
                mentionDict={mentionDict}
                currentCode={session.stockData?.code}
                onSummonStock={handleSummonStock}
              />
            );
          })()}

          {submittedTicker && session.stockData && (
            <QVMRPanel
              stockData={session.stockData}
              klineData={session.klineData}
              financialsData={session.financialsData}
              editorState={session.editorState}
            />
          )}

          {submittedTicker && session.stockData && (
            <InvestmentMemoSection
              stockData={session.stockData}
              memo={currentInvestmentMemo}
              draft={investmentMemoDraft}
              onSave={saveCurrentInvestmentMemo}
              onReset={(draft) => saveCurrentInvestmentMemo(draft)}
              onExport={exportCurrentInvestmentMemo}
            />
          )}

          {session.editorState?.status === 'done' &&
            Array.isArray(session.editorState.data?.dissent_areas) &&
            (() => {
              const dissents = session.editorState.data.dissent_areas;
              const consumed = (session.secondRound?.topics || []).length;
              const remaining = dissents.length - consumed;
              const hasAnyDissent = dissents.length > 0;
              const allConsumed = consumed >= dissents.length;
              const disabled = !hasAnyDissent || allConsumed || session.secondRoundRunning;
              let label;
              if (!hasAnyDissent) label = '本期无明显分歧可追问';
              else if (allConsumed) label = '所有分歧已追问完毕';
              else if (session.secondRoundRunning) label = '议会二审中…';
              else if (consumed === 0) label = '▶ 追问主要分歧';
              else label = `▶ 追问下一个分歧（剩 ${remaining} 个）`;
              return (
                <>
                  <button
                    className="second-round-trigger"
                    onClick={actions.runSecondRound}
                    disabled={disabled}
                    title={!hasAnyDissent ? '本期没有 dissent_areas' : allConsumed ? '已无可追问的分歧' : '让对立两派各写 100-150 字反驳，主编再综合'}
                  >
                    {label}
                  </button>
                  {!disabled && <div className="second-round-trigger-note">约 3 次模型调用 · 不烧首轮的 token</div>}
                </>
              );
            })()}

          {session.secondRound && <SecondRoundSection secondRound={session.secondRound} />}

          {session.editorState?.status === 'done' && session.stockData && (
            <FreeAskSection
              analysts={ANALYSTS}
              analyses={session.analyses}
              threads={session.freeAskThreads}
              onSubmit={actions.runFreeAsk}
              isRunning={session.freeAskRunning}
            />
          )}

          {!submittedTicker && (
            <div className="council-ready body-serif fade-up">
              <div className="council-ready__intro">
                <div className="council-ready__eyebrow mono">COUNCIL CHAMBER · 议事厅</div>
                <div className="council-ready__title display-serif">
                  {hasAnyConfig ? '议 会 已 就 席' : '议 会 尚 待 召 集'}
                </div>
                <div className="council-ready__copy">
                  {hasAnyConfig
                    ? '输入股票代码或名称。四位分析师将并行研究，主编随后给出综合裁决。'
                    : '先完成模型配置，再输入股票代码或名称。整场研究会保留观点分歧与数据缺口。'}
                </div>
                {!hasAnyConfig && (
                  <button className="council-ready__setup mono" onClick={() => setSettingsOpen(true)}>
                    打开编辑部配置 <span aria-hidden="true">→</span>
                  </button>
                )}
              </div>
              <div className="council-desks">
                {ANALYSTS.map((a, index) => {
                  const model = models.find((m) => m.id === assignments[a.id]);
                  const hasKey = model && apiKeys[model.id];
                  return (
                    <div
                      key={a.id}
                      className={`council-desk ${hasKey ? 'council-desk--ready' : ''}`}
                      style={{ '--desk-delay': `${index * 80}ms` }}
                    >
                      <div className="council-desk__topline mono">
                        <span>DESK 0{index + 1}</span>
                        <span>{hasKey ? 'READY' : 'STANDBY'}</span>
                      </div>
                      <div className="council-desk__monogram display-serif">{a.monogram}</div>
                      <div className="council-desk__name display-serif">{a.cnName}</div>
                      <div className="council-desk__model mono">
                        {model ? model.name : '未分配模型'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <footer className="text-center" style={{ marginTop: '60px', paddingTop: '24px', borderTop: '4px double var(--ink)' }}>
            <div className="display-serif" style={{ fontSize: '1rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--ink-soft)', marginBottom: '10px' }}>
              AI议会
            </div>
            <div className="body-serif" style={{ fontSize: '0.76rem', color: 'var(--ink-faded)', maxWidth: '680px', margin: '0 auto', lineHeight: 1.6 }}>
              ※ 本刊所有专栏内容由 AI 模型生成，仅作研究演示与多视角思考练习之用，不构成任何投资建议或财务咨询。
              市场有风险，投资需谨慎；过往表现不代表未来收益。
              读者应根据自身情况独立决策，必要时咨询持牌专业人士。
            </div>
          </footer>
        </div>

        {confirmDialog}

        {toast && (
          <div role="status" aria-live="polite" style={STY_TOAST}>▸ {toast}</div>
        )}
      </div>
    </>
  );
}
