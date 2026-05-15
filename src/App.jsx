import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import {
  storageAvailable,
  loadConfig, saveConfig, clearStoredConfig,
  loadHistory, saveHistory, clearStoredHistory,
  loadWatchlist, saveWatchlist,
  loadTabIndex, saveTabIndex,
  loadEvents, appendEvent, clearEvents,
  HISTORY_MAX, WATCHLIST_MAX, TABS_MAX,
} from './lib/storage';
import {
  parseAnalystResponse,
  parseEditorResponse,
  cleanTickerInput,
} from './lib/parser';
import {
  ANALYSTS,
  buildSystemPrompt,
  buildUserPrompt,
  buildEditorSystemPrompt,
  buildEditorUserPrompt,
} from './lib/prompts';
import {
  resolveStock, resolveKline, resolveKlineByCode,
  fetchBenchmarkSpot, fetchPriceAtDate, fetchBenchmarkAtDate, BENCHMARK,
  speculateMarketCode,
} from './api/stocks';
import { DEFAULT_MODELS, resolveVariant, callModel } from './api/models';
import {
  scoreEntry, scoreVerdict, aggregateScores,
  isDueForBackfill, backfillStatus, daysUntilBackfill,
  TRACK_WINDOW_DAYS,
} from './lib/scoring';

// ── Refactored extracts ─────────────────────────────────────────────
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

/* ──────────────────────────────────────────────────────────────────
   MAIN APP
   ────────────────────────────────────────────────────────────────── */

const ANALYST_FAST_TIMEOUT_MS = 14000;
const TECH_KLINE_WAIT_MS = 3500;

function softTimeout(promise, ms, fallbackValue = null) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms)),
  ]);
}

function analystTimeoutMs(modelId) {
  if (modelId === 'gemini') return 12000;
  return ANALYST_FAST_TIMEOUT_MS;
}

export default function App() {
  // 自定义确认弹窗 (替代 native confirm)
  const [confirm, confirmDialog] = useConfirm();

  const [models, setModels] = useState(DEFAULT_MODELS);
  const [apiKeys, setApiKeys] = useState({});
  const [alphaKey, setAlphaKey] = useState('');
  const [assignments, setAssignments] = useState({
    value: 'deepseek',
    tech: 'grok',
    macro: 'gemini',
    risk: 'minimax',
    editor: 'zhipu',
  });
  // 每个模型当前选中的具体变体（型号），如 deepseek -> 'deepseek-chat'
  const [modelVariants, setModelVariants] = useState({});

  const [tickerInput, setTickerInput] = useState('');
  const [submittedTicker, setSubmittedTicker] = useState('');
  const [stockData, setStockData] = useState(null);
  const [stockError, setStockError] = useState('');
  const [analyses, setAnalyses] = useState({});
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [credibilityOpen, setCredibilityOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // 回填状态：null | 'running' | 'idle'
  const [backfillState, setBackfillState] = useState('idle');
  const [backfillProgress, setBackfillProgress] = useState(null); // { current, total } 或 null
  const backfillTimerRef = useRef(null);

  // K 线 + 主编状态
  const [klineData, setKlineData] = useState(null);
  const [klineLoading, setKlineLoading] = useState(false);
  const [klineError, setKlineError] = useState('');
  const [editorState, setEditorState] = useState(null); // null | { status, data, error }
  const [klineRange, setKlineRange] = useState(90); // 30 / 90 / 180 / 365

  // 一行 toast 提示（顶部短暂显示）
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);
  const showToast = (msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3500);
  };

  // 多标的对比 tabs（每条 tab 持有当时的全部状态快照）
  const [tabs, setTabs] = useState([]); // [{ id, ticker, stockData, klineData, analyses, editorState }]
  const [activeTabId, setActiveTabId] = useState(null);

  // 历史记录 + 自选股 + 主题
  const [history, setHistory] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [theme, setTheme] = useState('light'); // light | dark

  // 持久化相关状态
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const saveTimerRef = useRef(null);
  const analysesRef = useRef({});
  const editorRunRef = useRef(0);

  // 防 race：每次 submit 一个递增 id，过期请求被忽略
  const submitSeqRef = useRef(0);

  // 挂载时从 storage 读取配置
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadConfig();
      if (cancelled) return;
      if (stored && typeof stored === 'object') {
        if (stored.apiKeys && typeof stored.apiKeys === 'object') {
          setApiKeys(stored.apiKeys);
        }
        if (typeof stored.alphaKey === 'string') {
          setAlphaKey(stored.alphaKey);
        }
        if (Array.isArray(stored.models) && stored.models.length > 0) {
          // 合并：保留默认模型，再追加自定义模型（避免默认模型被旧版结构覆盖）
          const customs = stored.models.filter((m) => m.custom);
          const defaultIds = new Set(DEFAULT_MODELS.map((m) => m.id));
          const customsClean = customs.filter((m) => !defaultIds.has(m.id));
          setModels([...DEFAULT_MODELS, ...customsClean]);
        }
        if (stored.assignments && typeof stored.assignments === 'object') {
          setAssignments((prev) => ({ ...prev, ...stored.assignments }));
        }
        if (stored.modelVariants && typeof stored.modelVariants === 'object') {
          setModelVariants(stored.modelVariants);
        }
        if (stored.theme === 'dark' || stored.theme === 'light') {
          setTheme(stored.theme);
        }
      }
      setConfigLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    analysesRef.current = analyses;
  }, [analyses]);

  // 挂载时加载历史记录 + 自选股 + 从轻量 tab 索引重建 tabs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, wl, tabIdx] = await Promise.all([loadHistory(), loadWatchlist(), loadTabIndex()]);
      if (cancelled) return;
      setHistory(list);
      setWatchlist(wl);

      // 从 history 找完整数据回填 tabs（按 ticker 匹配最新一条）
      if (Array.isArray(tabIdx) && tabIdx.length > 0) {
        const restoredTabs = [];
        for (const idx of tabIdx) {
          const matched = list.find((h) => h.ticker === idx.ticker);
          if (matched) {
            restoredTabs.push({
              id: idx.id || matched.ticker,
              ticker: matched.ticker,
              stockData: matched.stockData,
              klineData: matched.klineData,
              analyses: matched.analyses,
              editorState: matched.editorState,
            });
          }
        }
        if (restoredTabs.length > 0) {
          setTabs(restoredTabs);
          // 不自动激活 — 让用户主动选；保持页面初始干净
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 配置变化时防抖保存（仅在初始加载完成后）
  useEffect(() => {
    if (!configLoaded) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      const ok = await saveConfig({
        version: 2,
        apiKeys,
        alphaKey,
        models: models.filter((m) => m.custom),
        assignments,
        modelVariants,
        theme,
      });
      setSaveStatus(ok ? 'saved' : 'error');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1800);
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [apiKeys, alphaKey, models, assignments, modelVariants, theme, configLoaded]);

  // 清除所有已存储凭据
  const handleClearStorage = async () => {
    const ok = await confirm('确定清除所有已存储的 API 凭据和自定义模型吗？此操作不可撤销。', { danger: true, title: '清除凭据' });
    if (!ok) return;
    await clearStoredConfig();
    setApiKeys({});
    setAlphaKey('');
    setModels(DEFAULT_MODELS);
    setAssignments({
      value: 'deepseek',
      tech: 'grok',
      macro: 'gemini',
      risk: 'minimax',
      editor: 'zhipu',
    });
    setSaveStatus('idle');
  };

  const addCustomModel = (model) => {
    setModels((prev) => [...prev, model]);
  };

  const removeModel = (id) => {
    setModels((prev) => prev.filter((m) => m.id !== id));
    setApiKeys((prev) => {
      const n = { ...prev };
      delete n[id];
      return n;
    });
    setAssignments((prev) => {
      const n = { ...prev };
      Object.keys(n).forEach((k) => {
        if (n[k] === id) n[k] = '';
      });
      return n;
    });
  };

  // 跑单个分析师 — 可独立调用（首次 / 重试）
  const runAnalyst = async (analyst, data, klinePromise, options = {}) => {
    const isCurrent = options.isCurrent || (() => true);
    const modelId = assignments[analyst.id];
    const model = models.find((m) => m.id === modelId);
    const key = model ? apiKeys[model.id] : null;
    if (!model || !key) {
      if (isCurrent()) {
        setAnalyses((prev) => {
          const next = { ...prev, [analyst.id]: { status: 'error', error: '未配置模型或 API Key' } };
          analysesRef.current = next;
          return next;
        });
      }
      return { analyst, error: '未配置模型或 API Key' };
    }

    if (isCurrent()) {
      setAnalyses((prev) => {
        const next = { ...prev, [analyst.id]: { status: 'pending' } };
        analysesRef.current = next;
        return next;
      });
    }

    const workPromise = (async () => {
      try {
        let klineForPrompt = null;
        if (analyst.id === 'tech' && klinePromise) {
          klineForPrompt = await softTimeout(klinePromise, TECH_KLINE_WAIT_MS, null);
        }
        const sys = buildSystemPrompt(analyst);
        const usr = buildUserPrompt(data, klineForPrompt, analyst.id);
        const raw = await callModel(model, key, sys, usr, modelVariants[model.id]);
        const parsed = parseAnalystResponse(raw);
        if (!isCurrent()) return { analyst, stale: true };
        setAnalyses((prev) => {
          const next = { ...prev, [analyst.id]: { status: 'done', data: parsed } };
          analysesRef.current = next;
          if (options.autoEditor) setTimeout(() => maybeRunEditor(data, next, isCurrent), 0);
          return next;
        });
        return { analyst, data: parsed };
      } catch (err) {
        if (!isCurrent()) return { analyst, stale: true };
        const nextState = {
          status: 'error',
          error: err.message || '未知错误',
          rawPreview: err.rawPreview || null,
          code: err.code || null,
        };
        setAnalyses((prev) => {
          const next = { ...prev, [analyst.id]: nextState };
          analysesRef.current = next;
          if (options.autoEditor) setTimeout(() => maybeRunEditor(data, next, isCurrent), 0);
          return next;
        });
        return { analyst, error: nextState.error };
      }
    })();

    if (!options.timeoutMs) return workPromise;
    const timeoutResult = await Promise.race([
      workPromise,
      new Promise((resolve) => setTimeout(() => resolve({ analyst, waiting: true }), options.timeoutMs)),
    ]);

    if (timeoutResult.waiting) {
      setAnalyses((prev) => {
        if (!isCurrent()) return prev;
        if (prev[analyst.id]?.status === 'done' || prev[analyst.id]?.status === 'error') return prev;
        const next = { ...prev, [analyst.id]: { status: 'waiting', error: '模型还在后台返回' } };
        analysesRef.current = next;
        return next;
      });
    }
    return timeoutResult;
  };

  // 跑主编 — 可独立调用（首次 / 重试）
  const runEditor = async (data, currentAnalyses, options = {}) => {
    const isCurrent = options.isCurrent || (() => true);
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (!editorModel || !editorKey || !editorKey.trim()) {
      if (isCurrent()) setEditorState(null);
      return null;
    }

    const successful = ANALYSTS
      .filter((a) => currentAnalyses[a.id]?.status === 'done')
      .map((a) => ({ name: a.cnName, data: currentAnalyses[a.id].data }));
    const failed = ANALYSTS
      .filter((a) => currentAnalyses[a.id]?.status === 'error')
      .map((a) => ({ name: a.cnName, error: currentAnalyses[a.id].error }));

    if (successful.length < 2) {
      if (isCurrent()) {
        setEditorState({
          status: 'error',
          error: '完成的专栏不足 2 篇，主编不出札记',
        });
      }
      return null;
    }

    const runId = Date.now();
    editorRunRef.current = runId;
    if (isCurrent()) setEditorState({ status: 'pending' });
    try {
      const eSys = buildEditorSystemPrompt();
      const eUsr = buildEditorUserPrompt(data, [...successful, ...failed]);
      const eRaw = await callModel(editorModel, editorKey, eSys, eUsr, modelVariants[editorModel.id]);
      const eParsed = parseEditorResponse(eRaw);
      if (isCurrent() && editorRunRef.current === runId) {
        setEditorState({ status: 'done', data: eParsed });
      }
      return eParsed;
    } catch (err) {
      if (isCurrent() && editorRunRef.current === runId) {
        setEditorState({
          status: 'error',
          error: err.message || '未知错误',
          rawPreview: err.rawPreview || null,
          code: err.code || null,
        });
      }
      return null;
    }
  };

  const maybeRunEditor = (data, nextAnalyses, isCurrent = () => true) => {
    if (!isCurrent()) return;
    const doneCount = ANALYSTS.filter((a) => nextAnalyses[a.id]?.status === 'done').length;
    if (doneCount < 2) return;
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (!editorModel || !editorKey || !editorKey.trim()) return;
    runEditor(data, nextAnalyses, { isCurrent });
  };

  // 单篇重试入口
  // K 线时间窗切换 — 只重拉 K 线，不重跑分析师
  const changeKlineRange = async (newDays) => {
    setKlineRange(newDays);
    if (!stockData) return;
    setKlineLoading(true);
    setKlineError('');
    try {
      const kl = await resolveKline(stockData, alphaKey, newDays);
      setKlineData(kl);
    } catch (err) {
      setKlineData(null);
      setKlineError(err.message || '未知错误');
    } finally {
      setKlineLoading(false);
    }
  };

  const retryAnalyst = async (analystId) => {
    if (!stockData || running) return;
    const analyst = ANALYSTS.find((a) => a.id === analystId);
    if (!analyst) return;
    // 技术派需要 K 线，复用已有的 klineData（如果还没有，临时拉一次）
    const klinePromise = klineData != null
      ? Promise.resolve(klineData)
      : resolveKline(stockData, alphaKey, klineRange).catch((err) => {
          setKlineError(err.message || '未知错误');
          return null;
        });
    await runAnalyst(analyst, stockData, klinePromise, {
      timeoutMs: analystTimeoutMs(assignments[analyst.id]),
      autoEditor: true,
    });
  };

  // 主编重试入口
  const retryEditor = async () => {
    if (!stockData || running) return;
    await runEditor(stockData, analyses);
  };

  const handleSubmitWith = async (rawInput) => {
    const ticker = cleanTickerInput(rawInput);
    if (!ticker || running) return;

    // Validate at least one analyst-model has a key
    const ready = ANALYSTS.filter((a) => {
      const m = models.find((x) => x.id === assignments[a.id]);
      return m && apiKeys[m.id] && apiKeys[m.id].trim();
    });
    if (ready.length === 0) {
      setStockError('请先点击右上角 ⚙ 按钮，至少配置一位分析师对应的模型 API Key');
      setSettingsOpen(true);
      return;
    }

    // 申请新 sequence id，旧的请求会被这个 closure 视为过期
    const mySeq = ++submitSeqRef.current;
    const isCurrent = () => submitSeqRef.current === mySeq;

    setSubmittedTicker(ticker);
    setRunning(true);
    setStockData(null);
    setStockError('');
    setAnalyses({});
    analysesRef.current = {};
    setKlineData(null);
    setKlineError('');
    setEditorState(null);

    // ── 投机式提前启动 ──
    // 输入是 6 位数字（A股）或 US 代码时，我们已经能推断 market+code，不必等 resolveStock 完成。
    // 立刻并行发起 K 线和基准请求（命中缓存则 0 延迟）。
    const spec = speculateMarketCode(ticker);
    setKlineLoading(true);
    const klinePromise = spec
      ? resolveKlineByCode(spec.market, spec.code, alphaKey, klineRange)
          .then((kl) => { if (isCurrent()) { setKlineData(kl); setKlineError(''); } return kl; })
          .catch((err) => {
            if (isCurrent()) {
              setKlineData(null);
              setKlineError(err.message || '未知错误');
            }
            return null;
          })
          .finally(() => { if (isCurrent()) setKlineLoading(false); })
      : null;   // 名称输入：等 resolveStock 拿到代码再启动 K 线

    const baselinePromise = spec
      ? fetchBenchmarkSpot(spec.market, alphaKey).catch((e) => {
          console.warn('基准指数获取失败，本次不参与准确率统计:', e.message);
          return null;
        })
      : null;

    // Step 1: 拉行情（如缓存命中则 0 延迟）
    let data;
    try {
      data = await resolveStock(ticker, alphaKey);
      if (!isCurrent()) return;
      setStockData(data);
    } catch (e) {
      if (!isCurrent()) return;
      setStockError(`行情数据获取失败：${e.message}`);
      setKlineLoading(false);
      setRunning(false);
      return;
    }

    // 如果之前未能投机（输入是中文名等），现在补发 K 线 + 基准
    const actualKlinePromise = klinePromise || (() => {
      setKlineLoading(true);
      return resolveKline(data, alphaKey, klineRange)
        .then((kl) => { if (isCurrent()) { setKlineData(kl); setKlineError(''); } return kl; })
        .catch((err) => {
          if (isCurrent()) {
            setKlineData(null);
            setKlineError(err.message || '未知错误');
          }
          return null;
        })
        .finally(() => { if (isCurrent()) setKlineLoading(false); });
    })();

    const actualBaselinePromise = baselinePromise || fetchBenchmarkSpot(data.market, alphaKey).catch((e) => {
      console.warn('基准指数获取失败，本次不参与准确率统计:', e.message);
      return null;
    });

    // Step 2: 4 位分析师并行（不阻塞 K 线/基准的拉取，K 线只是技术派会用）
    const jobs = ANALYSTS.map((analyst) => {
      const modelId = assignments[analyst.id];
      return runAnalyst(analyst, data, actualKlinePromise, {
        timeoutMs: analystTimeoutMs(modelId),
        autoEditor: true,
        isCurrent,
      });
    });
    const results = await Promise.allSettled(jobs);

    // 基准应该早就拉好了（除非美股 Alpha Vantage 慢）；不阻塞太久
    const baseline = await actualBaselinePromise;

    // Step 4: 主编综评
    // 从 results 重组当前 analyses 快照（避免直接读 state，state 更新可能还未生效）
    const currentAnalyses = {};
    results.forEach((r, i) => {
      const a = ANALYSTS[i];
      if (r.status === 'fulfilled' && r.value?.data) {
        currentAnalyses[a.id] = { status: 'done', data: r.value.data };
      } else if (r.status === 'fulfilled' && r.value?.waiting) {
        currentAnalyses[a.id] = { status: 'waiting', error: '模型还在后台返回' };
      } else if (r.status === 'fulfilled' && r.value?.error) {
        currentAnalyses[a.id] = { status: 'error', error: r.value.error };
      } else {
        currentAnalyses[a.id] = { status: 'error', error: '未知错误' };
      }
    });

    let editorParsed = null;
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    const readyForEditor = Object.values(currentAnalyses).filter((x) => x?.status === 'done').length >= 2;
    if (readyForEditor && editorModel && editorKey && editorKey.trim()) {
      editorParsed = await runEditor(data, currentAnalyses, { isCurrent });
    }
    if (!isCurrent()) return;

    // Step 5: 写入历史记录
    const historyEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ticker,
      stockData: data,
      klineData: null, // K 线可能还在加载，不存以免数据不完整；回看时不显示 K 线即可
      analyses: currentAnalyses,
      editorState: editorParsed ? { status: 'done', data: editorParsed } : null,
      assignments: { ...assignments },
      modelLabels: ANALYSTS.reduce((acc, a) => {
        const m = models.find((x) => x.id === assignments[a.id]);
        const variant = m ? resolveVariant(m, modelVariants[m.id]) : null;
        acc[a.id] = m ? `${m.name} · ${variant?.label || ''}` : '';
        return acc;
      }, {}),
      // ── 准确率追踪相关 ──
      priceAt0: typeof data.price === 'number' ? data.price : null,
      marketBaseline: baseline,           // { market, code, name, price } 或 null
      outcome: null,                       // 30 天后回填：{ status, t30, priceAt30, marketAt30, ... }
      outcomeAttempts: [],                 // 回填尝试历史
    };
    // K 线如果已经拉到，再补存
    actualKlinePromise.then((kl) => {
      if (kl) historyEntry.klineData = kl;
    });

    if (!isCurrent()) return;
    const newHistory = [historyEntry, ...history].slice(0, HISTORY_MAX);
    setHistory(newHistory);
    saveHistory(newHistory);

    // 把这次结果存为一个 tab（同 ticker 会覆盖）
    const klFinal = await actualKlinePromise;
    if (!isCurrent()) return;
    persistCurrentToTab(ticker, data, klFinal, currentAnalyses, editorParsed ? { status: 'done', data: editorParsed } : null);

    // Telemetry
    appendEvent({ type: 'analysis_done', ticker, market: data.market, hasEditor: !!editorParsed });

    setRunning(false);
  };

  // 兼容老调用：handleSubmit 用当前 input
  const handleSubmit = () => handleSubmitWith(tickerInput);

  // 从历史记录加载某次分析
  const loadFromHistory = (entryId) => {
    const entry = history.find((h) => h.id === entryId);
    if (!entry) return;
    setSubmittedTicker(entry.ticker);
    setStockData(entry.stockData);
    setKlineData(entry.klineData);
    setKlineError('');
    setKlineLoading(false);
    setAnalyses(entry.analyses);
    analysesRef.current = entry.analyses || {};
    setEditorState(entry.editorState);
    setStockError('');
    setHistoryOpen(false);
    // 滚动到顶
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

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

  /* ──────────────────────────────────────────────────────────────
     回填到期条目的 outcome（T+30 后的股票收盘价 + 基准收盘价）
     - 触发：挂载时 + 每 4 小时一次（前台 timer）
     - 手动：信用度面板里的"立即回填"按钮
     ────────────────────────────────────────────────────────────── */
  const backfillSingleEntry = async (entry) => {
    if (!entry || !entry.timestamp) throw new Error('条目缺少时间戳');
    if (!entry.priceAt0 || typeof entry.priceAt0 !== 'number') {
      throw new Error('缺少初始价格 priceAt0');
    }
    if (!entry.marketBaseline || typeof entry.marketBaseline.price !== 'number') {
      throw new Error('缺少基准指数初始值');
    }
    const targetDateMs = entry.timestamp + TRACK_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const market = entry.stockData?.market || 'A';
    const code = entry.stockData?.market === 'A'
      ? (entry.stockData?.secid || entry.stockData?.code)
      : entry.stockData?.code;
    if (!code) throw new Error('条目缺少股票代码');

    // 并行拉股票 + 基准的 T+30 收盘价
    const [stockPx, benchPx] = await Promise.all([
      fetchPriceAtDate(market, code, alphaKey, targetDateMs, 60),
      fetchBenchmarkAtDate(market, alphaKey, targetDateMs, 60),
    ]);

    const stockReturnPct = ((stockPx.close - entry.priceAt0) / entry.priceAt0) * 100;
    const marketReturnPct =
      ((benchPx.close - entry.marketBaseline.price) / entry.marketBaseline.price) * 100;
    const excessReturnPct = stockReturnPct - marketReturnPct;

    return {
      status: 'done',
      t30: Date.now(),
      stockDate: stockPx.date,
      priceAt30: stockPx.close,
      marketDate: benchPx.date,
      marketAt30: benchPx.close,
      stockReturnPct: Number(stockReturnPct.toFixed(2)),
      marketReturnPct: Number(marketReturnPct.toFixed(2)),
      excessReturnPct: Number(excessReturnPct.toFixed(2)),
    };
  };

  // 扫一遍 history 找到期条目，逐个回填（最多每次 6 条，避免 API 配额一次烧光）
  const backfillDueEntries = useCallback(async (opts = {}) => {
    const { maxPerRun = 6, force = false } = opts;
    if (backfillState === 'running') return { ran: 0, ok: 0, failed: 0, skipped: 'already running' };

    const due = history.filter((e) => force || isDueForBackfill(e));
    if (due.length === 0) {
      setBackfillProgress(null);
      return { ran: 0, ok: 0, failed: 0 };
    }

    setBackfillState('running');
    const batch = due.slice(0, maxPerRun);
    setBackfillProgress({ current: 0, total: batch.length });

    let updated = [...history];
    let ok = 0;
    let failed = 0;

    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i];
      const idx = updated.findIndex((h) => h.id === entry.id);
      if (idx === -1) continue;

      try {
        const outcome = await backfillSingleEntry(entry);
        updated[idx] = {
          ...entry,
          outcome,
          outcomeAttempts: [...(entry.outcomeAttempts || []), { at: Date.now(), ok: true }],
        };
        ok += 1;
      } catch (err) {
        updated[idx] = {
          ...entry,
          outcomeAttempts: [
            ...(entry.outcomeAttempts || []),
            { at: Date.now(), ok: false, error: err.message },
          ],
        };
        failed += 1;
      }
      setBackfillProgress({ current: i + 1, total: batch.length });
      // 美股 Alpha Vantage 每条耗 2 次配额，连续打可能撞频控——加 800ms 间隔
      if (entry.stockData?.market === 'US' && i < batch.length - 1) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }

    setHistory(updated);
    await saveHistory(updated);
    setBackfillState('idle');
    setBackfillProgress(null);
    appendEvent({ type: 'backfill_run', ran: batch.length, ok, failed });
    return { ran: batch.length, ok, failed, remaining: due.length - batch.length };
  }, [history, alphaKey, backfillState]);

  // 挂载时立即检查一次 + 每 4 小时一次
  useEffect(() => {
    if (history.length === 0) return;
    const tick = () => { backfillDueEntries({ maxPerRun: 6 }).catch(() => {}); };
    // 启动后延迟 5 秒首次执行，避免和首屏渲染抢资源
    const initial = setTimeout(tick, 5000);
    backfillTimerRef.current = setInterval(tick, 4 * 60 * 60 * 1000);
    return () => {
      clearTimeout(initial);
      if (backfillTimerRef.current) clearInterval(backfillTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length > 0]);

  /* ──────────────────────────────────────────────────────────────
     聚合统计 — 供 CredibilityPanel 使用
     ────────────────────────────────────────────────────────────── */
  const credibilityStats = useMemo(() => aggregateScores(history), [history]);

  // ── 自选股操作 ──
  const isInWatchlist = (code) => watchlist.some((w) => w.code === code);
  const toggleWatchlist = () => {
    if (!stockData) return;
    const code = stockData.code;
    let newList;
    if (isInWatchlist(code)) {
      newList = watchlist.filter((w) => w.code !== code);
    } else {
      newList = [
        { code, name: stockData.name, market: stockData.market, addedAt: Date.now() },
        ...watchlist,
      ].slice(0, WATCHLIST_MAX);
    }
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
    setTickerInput(item.code);
    setWatchlistOpen(false);
    // 用 setTimeout 让 input 先更新再触发提交
    setTimeout(() => {
      setTickerInput(item.code); // 双保险
      // 直接调用，不依赖 input value
      handleSubmitWith(item.code);
    }, 60);
  };

  // 把当前 5 个 state 保存为新 tab 或更新现有 tab
  const persistCurrentToTab = (ticker, data, kl, ana, ed) => {
    const tabId = ticker;
    const tabRecord = {
      id: tabId,
      ticker,
      stockData: data,
      klineData: kl,
      analyses: ana,
      editorState: ed,
    };
    setTabs((prev) => {
      const existing = prev.findIndex((t) => t.id === tabId);
      let next;
      if (existing >= 0) {
        next = [...prev];
        next[existing] = tabRecord;
      } else {
        next = [...prev, tabRecord];
      }
      // 持久化轻量索引：仅 ticker（不存完整数据，避免 quota 爆）
      saveTabIndex(next.map((t) => ({ id: t.id, ticker: t.ticker })));
      return next;
    });
    setActiveTabId(tabId);
  };

  // 切换到某个 tab：把那个 tab 的快照 swap 到 5 个显示 state
  const switchTab = (tabId) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    setActiveTabId(tabId);
    setSubmittedTicker(tab.ticker);
    setStockData(tab.stockData);
    setKlineData(tab.klineData);
    setKlineError('');
    setKlineLoading(false);
    setAnalyses(tab.analyses);
    analysesRef.current = tab.analyses || {};
    setEditorState(tab.editorState);
    setStockError('');
  };

  const closeTab = (tabId) => {
    const newTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(newTabs);
    saveTabIndex(newTabs.map((t) => ({ id: t.id, ticker: t.ticker })));
    if (activeTabId === tabId) {
      if (newTabs.length > 0) {
        switchTab(newTabs[newTabs.length - 1].id);
      } else {
        setActiveTabId(null);
        setSubmittedTicker('');
        setStockData(null);
        setKlineData(null);
        setKlineError('');
        setAnalyses({});
        analysesRef.current = {};
        setEditorState(null);
      }
    }
  };

  // 主题切换
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // PDF 导出（用浏览器原生 print）
  const handlePrint = () => {
    window.print();
  };

  const consensus = useMemo(() => {
    const done = Object.values(analyses)
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
  }, [analyses]);

  // 至少有一位分析师配齐了模型 + key，才算"可用"
  const hasAnyConfig = useMemo(() => {
    return ANALYSTS.some((a) => {
      const m = models.find((x) => x.id === assignments[a.id]);
      return m && apiKeys[m.id] && apiKeys[m.id].trim();
    });
  }, [models, apiKeys, assignments]);

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][today.getDay()];
  const editionNo =
    String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');

  return (
    <>
      <div className="dispatch-root" data-theme={theme}>
        {/* History panel modal */}
        <HistoryPanel
          expanded={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
          history={history}
          onLoad={loadFromHistory}
          onDelete={deleteFromHistory}
          onClearAll={handleClearHistory}
        />

        {/* Credibility panel modal */}
        <CredibilityPanel
          expanded={credibilityOpen}
          onToggle={() => setCredibilityOpen(!credibilityOpen)}
          stats={credibilityStats}
          history={history}
          onBackfillNow={backfillDueEntries}
          backfillState={backfillState}
          backfillProgress={backfillProgress}
        />

        {/* Watchlist panel modal */}
        <WatchlistPanel
          expanded={watchlistOpen}
          onToggle={() => setWatchlistOpen(!watchlistOpen)}
          watchlist={watchlist}
          onAnalyze={analyzeFromWatchlist}
          onRemove={removeFromWatchlist}
        />

        {/* Compare panel modal */}
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

        {/* Modal panel — renders only when open */}
        <SettingsPanel
          expanded={settingsOpen}
          onToggle={() => setSettingsOpen(!settingsOpen)}
          models={models}
          apiKeys={apiKeys}
          onKeyChange={(id, v) => setApiKeys((prev) => ({ ...prev, [id]: v }))}
          alphaKey={alphaKey}
          onAlphaChange={setAlphaKey}
          assignments={assignments}
          onAssignmentChange={(aid, mid) =>
            setAssignments((prev) => ({ ...prev, [aid]: mid }))
          }
          modelVariants={modelVariants}
          onVariantChange={(modelId, variantId) => {
            setModelVariants((prev) => ({ ...prev, [modelId]: variantId }));
            // 如果当前已有结果显示，提示用户切换下次生效
            if (stockData && Object.keys(analyses).length > 0) {
              const m = models.find((mm) => mm.id === modelId);
              if (m) showToast(`${m.name} 已切换变体，下次召集议会生效`);
            }
          }}
          onAddCustomModel={addCustomModel}
          onRemoveModel={removeModel}
          saveStatus={saveStatus}
          onClearStorage={handleClearStorage}
        />

        <div
          className="dispatch-content"
          style={{ maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}
        >
          {/* Top edition strip + action buttons in same row to avoid overlap */}
          <div className="edition-strip">
            <span className="edition-vol">VOL. MMXXVI · NO. {editionNo}</span>
            <span className="edition-tagline">独立刊行 · 不构成投资建议</span>
            <div className="top-actions-inline">
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
          </div>

          {/* Masthead */}
          <header className="text-center" style={{ paddingBottom: '16px', marginBottom: '32px' }}>
            <div className="ornament" style={{ marginBottom: '4px' }}>
              ❦ &nbsp; ✦ &nbsp; ❦ &nbsp; ✦ &nbsp; ❦
            </div>
            <h1
              className="display-serif"
              style={{
                fontSize: 'clamp(2.6rem, 7vw, 5rem)',
                fontWeight: 900,
                lineHeight: 0.95,
                margin: '8px 0 10px',
                letterSpacing: '-0.015em',
              }}
            >
              The Analyst's Dispatch
            </h1>
            <div
              className="display-serif"
              style={{
                fontSize: 'clamp(1rem, 2.2vw, 1.4rem)',
                letterSpacing: '0.42em',
                color: 'var(--ink-soft)',
                marginBottom: '14px',
                fontWeight: 500,
              }}
            >
              分 析 师 公 报
            </div>
            <div
              className="masthead-meta mono small-caps"
              style={{
                fontSize: '0.74rem',
                color: 'var(--ink-soft)',
                borderTop: '4px double var(--ink)',
                borderBottom: '1px solid var(--ink)',
                padding: '8px 0',
              }}
            >
              <span>{dateStr}</span>
              <span>{weekday}特刊</span>
              <span>四模型并行专栏</span>
              <span>定价 · 自由阅读</span>
            </div>
          </header>

          {/* Submission Bar */}
          <section
            style={{
              marginBottom: '32px',
              padding: '28px 32px',
              border: '1.5px solid var(--ink)',
              background: 'rgba(255,255,255,0.18)',
              boxShadow: '6px 6px 0 var(--ink-faded)',
            }}
          >
            <div className="flex flex-col md:flex-row items-stretch md:items-end gap-5">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  className="small-caps mono"
                  style={{
                    fontSize: '0.74rem',
                    letterSpacing: '0.22em',
                    color: 'var(--ink-soft)',
                    marginBottom: '8px',
                  }}
                >
                  ◆ TODAY'S SUBJECT OF INQUIRY · 本 期 问 询 主 题
                </div>
                <input
                  className="input-field display-serif"
                  type="text"
                  placeholder="输入：600519 / 贵州茅台 / AAPL / NVDA ..."
                  value={tickerInput}
                  onChange={(e) => setTickerInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                  disabled={running}
                />
              </div>
              <button
                className="btn-primary small-caps"
                onClick={handleSubmit}
                disabled={running || !tickerInput.trim()}
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                {running ? (
                  <>
                    <span style={{ position: 'relative', zIndex: 2 }}>
                      议程进行中… {(() => {
                        const done = ANALYSTS.filter((a) => analyses[a.id]?.status === 'done').length;
                        return `${done}/${ANALYSTS.length}`;
                      })()}
                    </span>
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: 0, top: 0, bottom: 0,
                        width: `${(ANALYSTS.filter((a) => analyses[a.id]?.status === 'done').length / ANALYSTS.length) * 100}%`,
                        background: 'rgba(139, 45, 31, 0.55)',
                        transition: 'width 0.4s ease',
                        zIndex: 1,
                      }}
                    />
                  </>
                ) : '召集议会 →'}
              </button>
            </div>
            <div
              className="body-serif"
              style={{
                fontSize: '0.78rem',
                color: 'var(--ink-faded)',
                marginTop: '14px',
                lineHeight: 1.55,
              }}
            >
              支持 A 股代码 (600519) / A 股名称 (贵州茅台) / 美股代码 (AAPL)。
              系统将先抓取实时行情，再让四位作者分别撰稿。
            </div>
            {stockError && (
              <div
                className="mono"
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--accent)',
                  marginTop: 12,
                  padding: '8px 12px',
                  border: '1px solid var(--accent)',
                  background: 'rgba(139, 45, 31, 0.06)',
                }}
              >
                ✗ {stockError}
              </div>
            )}
          </section>

          {/* Symbol tabs (multi-ticker compare) */}
          {tabs.length > 0 && (
            <div className="symbol-tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`symbol-tab ${activeTabId === tab.id ? 'active' : ''}`}
                  onClick={() => switchTab(tab.id)}
                >
                  <span>{tab.stockData?.name || tab.ticker}</span>
                  <span
                    className="symbol-tab-close"
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Ticker Tape */}
          {stockData && <TickerTape stockData={stockData} />}

          {/* Subject headline */}
          {submittedTicker && stockData && (
            <div className="text-center fade-up" style={{ margin: '32px 0' }}>
              <div className="ornament" style={{ marginBottom: '8px' }}>━━━ ✦ ━━━</div>
              <div
                className="small-caps mono"
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--ink-soft)',
                  marginBottom: '8px',
                  letterSpacing: '0.25em',
                }}
              >
                本 期 焦 点 · TODAY'S SUBJECT
              </div>
              <h2
                className="display-serif ink-bleed"
                style={{
                  fontSize: 'clamp(2.2rem, 5.5vw, 3.8rem)',
                  fontWeight: 900,
                  lineHeight: 1,
                  color: 'var(--accent)',
                  letterSpacing: '0.01em',
                }}
              >
                {stockData.name}
              </h2>
              <div
                className="mono"
                style={{
                  fontSize: '0.95rem',
                  color: 'var(--ink-soft)',
                  marginTop: '8px',
                  letterSpacing: '0.12em',
                }}
              >
                {stockData.code} · {stockData.market === 'A' ? 'A 股' : 'NASDAQ/NYSE'}
              </div>
              <div
                className="body-serif"
                style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: '6px' }}
              >
                四位专栏作者 · 四个模型 · 同步撰稿
              </div>
              {/* 操作按钮：收藏 + 导出 PDF */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 10,
                  marginTop: 16,
                  flexWrap: 'wrap',
                }}
              >
                <button
                  onClick={toggleWatchlist}
                  style={{
                    background: isInWatchlist(stockData.code) ? 'var(--accent)' : 'transparent',
                    color: isInWatchlist(stockData.code) ? 'var(--paper)' : 'var(--accent)',
                    border: '1px solid var(--accent)',
                    padding: '5px 14px',
                    fontFamily: "'Fraunces', 'Noto Serif SC', serif",
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.18s',
                  }}
                  title={isInWatchlist(stockData.code) ? '从自选股移除' : '加入自选股'}
                >
                  {isInWatchlist(stockData.code) ? '★ 已收藏' : '☆ 加入自选'}
                </button>
                <button
                  onClick={handlePrint}
                  style={{
                    background: 'transparent',
                    color: 'var(--ink-soft)',
                    border: '1px solid var(--ink-soft)',
                    padding: '5px 14px',
                    fontFamily: "'Fraunces', 'Noto Serif SC', serif",
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    transition: 'all 0.18s',
                  }}
                  title="导出为 PDF（浏览器打印 → 选择保存为 PDF）"
                >
                  ⎙ 导出 PDF
                </button>
              </div>
            </div>
          )}

          {/* Analyst Grid */}
          {submittedTicker && stockData && (
            <section className="news-grid">
              {ANALYSTS.map((a) => {
                const model = models.find((m) => m.id === assignments[a.id]);
                return (
                  <div key={a.id} className="news-cell">
                    <AnalystColumn
                      analyst={a}
                      model={model}
                      state={analyses[a.id]}
                      klineData={klineData}
                      klineLoading={klineLoading}
                      klineError={klineError}
                      onRetry={() => retryAnalyst(a.id)}
                      grade={editorState?.data?.grades?.[a.cnName]}
                      klineRange={klineRange}
                      onKlineRangeChange={changeKlineRange}
                    />
                  </div>
                );
              })}
            </section>
          )}

          {/* 数据缺口面板 — 在 4 位中至少 1 位完成时浮现 */}
          {submittedTicker && stockData && (
            <DataGapPanel analyses={analyses} editorState={editorState} />
          )}

          {/* 主编札记 — 配置了主编则显示 EditorSection；否则回退到统计型综合意见 */}
          {editorState && (
            <EditorSection
              state={editorState}
              model={models.find((m) => m.id === assignments.editor)}
              voteStats={consensus}
              onRetry={editorState.status === 'error' ? retryEditor : null}
            />
          )}

          {/* 统计型综合意见 — 仅当未启用主编时作为兜底 */}
          {!editorState && consensus && (
            <section
              className="fade-up"
              style={{
                marginTop: '44px',
                padding: '32px 36px',
                background: 'var(--ink)',
                color: 'var(--paper)',
                boxShadow: '8px 8px 0 var(--accent)',
              }}
            >
              <div
                className="text-center small-caps mono"
                style={{
                  fontSize: '0.78rem',
                  letterSpacing: '0.32em',
                  color: 'var(--paper-dark)',
                  marginBottom: '10px',
                }}
              >
                ◆ EDITORIAL CONSENSUS ◆
              </div>
              <h3
                className="display-serif text-center"
                style={{
                  fontSize: 'clamp(1.8rem, 3.8vw, 2.6rem)',
                  fontWeight: 700,
                  marginBottom: '24px',
                  letterSpacing: '0.03em',
                }}
              >
                编 辑 部 综 合 意 见
              </h3>

              <div
                className="grid grid-cols-1 md:grid-cols-3 gap-8"
                style={{
                  borderTop: '1px solid var(--paper-dark)',
                  borderBottom: '1px solid var(--paper-dark)',
                  padding: '24px 0',
                }}
              >
                <div className="text-center">
                  <div
                    className="small-caps mono"
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.22em',
                      color: 'var(--paper-dark)',
                      marginBottom: '10px',
                    }}
                  >
                    多 空 票 数
                  </div>
                  <div
                    className="display-serif"
                    style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}
                  >
                    <span style={{ color: 'var(--buy-light)' }}>{consensus.buy}</span>
                    <span style={{ color: 'var(--paper-dark)', margin: '0 0.4rem' }}>·</span>
                    <span style={{ color: 'var(--hold-light)' }}>{consensus.hold}</span>
                    <span style={{ color: 'var(--paper-dark)', margin: '0 0.4rem' }}>·</span>
                    <span style={{ color: 'var(--sell-light)' }}>{consensus.sell}</span>
                  </div>
                  <div
                    className="mono small-caps"
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--paper-dark)',
                      marginTop: '6px',
                      letterSpacing: '0.18em',
                    }}
                  >
                    BUY · HOLD · SELL
                  </div>
                </div>

                <div className="text-center">
                  <div
                    className="small-caps mono"
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.22em',
                      color: 'var(--paper-dark)',
                      marginBottom: '10px',
                    }}
                  >
                    平 均 信 心
                  </div>
                  <div
                    className="display-serif"
                    style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1 }}
                  >
                    {consensus.avgConviction.toFixed(1)}
                    <span style={{ fontSize: '1.05rem', color: 'var(--paper-dark)' }}> / 5.0</span>
                  </div>
                  <div className="mono" style={{ fontSize: '1.05rem', color: '#E8C97A', marginTop: '4px' }}>
                    {'★'.repeat(Math.round(consensus.avgConviction))}
                    {'☆'.repeat(5 - Math.round(consensus.avgConviction))}
                  </div>
                </div>

                <div className="text-center">
                  <div
                    className="small-caps mono"
                    style={{
                      fontSize: '0.7rem',
                      letterSpacing: '0.22em',
                      color: 'var(--paper-dark)',
                      marginBottom: '10px',
                    }}
                  >
                    主 流 叙 事
                  </div>
                  <div
                    className="display-serif"
                    style={{ fontSize: '1.3rem', lineHeight: 1.3, fontWeight: 600 }}
                  >
                    "{consensus.mood}"
                  </div>
                </div>
              </div>

              <div
                className="text-center body-serif"
                style={{
                  fontSize: '0.76rem',
                  color: 'var(--paper-dark)',
                  marginTop: '20px',
                  lineHeight: 1.55,
                }}
              >
                ※ 本意见为各模型投票统计，并非编辑部立场。投资有风险，决策需独立。
              </div>
            </section>
          )}

          {/* Idle hint */}
          {!submittedTicker && (
            <div
              className="text-center body-serif fade-up"
              style={{ padding: '32px 20px 32px', color: 'var(--ink-faded)' }}
            >
              <div className="ornament" style={{ marginBottom: '24px' }}>❦ &nbsp; ❦ &nbsp; ❦</div>
              <div
                className="display-serif"
                style={{
                  fontSize: '1.5rem',
                  marginBottom: '14px',
                  fontWeight: 600,
                  color: 'var(--ink-soft)',
                }}
              >
                议 会 尚 待 召 集
              </div>
              <div style={{ fontSize: '0.92rem', maxWidth: '500px', margin: '0 auto', lineHeight: 1.65 }}>
                请先点击右上角 <span className="display-serif" style={{ fontWeight: 700 }}>⚙</span> 配置至少一个模型的 API Key，<br />
                然后输入股票代码或名称（A 股、美股皆可）。
              </div>

              {/* Analyst preview cards */}
              <div
                className="grid grid-cols-2 md:grid-cols-4 gap-4"
                style={{ maxWidth: '900px', margin: '40px auto 0' }}
              >
                {ANALYSTS.map((a) => {
                  const model = models.find((m) => m.id === assignments[a.id]);
                  const hasKey = model && apiKeys[model.id];
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: '14px 12px',
                        border: '1px solid var(--ink-faded)',
                        background: 'rgba(255,255,255,0.18)',
                      }}
                    >
                      <div
                        className="display-serif"
                        style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--ink-soft)' }}
                      >
                        {a.monogram}
                      </div>
                      <div
                        className="display-serif"
                        style={{
                          fontSize: '1.1rem',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          marginTop: '2px',
                        }}
                      >
                        {a.cnName}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: '0.7rem',
                          color: hasKey ? 'var(--buy)' : 'var(--ink-faded)',
                          marginTop: '6px',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {model ? `▸ ${model.name}` : '— 未分配 —'}{' '}
                        {hasKey ? '✓' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          <footer
            className="text-center"
            style={{ marginTop: '60px', paddingTop: '24px', borderTop: '4px double var(--ink)' }}
          >
            <div className="ornament" style={{ marginBottom: '12px' }}>✦ &nbsp; ✦ &nbsp; ✦</div>
            <div
              className="small-caps mono"
              style={{
                fontSize: '0.72rem',
                letterSpacing: '0.22em',
                color: 'var(--ink-soft)',
                marginBottom: '10px',
              }}
            >
              THE ANALYST'S DISPATCH · DEMO EDITION v2
            </div>
            <div
              className="body-serif"
              style={{
                fontSize: '0.76rem',
                color: 'var(--ink-faded)',
                maxWidth: '680px',
                margin: '0 auto',
                lineHeight: 1.6,
              }}
            >
              ※ 本刊所有专栏内容由 AI 模型生成，仅作研究演示与多视角思考练习之用，不构成任何投资建议或财务咨询。
              市场有风险，投资需谨慎；过往表现不代表未来收益。
              读者应根据自身情况独立决策，必要时咨询持牌专业人士。
            </div>
          </footer>
        </div>
        {/* 全局确认弹窗 */}
        {confirmDialog}
        {/* 顶部 toast */}
        {toast && (
          <div role="status" aria-live="polite" style={STY_TOAST}>
            ▸ {toast}
          </div>
        )}
      </div>
    </>
  );
}
