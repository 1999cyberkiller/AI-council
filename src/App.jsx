import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';

import {
  storageAvailable,
  loadConfig, saveConfig, clearStoredConfig,
  loadHistory, saveHistory, clearStoredHistory,
  loadWatchlist, saveWatchlist,
  loadInvestmentMemos, saveInvestmentMemos,
  loadTabIndex, saveTabIndex,
  loadEvents, appendEvent, clearEvents,
  HISTORY_MAX, WATCHLIST_MAX, TABS_MAX,
} from './lib/storage';
import {
  parseAnalystResponse,
  parseEditorResponse,
  parseRebuttalResponse,
  parseSecondRoundEditor,
  parseFreeAskResponse,
  parseFreeAskEditor,
  cleanTickerInput,
} from './lib/parser';
import {
  ANALYSTS,
  buildSystemPrompt,
  buildUserPrompt,
  buildEditorSystemPrompt,
  buildEditorUserPrompt,
  buildRebuttalSystemPrompt,
  buildRebuttalUserPrompt,
  buildSecondRoundEditorSystemPrompt,
  buildSecondRoundEditorUserPrompt,
  buildFreeAskSystemPrompt,
  buildFreeAskUserPrompt,
  buildFreeAskEditorSystemPrompt,
  buildFreeAskEditorUserPrompt,
} from './lib/prompts';
import {
  resolveStock, resolveKline, resolveKlineByCode,
  fetchBenchmarkSpot, fetchPriceAtDate, fetchBenchmarkAtDate, BENCHMARK,
  speculateMarketCode,
} from './api/stocks';
import { resolveEvents } from './api/events';
import { resolveFinancials, formatFinancialsForPrompt } from './api/financials';
import { resolveConsensus, formatConsensusForPrompt } from './api/consensus';
import { resolveNews, formatNewsForPrompt } from './api/news';
import { DEFAULT_MODELS, resolveVariant, callModel } from './api/models';
import {
  scoreEntry, scoreVerdict, aggregateScores,
  isDueForBackfill, backfillStatus, daysUntilBackfill,
  TRACK_WINDOW_DAYS,
  buildPersonaSignal,
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
import { EventsBadge } from './components/EventsBadge';
import { FinancialsBadge } from './components/FinancialsBadge';
import { NewsBadge } from './components/NewsBadge';
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

const DATA_SOURCE_META = {
  quote: { label: '行情' },
  kline: { label: 'K 线' },
  baseline: { label: '基准' },
  events: { label: '事件' },
  financials: { label: '财务' },
  consensus: { label: '共识' },
  news: { label: '新闻' },
};

const makeDataHealthStart = () => Object.fromEntries(
  Object.entries(DATA_SOURCE_META).map(([id, meta]) => [
    id,
    { ...meta, status: 'pending', detail: '等待返回' },
  ])
);

const errText = (e) => String(e?.message || e || '未知错误').slice(0, 160);
const ANALYST_CALL_TIMEOUT_MS = 28000;
const EDITOR_CALL_TIMEOUT_MS = 35000;

/* ──────────────────────────────────────────────────────────────────
   MAIN APP
   ────────────────────────────────────────────────────────────────── */

export default function App() {
  // 自定义确认弹窗 (替代 native confirm)
  const [confirm, confirmDialog] = useConfirm();

  const [models, setModels] = useState(DEFAULT_MODELS);
  const [apiKeys, setApiKeys] = useState({});
  const [alphaKey, setAlphaKey] = useState('');
  const [finnhubKey, setFinnhubKey] = useState('');
  const [modelHealth, setModelHealth] = useState({});
  const [modelHealthRunning, setModelHealthRunning] = useState(false);
  const [taskConsole, setTaskConsole] = useState({});
  const [assignments, setAssignments] = useState({
    value: 'deepseek',
    tech: 'grok',
    macro: 'gemini',
    risk: 'minimax',
    editor: 'deepseek',
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
  const [eventsData, setEventsData] = useState(null);
  const [financialsData, setFinancialsData] = useState(null);   // V20
  const [consensusData, setConsensusData] = useState(null);     // V20
  const [newsData, setNewsData] = useState(null);               // V21
  const [dataHealth, setDataHealth] = useState({});
  const dataHealthRef = useRef({});
  const [secondRound, setSecondRound] = useState(null); // null | { status, topics:[...] }
  const [secondRoundRunning, setSecondRoundRunning] = useState(false);
  const [freeAskThreads, setFreeAskThreads] = useState([]);    // V19 累积的自由追问
  const [freeAskRunning, setFreeAskRunning] = useState(false);
  const [evolutionOpen, setEvolutionOpen] = useState(false);  // V18 演化时间线模态
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
  const markDataHealth = useCallback((id, patch) => {
    setDataHealth((prev) => {
      const next = {
        ...prev,
        [id]: {
          ...(DATA_SOURCE_META[id] || { label: id }),
          ...(prev[id] || {}),
          ...patch,
        },
      };
      dataHealthRef.current = next;
      return next;
    });
  }, []);
  const markTask = useCallback((id, patch) => {
    setTaskConsole((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        ...patch,
      },
    }));
  }, []);

  const chooseFallbackModel = useCallback((primaryModelId, roleId = null, extraExcludeIds = []) => {
    const excluded = new Set([primaryModelId, ...extraExcludeIds].filter(Boolean));
    const configured = models.filter((m) => apiKeys[m.id]?.trim() && !excluded.has(m.id));
    if (configured.length === 0) return null;
    const healthy = configured.find((m) => modelHealth[m.id]?.status === 'ok');
    if (healthy) return healthy;
    const preferred = ['deepseek', 'zhipu', 'grok', 'gemini', 'minimax'];
    const roleFallback = roleId && assignments[roleId] && !excluded.has(assignments[roleId])
      ? configured.find((m) => m.id === assignments[roleId])
      : null;
    if (roleFallback) return roleFallback;
    return configured.sort((a, b) => preferred.indexOf(a.id) - preferred.indexOf(b.id))[0] || null;
  }, [models, apiKeys, modelHealth, assignments]);

  const callModelTracked = useCallback(async ({
    taskId,
    label,
    roleId,
    model,
    apiKey,
    systemPrompt,
    userPrompt,
    timeoutMs,
    allowFallback = true,
    shouldUpdate = () => true,
  }) => {
    if (!model || !apiKey?.trim()) throw new Error('未配置模型或 API Key');

    const runOnce = async (targetModel, fallbackFrom = null) => {
      const variant = resolveVariant(targetModel, modelVariants[targetModel.id]);
      const controller = new AbortController();
      activeControllersRef.current.add(controller);
      const started = performance.now();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (shouldUpdate()) markTask(taskId, {
        label,
        roleId,
        status: 'pending',
        modelId: targetModel.id,
        modelName: targetModel.name,
        variant: variant?.label || variant?.id || '',
        fallbackFrom,
        error: '',
      });
      try {
        const raw = await callModel(
          targetModel,
          apiKeys[targetModel.id] || apiKey,
          systemPrompt,
          userPrompt,
          modelVariants[targetModel.id],
          controller.signal
        );
        clearTimeout(timer);
        activeControllersRef.current.delete(controller);
        const ms = Math.round(performance.now() - started);
        if (shouldUpdate()) markTask(taskId, {
          status: fallbackFrom ? 'warning' : 'ok',
          ms,
          error: '',
        });
        return raw;
      } catch (e) {
        clearTimeout(timer);
        activeControllersRef.current.delete(controller);
        const ms = Math.round(performance.now() - started);
        const message = e?.name === 'AbortError' ? `${Math.round(timeoutMs / 1000)} 秒超时` : errText(e);
        if (shouldUpdate()) markTask(taskId, {
          status: 'error',
          ms,
          error: message,
        });
        throw new Error(message);
      }
    };

    const primaryHealth = modelHealth[model.id]?.status;
    const initialModel = allowFallback && primaryHealth === 'error'
      ? chooseFallbackModel(model.id, roleId)
      : null;
    const attemptedIds = new Set([model.id]);
    if (initialModel) attemptedIds.add(initialModel.id);

    try {
      if (initialModel) {
        return await runOnce(initialModel, model.name);
      }
      return await runOnce(model);
    } catch (firstError) {
      if (!allowFallback) throw firstError;
      const fallback = chooseFallbackModel(model.id, roleId, Array.from(attemptedIds));
      if (!fallback) throw firstError;
      return runOnce(fallback, model.name);
    }
  }, [apiKeys, modelVariants, modelHealth, markTask, chooseFallbackModel]);

  // 多标的对比 tabs（每条 tab 持有当时的全部状态快照）
  const [tabs, setTabs] = useState([]); // [{ id, ticker, stockData, klineData, analyses, editorState }]
  const [activeTabId, setActiveTabId] = useState(null);

  // 历史记录 + 自选股 + 主题
  const [history, setHistory] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [investmentMemos, setInvestmentMemos] = useState({});
  const [watchScan, setWatchScan] = useState({ running: false, done: 0, total: 0, items: {}, lastRunAt: null });
  const [theme, setTheme] = useState('light'); // light | dark
  const [personaSignalsEnabled, setPersonaSignalsEnabled] = useState(true);

  // 持久化相关状态
  const [configLoaded, setConfigLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const saveTimerRef = useRef(null);

  // 防 race：每次 submit 一个递增 id，过期请求被忽略
  const submitSeqRef = useRef(0);
  const activeControllersRef = useRef(new Set());

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
        if (typeof stored.finnhubKey === 'string') {
          setFinnhubKey(stored.finnhubKey);
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
        if (typeof stored.personaSignalsEnabled === 'boolean') {
          setPersonaSignalsEnabled(stored.personaSignalsEnabled);
        }
      }
      setConfigLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // 挂载时加载历史记录 + 自选股 + 投资备忘录 + 从轻量 tab 索引重建 tabs
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, wl, tabIdx, memos] = await Promise.all([
        loadHistory(),
        loadWatchlist(),
        loadTabIndex(),
        loadInvestmentMemos(),
      ]);
      if (cancelled) return;
      setHistory(list);
      setWatchlist(wl);
      setInvestmentMemos(memos);

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
              secondRound: matched.secondRound || null,
              eventsData: matched.eventsData || null,
              financialsData: matched.financialsData || null,
              consensusData: matched.consensusData || null,
              newsData: matched.newsData || null,
              dataHealth: matched.dataHealth || {},
              freeAskThreads: matched.freeAskThreads || [],
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

  // ── 自动预热自选股（页面加载完 + watchlist 变化时）──
  // 延迟 2 秒，避免和首屏渲染抢资源
  useEffect(() => {
    if (!configLoaded) return;
    if (!watchlist || watchlist.length === 0) return;
    const timer = setTimeout(() => {
      prewarmWatchlistBatch(watchlist, alphaKey);
      prewarmBenchmarks(watchlist, alphaKey);
    }, 2000);
    return () => clearTimeout(timer);
  }, [configLoaded, watchlist, alphaKey]);

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
        finnhubKey,
        models: models.filter((m) => m.custom),
        assignments,
        modelVariants,
        theme,
        personaSignalsEnabled,
      });
      setSaveStatus(ok ? 'saved' : 'error');
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 1800);
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [apiKeys, alphaKey, finnhubKey, models, assignments, modelVariants, theme, personaSignalsEnabled, configLoaded]);

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
      editor: 'deepseek',
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

  // 跑单个分析师 — 可独立调用（首次 / 重试 / 换模型重试）
  const runAnalyst = async (analyst, data, klinePromise, modelOverride = null, promptExtras = null, isCurrent = () => true) => {
    const modelId = modelOverride || assignments[analyst.id];
    const model = models.find((m) => m.id === modelId);
    const key = model ? apiKeys[model.id] : null;
    if (!model || !key) {
      if (isCurrent()) setAnalyses((prev) => ({
        ...prev,
        [analyst.id]: { status: 'error', error: '未配置模型或 API Key' },
      }));
      return { analyst, error: '未配置模型或 API Key' };
    }

    if (isCurrent()) setAnalyses((prev) => ({ ...prev, [analyst.id]: { status: 'pending' } }));

    try {
      let klineForPrompt = null;
      if (analyst.id === 'tech' && klinePromise) {
        klineForPrompt = await klinePromise;
      }
      if (!isCurrent()) return { analyst, error: '本次分析已取消' };
      // 注入分析师过往表现信号（如启用且样本足够）
      const personaSignal = personaSignalsEnabled
        ? buildPersonaSignal(credibilityStats, analyst.id, data.sector || null)
        : null;
      // V20: 如果 promptExtras 缺失（如重试时），从当前 state 重建
      const extras = promptExtras || {
        financialsText: formatFinancialsForPrompt(financialsData),
        consensusText: formatConsensusForPrompt(consensusData),
      };
      const sys = buildSystemPrompt(analyst, personaSignal);
      const usr = buildUserPrompt(data, klineForPrompt, analyst.id, extras);
      const raw = await callModelTracked({
        taskId: `analyst:${analyst.id}`,
        label: analyst.cnName,
        roleId: analyst.id,
        model,
        apiKey: key,
        systemPrompt: sys,
        userPrompt: usr,
        timeoutMs: ANALYST_CALL_TIMEOUT_MS,
        shouldUpdate: isCurrent,
      });
      if (!isCurrent()) return { analyst, error: '本次分析已取消' };
      const parsed = parseAnalystResponse(raw);
      if (isCurrent()) setAnalyses((prev) => ({ ...prev, [analyst.id]: { status: 'done', data: parsed } }));
      return { analyst, data: parsed };
    } catch (err) {
      if (isCurrent()) setAnalyses((prev) => ({
        ...prev,
        [analyst.id]: {
          status: 'error',
          error: err.message || '未知错误',
          rawPreview: err.rawPreview || null,
          code: err.code || null,
        },
      }));
      return { analyst, error: err.message };
    }
  };

  // 跑主编 — 可独立调用（首次 / 重试）
  const runEditor = async (data, currentAnalyses, extrasOverride = null, isCurrent = () => true) => {
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
      if (isCurrent()) setEditorState({
        status: 'error',
        error: '完成的专栏不足 2 篇，主编不出札记',
      });
      return null;
    }

    if (isCurrent()) setEditorState({ status: 'pending' });
    try {
      const eSys = buildEditorSystemPrompt();
      // V20: 注入财务 + 卖方共识
      // V21: 注入近期新闻（主编 only）
      // 优先使用调用方传入的 extrasOverride（来自 newsPromise.then() 的最新值），
      // 否则 fallback 到 React state（如重试主编时）
      const eExtras = extrasOverride || {
        financialsText: formatFinancialsForPrompt(financialsData),
        consensusText: formatConsensusForPrompt(consensusData),
        newsText: formatNewsForPrompt(newsData),
      };
      const eUsr = buildEditorUserPrompt(data, [...successful, ...failed], eExtras);
      const eRaw = await callModelTracked({
        taskId: 'editor',
        label: '主编',
        roleId: 'editor',
        model: editorModel,
        apiKey: editorKey,
        systemPrompt: eSys,
        userPrompt: eUsr,
        timeoutMs: EDITOR_CALL_TIMEOUT_MS,
        shouldUpdate: isCurrent,
      });
      if (!isCurrent()) return null;
      const eParsed = parseEditorResponse(eRaw);
      if (isCurrent()) setEditorState({ status: 'done', data: eParsed });
      return eParsed;
    } catch (err) {
      if (isCurrent()) setEditorState({
        status: 'error',
        error: err.message || '未知错误',
        rawPreview: err.rawPreview || null,
        code: err.code || null,
      });
      return null;
    }
  };

  /* ──────────────────────────────────────────────────────────────
     SECOND ROUND · 用户点"追问主要分歧"按钮后触发
     1. 取 editorState.data.dissent_areas[index]
     2. 从 positions 里找两位对立分析师
     3. 并行调用两位的 callModel（rebuttal）
     4. 调用主编 callModel（second-round editor synthesis）
     5. 把结果 append 到 secondRound.topics
     ────────────────────────────────────────────────────────────── */
  const runSecondRound = async () => {
    if (secondRoundRunning) return;
    if (!stockData || editorState?.status !== 'done') return;
    const dissents = editorState.data?.dissent_areas;
    if (!Array.isArray(dissents) || dissents.length === 0) return;

    // 找下一个未消费的分歧
    const consumedCount = (secondRound?.topics || []).length;
    if (consumedCount >= dissents.length) return;
    const dissent = dissents[consumedCount];
    if (!dissent || !dissent.topic) return;

    // 从 positions 里找两位对立分析师
    const positionEntries = Object.entries(dissent.positions || {});
    if (positionEntries.length < 2) {
      // 没有足够立场可以追问
      return;
    }
    // 取前两位（主编已按重要性排序）
    const [pairA, pairB] = positionEntries.slice(0, 2);
    const [nameA, stanceA] = pairA;
    const [nameB, stanceB] = pairB;

    // CN 名 → analyst object
    const analystA = ANALYSTS.find((a) => a.cnName === nameA);
    const analystB = ANALYSTS.find((a) => a.cnName === nameB);
    if (!analystA || !analystB) {
      console.warn('[secondRound] 无法在 ANALYSTS 中找到', nameA, nameB);
      return;
    }

    // 拿到他们初轮的完整论点（从 analyses 里取）
    const aFirstRound = analyses[analystA.id]?.data;
    const bFirstRound = analyses[analystB.id]?.data;
    if (!aFirstRound || !bFirstRound) {
      console.warn('[secondRound] 初轮数据缺失');
      return;
    }

    setSecondRoundRunning(true);
    pausePrewarm();
    const secondRoundSeq = submitSeqRef.current;
    const isSecondRoundCurrent = () => submitSeqRef.current === secondRoundSeq;

    // 在 secondRound 上 append 一个 pending topic
    const newTopic = {
      topic: dissent.topic,
      rebuttals: [
        { analystName: nameA, status: 'pending' },
        { analystName: nameB, status: 'pending' },
      ],
      editorFinal: null,
    };
    setSecondRound((prev) => ({
      status: 'running',
      topics: [...(prev?.topics || []), newTopic],
    }));
    const topicIdx = consumedCount; // 我们刚 push 的 topic 在末尾

    // 给一个工具函数原子地更新某个 topic
    const updateTopic = (mut) => {
      if (!isSecondRoundCurrent()) return;
      setSecondRound((prev) => {
        if (!prev || !prev.topics) return prev;
        const next = { ...prev, topics: [...prev.topics] };
        next.topics[topicIdx] = mut(next.topics[topicIdx]);
        return next;
      });
    };

    // 跑单个分析师的反驳
    const runRebut = async (analyst, ownStance, opponent, opponentFirstRound) => {
      const model = models.find((m) => m.id === assignments[analyst.id]);
      const key = model ? apiKeys[model.id] : null;
      if (!model || !key || !key.trim()) {
        return { status: 'error', error: '未配置 API key' };
      }
      try {
        const sys = buildRebuttalSystemPrompt(analyst);
        const usr = buildRebuttalUserPrompt(stockData, dissent.topic, ownStance, {
          name: opponent.cnName,
          stance: opponentFirstRound.headline,
          headline: opponentFirstRound.headline,
          key_points: opponentFirstRound.key_points,
          risk: opponentFirstRound.risk,
        });
        const raw = await callModelTracked({
          taskId: `second:${topicIdx}:${analyst.id}`,
          label: `二审 · ${analyst.cnName}`,
          roleId: analyst.id,
          model,
          apiKey: key,
          systemPrompt: sys,
          userPrompt: usr,
          timeoutMs: ANALYST_CALL_TIMEOUT_MS,
          shouldUpdate: isSecondRoundCurrent,
        });
        if (!isSecondRoundCurrent()) return { status: 'error', error: '本次追问已取消' };
        const parsed = parseRebuttalResponse(raw);
        return { status: 'done', data: parsed };
      } catch (err) {
        return { status: 'error', error: err.message || '未知错误' };
      }
    };

    // 并行跑两位反驳
    const [resA, resB] = await Promise.allSettled([
      runRebut(analystA, stanceA, analystB, bFirstRound),
      runRebut(analystB, stanceB, analystA, aFirstRound),
    ]);
    const rebutAResult = resA.status === 'fulfilled' ? resA.value : { status: 'error', error: String(resA.reason) };
    const rebutBResult = resB.status === 'fulfilled' ? resB.value : { status: 'error', error: String(resB.reason) };

    updateTopic((t) => ({
      ...t,
      rebuttals: [
        { analystName: nameA, ...rebutAResult },
        { analystName: nameB, ...rebutBResult },
      ],
      editorFinal: { status: 'pending' },
    }));

    // 主编综合
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (!editorModel || !editorKey || !editorKey.trim()) {
      updateTopic((t) => ({ ...t, editorFinal: { status: 'error', error: '主编未配置 API key' } }));
      if (isSecondRoundCurrent()) {
        setSecondRoundRunning(false);
        resumePrewarm();
      }
      return;
    }

    try {
      const eSys = buildSecondRoundEditorSystemPrompt();
      const eUsr = buildSecondRoundEditorUserPrompt(
        stockData,
        editorState.data,
        dissent.topic,
        [
          { analystName: nameA, ...rebutAResult },
          { analystName: nameB, ...rebutBResult },
        ]
      );
      const eRaw = await callModelTracked({
        taskId: `second:${topicIdx}:editor`,
        label: '二审 · 主编',
        roleId: 'editor',
        model: editorModel,
        apiKey: editorKey,
        systemPrompt: eSys,
        userPrompt: eUsr,
        timeoutMs: EDITOR_CALL_TIMEOUT_MS,
        shouldUpdate: isSecondRoundCurrent,
      });
      if (isSecondRoundCurrent()) {
        const eParsed = parseSecondRoundEditor(eRaw);
        updateTopic((t) => ({ ...t, editorFinal: { status: 'done', data: eParsed } }));
      }
    } catch (err) {
      updateTopic((t) => ({
        ...t,
        editorFinal: { status: 'error', error: err.message || '未知错误' },
      }));
    }

    if (isSecondRoundCurrent()) {
      setSecondRoundRunning(false);
      resumePrewarm();

      // Telemetry
      appendEvent({
        type: 'second_round_done',
        ticker: stockData.code,
        topicIdx,
        hasShift: false, // can read from latest state if needed
      });
    }
  };

  /* ──────────────────────────────────────────────────────────────
     FREE ASK · 用户自由追问 V19
     ────────────────────────────────────────────────────────────── */
  const runFreeAsk = async (question, pickedAnalystIds) => {
    if (freeAskRunning) return;
    if (!stockData) return;
    if (!Array.isArray(pickedAnalystIds) || pickedAnalystIds.length === 0) return;
    if (!question || question.trim().length < 4) return;

    setFreeAskRunning(true);
    pausePrewarm();
    const freeAskSeq = submitSeqRef.current;
    const isFreeAskCurrent = () => submitSeqRef.current === freeAskSeq;

    const pickedAnalysts = pickedAnalystIds
      .map((id) => ANALYSTS.find((a) => a.id === id))
      .filter(Boolean);

    // Append pending thread
    const newThread = {
      question,
      picks: pickedAnalystIds,
      answers: pickedAnalysts.map((a) => ({ analystName: a.cnName, analystId: a.id, status: 'pending' })),
      editorFinal: pickedAnalysts.length >= 2 ? { status: 'pending' } : null,
    };
    setFreeAskThreads((prev) => [...prev, newThread]);
    const threadIdx = freeAskThreads.length;

    const updateThread = (mut) => {
      if (!isFreeAskCurrent()) return;
      setFreeAskThreads((prev) => {
        if (!prev[threadIdx]) return prev;
        const next = [...prev];
        next[threadIdx] = mut(next[threadIdx]);
        return next;
      });
    };

    // 单个分析师回答
    const runOne = async (analyst) => {
      const model = models.find((m) => m.id === assignments[analyst.id]);
      const key = model ? apiKeys[model.id] : null;
      if (!model || !key || !key.trim()) {
        return { status: 'error', error: '未配置 API key' };
      }
      try {
        const sys = buildFreeAskSystemPrompt(analyst);
        const usr = buildFreeAskUserPrompt(stockData, question, analyses[analyst.id]?.data);
        const raw = await callModelTracked({
          taskId: `free:${threadIdx}:${analyst.id}`,
          label: `追问 · ${analyst.cnName}`,
          roleId: analyst.id,
          model,
          apiKey: key,
          systemPrompt: sys,
          userPrompt: usr,
          timeoutMs: ANALYST_CALL_TIMEOUT_MS,
          shouldUpdate: isFreeAskCurrent,
        });
        if (!isFreeAskCurrent()) return { status: 'error', error: '本次追问已取消' };
        const parsed = parseFreeAskResponse(raw);
        return { status: 'done', data: parsed };
      } catch (err) {
        return { status: 'error', error: err.message || '未知错误' };
      }
    };

    const results = await Promise.allSettled(pickedAnalysts.map(runOne));
    const answerResults = results.map((r, i) => ({
      analystName: pickedAnalysts[i].cnName,
      analystId: pickedAnalysts[i].id,
      ...(r.status === 'fulfilled' ? r.value : { status: 'error', error: String(r.reason) }),
    }));

    updateThread((t) => ({ ...t, answers: answerResults }));

    // 主编综合（仅当 ≥2 位且至少 2 位 done）
    const doneAnswers = answerResults.filter((a) => a.status === 'done');
    if (doneAnswers.length >= 2) {
      const editorModel = models.find((m) => m.id === assignments.editor);
      const editorKey = editorModel ? apiKeys[editorModel.id] : null;
      if (!editorModel || !editorKey || !editorKey.trim()) {
        updateThread((t) => ({ ...t, editorFinal: { status: 'error', error: '主编未配置' } }));
      } else {
        try {
          const eSys = buildFreeAskEditorSystemPrompt();
          const eUsr = buildFreeAskEditorUserPrompt(stockData, question, doneAnswers);
          const eRaw = await callModelTracked({
            taskId: `free:${threadIdx}:editor`,
            label: '追问 · 主编',
            roleId: 'editor',
            model: editorModel,
            apiKey: editorKey,
            systemPrompt: eSys,
            userPrompt: eUsr,
            timeoutMs: EDITOR_CALL_TIMEOUT_MS,
            shouldUpdate: isFreeAskCurrent,
          });
          if (isFreeAskCurrent()) {
            const eParsed = parseFreeAskEditor(eRaw);
            updateThread((t) => ({ ...t, editorFinal: { status: 'done', data: eParsed } }));
          }
        } catch (err) {
          updateThread((t) => ({ ...t, editorFinal: { status: 'error', error: err.message || '未知错误' } }));
        }
      }
    } else {
      // 只选了 1 位，没有主编综合
      updateThread((t) => ({ ...t, editorFinal: null }));
    }

    if (isFreeAskCurrent()) {
      setFreeAskRunning(false);
      resumePrewarm();
      appendEvent({ type: 'free_ask_done', ticker: stockData.code, picks: pickedAnalystIds });
    }
  };

  // 单篇重试入口
  // K 线时间窗切换 — 只重拉 K 线，不重跑分析师
  const changeKlineRange = async (newDays) => {
    setKlineRange(newDays);
    if (!stockData) return;
    setKlineLoading(true);
    try {
      const kl = await resolveKline(stockData, alphaKey, newDays);
      setKlineData(kl);
    } catch {
      setKlineData(null);
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
      : resolveKline(stockData, alphaKey);
    await runAnalyst(analyst, stockData, klinePromise);
  };

  // V18 换模型重试入口
  const retryAnalystWithModel = async (analystId, newModelId) => {
    if (!stockData || running) return;
    const analyst = ANALYSTS.find((a) => a.id === analystId);
    if (!analyst) return;
    const newModel = models.find((m) => m.id === newModelId);
    if (!newModel || !apiKeys[newModel.id]) {
      console.warn('[retry] 目标模型未配置或无 key');
      return;
    }
    const klinePromise = klineData != null
      ? Promise.resolve(klineData)
      : resolveKline(stockData, alphaKey);
    await runAnalyst(analyst, stockData, klinePromise, newModelId);
  };

  // 主编重试入口
  const retryEditor = async () => {
    if (!stockData || running) return;
    await runEditor(stockData, analyses);
  };

  const stopCurrentAnalysis = () => {
    submitSeqRef.current += 1;
    activeControllersRef.current.forEach((controller) => controller.abort());
    activeControllersRef.current.clear();
    setRunning(false);
    setKlineLoading(false);
    setSecondRoundRunning(false);
    setFreeAskRunning(false);
    setAnalyses((prev) => {
      const next = { ...prev };
      ANALYSTS.forEach((a) => {
        if (!next[a.id] || next[a.id]?.status === 'pending') {
          next[a.id] = { status: 'error', error: '本次分析已停止' };
        }
      });
      return next;
    });
    setEditorState((prev) => (prev?.status === 'pending' ? { status: 'error', error: '本次分析已停止' } : prev));
    setTaskConsole((prev) => Object.fromEntries(
      Object.entries(prev).map(([id, task]) => [
        id,
        task.status === 'pending' ? { ...task, status: 'stopped', error: '用户停止' } : task,
      ])
    ));
    resumePrewarm();
  };

  const retryFailedTasks = async () => {
    if (!stockData || running) return;
    const failedAnalysts = ANALYSTS.filter((a) => analyses[a.id]?.status === 'error');
    if (failedAnalysts.length === 0) {
      if (editorState?.status === 'error') await runEditor(stockData, analyses);
      return;
    }
    const klinePromise = klineData != null
      ? Promise.resolve(klineData)
      : resolveKline(stockData, alphaKey);
    const results = await Promise.allSettled(failedAnalysts.map((a) => runAnalyst(a, stockData, klinePromise)));
    const repaired = { ...analyses };
    results.forEach((r, i) => {
      const analyst = failedAnalysts[i];
      if (r.status === 'fulfilled' && r.value?.data) {
        repaired[analyst.id] = { status: 'done', data: r.value.data };
      } else if (r.status === 'fulfilled' && r.value?.error) {
        repaired[analyst.id] = { status: 'error', error: r.value.error };
      } else {
        repaired[analyst.id] = { status: 'error', error: '重试失败' };
      }
    });
    const successful = ANALYSTS.filter((a) => repaired[a.id]?.status === 'done');
    if (successful.length >= 2) await runEditor(stockData, repaired);
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
    activeControllersRef.current.forEach((controller) => controller.abort());
    activeControllersRef.current.clear();
    setActiveTabId(null);
    setStockData(null);
    setStockError('');
    setAnalyses({});
    setKlineData(null);
    setEditorState(null);
    setEventsData(null);
    setFinancialsData(null);
    setConsensusData(null);
    setNewsData(null);
    const startedDataHealth = makeDataHealthStart();
    dataHealthRef.current = startedDataHealth;
    setDataHealth(startedDataHealth);
    setSecondRound(null);
    setSecondRoundRunning(false);
    setFreeAskThreads([]);
    setFreeAskRunning(false);
    setTaskConsole(Object.fromEntries([
      ...ANALYSTS.map((a) => [`analyst:${a.id}`, {
        label: a.cnName,
        roleId: a.id,
        status: 'pending',
        modelName: models.find((m) => m.id === assignments[a.id])?.name || '未配置',
        variant: resolveVariant(
          models.find((m) => m.id === assignments[a.id]) || {},
          modelVariants[assignments[a.id]]
        )?.label || '',
      }]),
      ['editor', {
        label: '主编',
        roleId: 'editor',
        status: 'idle',
        modelName: models.find((m) => m.id === assignments.editor)?.name || '未配置',
        variant: resolveVariant(
          models.find((m) => m.id === assignments.editor) || {},
          modelVariants[assignments.editor]
        )?.label || '',
      }],
    ]));

    // 暂停预热，避免和议会请求抢 API 配额
    pausePrewarm();

    // ── 投机式提前启动 ──
    // 输入是 6 位数字（A股）或 US 代码时，我们已经能推断 market+code，不必等 resolveStock 完成。
    // 立刻并行发起 K 线和基准请求（命中缓存则 0 延迟）。
    const spec = speculateMarketCode(ticker);
    setKlineLoading(true);
    const klinePromise = spec
      ? resolveKlineByCode(spec.market, spec.code, alphaKey, klineRange)
          .then((kl) => {
            if (isCurrent()) {
              setKlineData(kl);
              markDataHealth('kline', kl?.length
                ? { status: 'ok', detail: 'K 线已返回', count: kl.length, source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
                : { status: 'error', detail: 'K 线返回为空或接口失败', source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
            }
            return kl;
          })
          .catch((e) => {
            if (isCurrent()) {
              setKlineData(null);
              markDataHealth('kline', { status: 'error', detail: errText(e), source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
            }
            return null;
          })
          .finally(() => { if (isCurrent()) setKlineLoading(false); })
      : null;   // 名称输入：等 resolveStock 拿到代码再启动 K 线

    const baselinePromise = spec
      ? fetchBenchmarkSpot(spec.market, alphaKey)
        .then((b) => {
          if (isCurrent()) {
            markDataHealth('baseline', b
              ? { status: 'ok', detail: `${b.name || '基准'} 可用`, source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
              : { status: 'empty', detail: '基准指数暂无返回', source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
          }
          return b;
        })
        .catch((e) => {
          if (isCurrent()) markDataHealth('baseline', { status: 'warning', detail: errText(e), source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
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
      markDataHealth('quote', { status: 'ok', detail: `${data.market === 'A' ? 'A 股' : '美股'}行情可用`, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
    } catch (e) {
      if (!isCurrent()) return;
      markDataHealth('quote', { status: 'error', detail: errText(e), source: '行情接口', fetchedAt: Date.now() });
      setStockError(`行情数据获取失败：${e.message}`);
      setRunning(false);
      resumePrewarm();
      return;
    }

    // 后台拉公司事件（财报/分红等），不阻塞议会
    resolveEvents(data, finnhubKey)
      .then((ed) => {
        if (!isCurrent()) return;
        setEventsData(ed);
        if (ed?.hasMissingKey) {
          markDataHealth('events', { status: 'warning', detail: '美股事件需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() });
        } else if (ed?.events?.length) {
          markDataHealth('events', { status: 'ok', detail: '事件日历可用', count: ed.events.length, source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
        } else {
          markDataHealth('events', { status: 'empty', detail: '暂无临近财报或分红事件', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
        }
      })
      .catch((e) => {
        if (isCurrent()) markDataHealth('events', { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
      });

    // V20: 同时启动财务 + 卖方共识拉取 — 会被注入到分析师 prompt
    // 给最多 4 秒时间窗，超时也继续（注入空字符串，模型仍能基于现价 + PE/PB 分析）
    const finPromise = resolveFinancials(data, finnhubKey)
      .then((fd) => {
        if (isCurrent()) {
          setFinancialsData(fd);
          if (fd?.hasMissingKey) {
            markDataHealth('financials', { status: 'warning', detail: '美股财务需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() });
          } else if (fd?.quarters?.length) {
            markDataHealth('financials', { status: 'ok', detail: '季度财务可用', count: fd.quarters.length, source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
          } else {
            markDataHealth('financials', { status: 'empty', detail: '未取得最近季度财务', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
          }
        }
        return fd;
      })
      .catch((e) => {
        if (isCurrent()) markDataHealth('financials', { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
        return null;
      });
    const consPromise = resolveConsensus(data, finnhubKey)
      .then((cd) => {
        if (isCurrent()) {
          setConsensusData(cd);
          if (cd?.hasMissingKey) {
            markDataHealth('consensus', { status: 'warning', detail: '美股共识需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() });
          } else if (cd?.data) {
            markDataHealth('consensus', { status: 'ok', detail: '卖方共识可用', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
          } else {
            markDataHealth('consensus', { status: 'empty', detail: '暂无可用卖方共识', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
          }
        }
        return cd;
      })
      .catch((e) => {
        if (isCurrent()) markDataHealth('consensus', { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() });
        return null;
      });
    // V21: 后台拉新闻（不阻塞分析师；主编那次会等新闻 ready）
    const newsPromise = resolveNews(data, finnhubKey)
      .then((nd) => {
        if (isCurrent()) {
          setNewsData(nd);
          if (nd?.hasMissingKey) {
            markDataHealth('news', { status: 'warning', detail: '美股新闻需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() });
          } else if (nd?.items?.length) {
            markDataHealth('news', { status: 'ok', detail: '近期资讯可用', count: nd.items.length, source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() });
          } else {
            markDataHealth('news', { status: 'empty', detail: '暂无近期资讯', source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() });
          }
        }
        return nd;
      })
      .catch((e) => {
        if (isCurrent()) markDataHealth('news', { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() });
        return null;
      });
    const withTimeout = (promise, ms) => Promise.race([
      promise,
      new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    const promptExtrasPromise = (async () => {
      const [fin, cons] = await Promise.all([
        withTimeout(finPromise, 4000),
        withTimeout(consPromise, 4000),
      ]);
      return {
        financialsData: fin || null,
        consensusData: cons || null,
        financialsText: formatFinancialsForPrompt(fin) || '',
        consensusText: formatConsensusForPrompt(cons) || '',
      };
    })();

    // 如果之前未能投机（输入是中文名等），现在补发 K 线 + 基准
    const actualKlinePromise = klinePromise || (() => {
      setKlineLoading(true);
      return resolveKline(data, alphaKey, klineRange)
        .then((kl) => {
          if (isCurrent()) {
            setKlineData(kl);
            markDataHealth('kline', kl?.length
              ? { status: 'ok', detail: 'K 线已返回', count: kl.length, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
              : { status: 'error', detail: 'K 线返回为空或接口失败', source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
          }
          return kl;
        })
        .catch((e) => {
          if (isCurrent()) {
            setKlineData(null);
            markDataHealth('kline', { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
          }
          return null;
        })
        .finally(() => { if (isCurrent()) setKlineLoading(false); });
    })();

    const actualBaselinePromise = baselinePromise || fetchBenchmarkSpot(data.market, alphaKey)
      .then((b) => {
        if (isCurrent()) {
          markDataHealth('baseline', b
            ? { status: 'ok', detail: `${b.name || '基准'} 可用`, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
            : { status: 'empty', detail: '基准指数暂无返回', source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
        }
        return b;
      })
      .catch((e) => {
        if (isCurrent()) markDataHealth('baseline', { status: 'warning', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() });
        console.warn('基准指数获取失败，本次不参与准确率统计:', e.message);
        return null;
      });

    // V20 等财务/共识 ready 再发分析师（最多 4 秒）
    const promptExtras = await promptExtrasPromise;

    // Step 2: 4 位分析师并行
    const jobs = ANALYSTS.map((analyst) => runAnalyst(analyst, data, actualKlinePromise, null, promptExtras, isCurrent));
    const results = await Promise.allSettled(jobs);
    if (!isCurrent()) return;

    // 基准应该早就拉好了（除非美股 Alpha Vantage 慢）；不阻塞太久
    const baseline = await actualBaselinePromise;
    if (!isCurrent()) return;

    // Step 4: 主编综评
    // 从 results 重组当前 analyses 快照（避免直接读 state，state 更新可能还未生效）
    const currentAnalyses = {};
    results.forEach((r, i) => {
      const a = ANALYSTS[i];
      if (r.status === 'fulfilled' && r.value?.data) {
        currentAnalyses[a.id] = { status: 'done', data: r.value.data };
      } else if (r.status === 'fulfilled' && r.value?.error) {
        currentAnalyses[a.id] = { status: 'error', error: r.value.error };
      } else {
        currentAnalyses[a.id] = { status: 'error', error: '未知错误' };
      }
    });

    let editorParsed = null;
    let editorExtras = {
      financialsData: promptExtras.financialsData,
      consensusData: promptExtras.consensusData,
      newsData: null,
      financialsText: promptExtras.financialsText,
      consensusText: promptExtras.consensusText,
      newsText: '',
    };
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (editorModel && editorKey && editorKey.trim()) {
      // V21: 主编调用前等所有外部数据 ready（最多再等 2 秒）
      // 大概率到这里时分析师已跑 10-30s，外部数据早就 ready
      editorExtras = await (async () => {
        const [fin, cons, news] = await Promise.all([
          withTimeout(finPromise, 2000),
          withTimeout(consPromise, 2000),
          withTimeout(newsPromise, 2000),
        ]);
        return {
          financialsData: fin || promptExtras.financialsData || null,
          consensusData: cons || promptExtras.consensusData || null,
          newsData: news || null,
          financialsText: formatFinancialsForPrompt(fin) || promptExtras.financialsText || '',
          consensusText: formatConsensusForPrompt(cons) || promptExtras.consensusText || '',
          newsText: formatNewsForPrompt(news) || '',
        };
      })();
      editorParsed = await runEditor(data, currentAnalyses, editorExtras, isCurrent);
    }

    // Step 5: 写入历史记录
    const klFinal = await actualKlinePromise;
    if (!isCurrent()) return;

    const historyEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      ticker,
      stockData: data,
      klineData: klFinal,
      analyses: currentAnalyses,
      editorState: editorParsed ? { status: 'done', data: editorParsed } : null,
      eventsData: null,
      financialsData: editorExtras.financialsData,
      consensusData: editorExtras.consensusData,
      newsData: editorExtras.newsData,
      dataHealth: dataHealthRef.current,
      freeAskThreads: [],
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
    const newHistory = [historyEntry, ...history].slice(0, HISTORY_MAX);
    setHistory(newHistory);
    saveHistory(newHistory);

    // 把这次结果存为一个 tab（同 ticker 会覆盖）
    persistCurrentToTab(
      ticker,
      data,
      klFinal,
      currentAnalyses,
      editorParsed ? { status: 'done', data: editorParsed } : null,
      null,
      {
        eventsData: null,
        financialsData: editorExtras.financialsData,
        consensusData: editorExtras.consensusData,
        newsData: editorExtras.newsData,
        freeAskThreads: [],
      }
    );

    // Telemetry
    appendEvent({ type: 'analysis_done', ticker, market: data.market, hasEditor: !!editorParsed });

    setRunning(false);
    resumePrewarm();
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
    setKlineLoading(false);
    setAnalyses(entry.analyses);
    setEditorState(entry.editorState);
    setSecondRound(entry.secondRound || null);
    setEventsData(entry.eventsData || null);
    setFinancialsData(entry.financialsData || null);
    setConsensusData(entry.consensusData || null);
    setNewsData(entry.newsData || null);
    dataHealthRef.current = entry.dataHealth || {};
    setDataHealth(dataHealthRef.current);
    setFreeAskThreads(entry.freeAskThreads || []);
    setFreeAskRunning(false);
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

  const fmtMdDate = (ts) => {
    const d = new Date(ts || Date.now());
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const buildHistoryMarkdown = (entry) => {
    const stock = entry.stockData || {};
    const lines = [];
    lines.push(`# ${stock.name || entry.ticker} AI 议会`);
    lines.push('');
    lines.push(`- 代码：${stock.code || entry.ticker || '—'}`);
    lines.push(`- 市场：${stock.market === 'A' ? 'A 股' : stock.market === 'US' ? '美股' : '—'}`);
    lines.push(`- 归档时间：${fmtMdDate(entry.timestamp)}`);
    if (typeof stock.price === 'number') lines.push(`- 分析时价格：${stock.price}`);
    lines.push('');

    const editor = entry.editorState?.data;
    if (editor) {
      lines.push('## 主编札记');
      lines.push('');
      lines.push(`- 最终建议：${editor.verdict || '—'}`);
      lines.push(`- 信心：${editor.conviction || '—'} / 5`);
      if (editor.headline) lines.push(`- 标题：${editor.headline}`);
      if (editor.key_sentence) lines.push(`- 核心句：${editor.key_sentence}`);
      if (editor.watchpoint) lines.push(`- 观察点：${editor.watchpoint}`);
      lines.push('');
    }

    const memo = investmentMemos[stock.code || entry.ticker];
    if (memo) {
      lines.push('## 投资备忘录');
      lines.push('');
      lines.push(`- 下次复盘：${memo.nextReview || '—'}`);
      lines.push('');
      lines.push('核心判断：');
      lines.push(memo.thesis || '—');
      lines.push('');
      lines.push('买入理由：');
      lines.push(memo.bullCase || '—');
      lines.push('');
      lines.push('反方理由：');
      lines.push(memo.bearCase || '—');
      lines.push('');
      lines.push('关键催化：');
      lines.push(memo.catalysts || '—');
      lines.push('');
      lines.push('失效条件：');
      lines.push(memo.invalidation || '—');
      lines.push('');
    }

    lines.push('## 四位分析师');
    lines.push('');
    ANALYSTS.forEach((a) => {
      const st = entry.analyses?.[a.id];
      lines.push(`### ${a.cnName}`);
      lines.push('');
      if (st?.status !== 'done') {
        lines.push(`未完成：${st?.error || '无结果'}`);
        lines.push('');
        return;
      }
      const d = st.data;
      lines.push(`- 建议：${d.verdict || '—'}`);
      lines.push(`- 信心：${d.conviction || '—'} / 5`);
      if (d.headline) lines.push(`- 标题：${d.headline}`);
      lines.push('');
      if (d.analysis) {
        lines.push(d.analysis);
        lines.push('');
      }
      if (Array.isArray(d.key_points) && d.key_points.length > 0) {
        lines.push('关键论点：');
        d.key_points.forEach((p) => lines.push(`- ${p}`));
        lines.push('');
      }
      if (d.risk) {
        lines.push(`风险提示：${d.risk}`);
        lines.push('');
      }
    });

    if (entry.dataHealth) {
      lines.push('## 数据源状态');
      lines.push('');
      Object.values(entry.dataHealth).forEach((item) => {
        if (!item?.label) return;
        lines.push(`- ${item.label}：${item.status || '—'} · ${item.source || '—'} · ${item.detail || '—'}`);
      });
      lines.push('');
    }

    lines.push('---');
    lines.push('由 The AI Council Gazette 导出。内容仅供研究，不构成投资建议。');
    return lines.join('\n');
  };

  const downloadTextFile = (filename, text, mime = 'text/markdown;charset=utf-8') => {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportHistoryEntry = (entryId) => {
    const entry = history.find((h) => h.id === entryId);
    if (!entry) return;
    const code = entry.stockData?.code || entry.ticker || 'dispatch';
    downloadTextFile(`${code}-ai-council-gazette.md`, buildHistoryMarkdown(entry));
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
    const code = entry.stockData?.code;
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

  // V19 字典：所有用户已知的股票（watchlist + history）
  const mentionDict = useMemo(
    () => buildMentionDictionary(watchlist, history),
    [watchlist, history]
  );

  // V19 召集议会跳转
  const handleSummonStock = (code) => {
    if (!code || running) return;
    setTickerInput(code);
    handleSubmitWith(code);
  };

  // 当 secondRound 更新时，同步到当前 active tab + 对应的最新 history entry
  useEffect(() => {
    if (!activeTabId || !secondRound) return;
    // 同步 tab
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return prev;
      if (prev[idx].secondRound === secondRound) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], secondRound };
      return next;
    });
    // 同步最新一条相同 ticker 的 history entry（不写持久化，避免每次 setState 都触发 IO）
    setHistory((prev) => {
      const idx = prev.findIndex((e) => e.ticker === activeTabId);
      if (idx === -1) return prev;
      if (prev[idx].secondRound === secondRound) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], secondRound };
      return next;
    });
  }, [secondRound, activeTabId]);

  // 当 secondRound 状态稳定下来（不在 running），把当前 history 写持久化
  useEffect(() => {
    if (secondRoundRunning) return;
    if (!secondRound) return;
    // 防抖：1.5 秒后写入
    const t = setTimeout(() => { saveHistory(history); }, 1500);
    return () => clearTimeout(t);
  }, [secondRoundRunning, secondRound, history]);

  // v19/v20/v21 的会话态跟随当前 tab，避免切换标的后自由追问、财务或新闻串台。
  useEffect(() => {
    if (!activeTabId) return;
    if (submittedTicker !== activeTabId) return;
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === activeTabId);
      if (idx === -1) return prev;
      const current = prev[idx];
      if (
        current.eventsData === eventsData &&
        current.financialsData === financialsData &&
        current.consensusData === consensusData &&
        current.newsData === newsData &&
        current.dataHealth === dataHealth &&
        current.freeAskThreads === freeAskThreads
      ) {
        return prev;
      }
      const next = [...prev];
      next[idx] = {
        ...current,
        eventsData,
        financialsData,
        consensusData,
        newsData,
        dataHealth,
        freeAskThreads,
      };
      return next;
    });
  }, [activeTabId, submittedTicker, eventsData, financialsData, consensusData, newsData, dataHealth, freeAskThreads]);

  // 同步到历史记录，避免刷新后丢失后台补回的事件、财务、新闻和自由追问。
  useEffect(() => {
    if (!activeTabId) return;
    if (submittedTicker !== activeTabId) return;
    const t = setTimeout(() => {
      setHistory((prev) => {
        const idx = prev.findIndex((e) => e.ticker === activeTabId);
        if (idx === -1) return prev;
        const current = prev[idx];
        if (
          current.eventsData === eventsData &&
          current.financialsData === financialsData &&
          current.consensusData === consensusData &&
          current.newsData === newsData &&
          current.dataHealth === dataHealth &&
          current.freeAskThreads === freeAskThreads
        ) {
          return prev;
        }
        const next = [...prev];
        next[idx] = {
          ...current,
          eventsData,
          financialsData,
          consensusData,
          newsData,
          dataHealth,
          freeAskThreads,
        };
        saveHistory(next);
        return next;
      });
    }, 800);
    return () => clearTimeout(t);
  }, [activeTabId, submittedTicker, eventsData, financialsData, consensusData, newsData, dataHealth, freeAskThreads]);

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

  const scanWatchlist = async () => {
    if (watchScan.running || watchlist.length === 0) return;
    const scanItems = [...watchlist];
    pausePrewarm();
    const initialItems = Object.fromEntries(scanItems.map((w) => [
      w.code,
      { status: 'pending', detail: '等待行情' },
    ]));
    const nextItems = { ...initialItems };
    setWatchScan({ running: true, done: 0, total: scanItems.length, items: initialItems, lastRunAt: watchScan.lastRunAt });

    try {
      for (let i = 0; i < scanItems.length; i++) {
        const item = scanItems[i];
        try {
          const data = await resolveStock(item.code, alphaKey);
          const pct = typeof data.changePct === 'number' ? data.changePct : null;
          const absPct = pct == null ? 0 : Math.abs(pct);
          const detail = absPct >= 5
            ? '大幅波动，建议复盘'
            : absPct >= 3
            ? '波动放大'
            : '平稳';
          nextItems[item.code] = {
            status: absPct >= 3 ? 'warning' : 'ok',
            priceText: `${data.market === 'A' ? '¥' : '$'}${typeof data.price === 'number' ? data.price.toFixed(2) : '—'}`,
            changeText: pct == null ? '涨跌 —' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
            detail,
            scannedAt: Date.now(),
          };
        } catch (e) {
          nextItems[item.code] = {
            status: 'error',
            detail: errText(e),
            scannedAt: Date.now(),
          };
        }
        setWatchScan((prev) => ({
          ...prev,
          running: true,
          done: i + 1,
          total: scanItems.length,
          items: { ...nextItems },
        }));
      }
    } finally {
      setWatchScan((prev) => ({
        ...prev,
        running: false,
        total: scanItems.length,
        items: { ...nextItems },
        lastRunAt: Date.now(),
      }));
      resumePrewarm();
    }
  };

  // 把当前 5 个 state 保存为新 tab 或更新现有 tab
  const persistCurrentToTab = (ticker, data, kl, ana, ed, sr = null, extras = {}) => {
    const tabId = ticker;
    const tabRecord = {
      id: tabId,
      ticker,
      stockData: data,
      klineData: kl,
      analyses: ana,
      editorState: ed,
      secondRound: sr,
      eventsData: extras.eventsData ?? eventsData,
      financialsData: extras.financialsData ?? financialsData,
      consensusData: extras.consensusData ?? consensusData,
      newsData: extras.newsData ?? newsData,
      dataHealth: extras.dataHealth ?? dataHealthRef.current,
      freeAskThreads: extras.freeAskThreads ?? freeAskThreads,
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
    setKlineLoading(false);
    setAnalyses(tab.analyses);
    setEditorState(tab.editorState);
    setSecondRound(tab.secondRound || null);
    setEventsData(tab.eventsData || null);
    setFinancialsData(tab.financialsData || null);
    setConsensusData(tab.consensusData || null);
    setNewsData(tab.newsData || null);
    dataHealthRef.current = tab.dataHealth || {};
    setDataHealth(dataHealthRef.current);
    setFreeAskThreads(tab.freeAskThreads || []);
    setFreeAskRunning(false);
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
        setAnalyses({});
        setEditorState(null);
        setSecondRound(null);
        setEventsData(null);
        setFinancialsData(null);
        setConsensusData(null);
        setNewsData(null);
        dataHealthRef.current = {};
        setDataHealth({});
        setFreeAskThreads([]);
        setFreeAskRunning(false);
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

  const investmentMemoDraft = useMemo(
    () => buildInvestmentMemoDraft(stockData, analyses, editorState),
    [stockData, analyses, editorState]
  );
  const currentInvestmentMemo = stockData?.code ? investmentMemos[stockData.code] : null;
  const saveCurrentInvestmentMemo = (memo) => {
    if (!stockData?.code) return;
    const next = {
      ...investmentMemos,
      [stockData.code]: {
        ...memo,
        stockCode: stockData.code,
        stockName: stockData.name,
        updatedAt: Date.now(),
      },
    };
    setInvestmentMemos(next);
    saveInvestmentMemos(next);
    showToast('投资备忘录已保存');
  };
  const resetCurrentInvestmentMemo = (draft) => {
    saveCurrentInvestmentMemo(draft);
  };
  const exportCurrentInvestmentMemo = () => {
    if (!stockData) return;
    const memo = currentInvestmentMemo || investmentMemoDraft;
    downloadTextFile(`${stockData.code || 'stock'}-investment-memo.md`, memoToMarkdown(stockData, memo));
  };

  // 至少有一位分析师配齐了模型 + key，才算"可用"
  const hasAnyConfig = useMemo(() => {
    return ANALYSTS.some((a) => {
      const m = models.find((x) => x.id === assignments[a.id]);
      return m && apiKeys[m.id] && apiKeys[m.id].trim();
    });
  }, [models, apiKeys, assignments]);

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
        ? {
            status: 'pending',
            name: m.name,
            variant: resolveVariant(m, modelVariants[m.id])?.label || '',
            detail: '测试中',
          }
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
          m,
          apiKeys[m.id],
          '你是模型连接测试。只做连通性验证。',
          '请只返回 JSON：{"ok":true}',
          modelVariants[m.id],
          controller.signal
        );
        clearTimeout(timer);
        const ms = Math.round(performance.now() - started);
        setModelHealth((prev) => ({
          ...prev,
          [m.id]: {
            status: 'ok',
            name: m.name,
            variant: variant?.label || variant?.id || '',
            ms,
            detail: String(raw || '').slice(0, 90) || '已返回',
          },
        }));
      } catch (e) {
        clearTimeout(timer);
        const ms = Math.round(performance.now() - started);
        setModelHealth((prev) => ({
          ...prev,
          [m.id]: {
            status: 'error',
            name: m.name,
            variant: variant?.label || variant?.id || '',
            ms,
            detail: e?.name === 'AbortError' ? '15 秒超时' : errText(e),
          },
        }));
      }
    }));

    setModelHealthRunning(false);
  };

  const today = new Date();
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
          onExport={exportHistoryEntry}
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
          onHover={(w) => prewarmWatchlistItem(w, alphaKey, { hover: true })}
          scanState={watchScan}
          onScan={scanWatchlist}
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

        {/* V18 Evolution timeline modal */}
        {evolutionOpen && stockData && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setEvolutionOpen(false)}
          >
            <div
              className="modal-container"
              style={{ maxWidth: 820 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div>
                  <div className="display-serif" style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {stockData.name} · 演化时间线
                  </div>
                  <div
                    className="mono small-caps"
                    style={{ fontSize: '0.66rem', color: 'var(--ink-faded)', marginTop: 4 }}
                  >
                    EVOLUTION · {stockData.code}
                  </div>
                </div>
                <button
                  onClick={() => setEvolutionOpen(false)}
                  className="modal-close"
                  aria-label="关闭"
                  title="关闭"
                >
                  ✕
                </button>
              </div>
              <div className="modal-body" style={{ padding: 0 }}>
                <EvolutionTimeline
                  history={history}
                  ticker={stockData.code}
                  mode="modal"
                  onLoadEntry={(id) => {
                    loadFromHistory(id);
                    setEvolutionOpen(false);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Modal panel — renders only when open */}
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
          personaSignalsEnabled={personaSignalsEnabled}
          onPersonaSignalsToggle={setPersonaSignalsEnabled}
          modelHealth={modelHealth}
          modelHealthRunning={modelHealthRunning}
          onTestModels={testModelHealth}
        />

        <div
          className="dispatch-content"
          style={{ maxWidth: '1320px', margin: '0 auto', padding: '2rem 1.5rem 4rem' }}
        >
          {/* Top edition strip — three-column: meta · tagline · buttons */}
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

          {/* Masthead */}
          <header className="text-center" style={{ paddingBottom: '8px', marginBottom: '32px' }}>
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
              The AI Council Gazette
            </h1>
            <div
              className="display-serif"
              style={{
                fontSize: 'clamp(1rem, 2.2vw, 1.4rem)',
                letterSpacing: '0.36em',
                color: 'var(--ink-soft)',
                fontWeight: 500,
              }}
            >
              A I 议 会
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

          {stockData && Object.keys(dataHealth).length > 0 && (
            <DataGapPanel dataHealth={dataHealth} compact />
          )}

          {submittedTicker && stockData && Object.keys(taskConsole).length > 0 && (
            <TaskConsole
              tasks={taskConsole}
              running={running}
              onStop={stopCurrentAnalysis}
              onRetryFailed={retryFailedTasks}
            />
          )}

          {/* Events + consensus badge — 在 ticker tape 下方 */}
          {stockData && (eventsData || consensusData) && (
            <EventsBadge
              eventsData={eventsData}
              consensusData={consensusData}
              finnhubKeyConfigured={!!finnhubKey}
            />
          )}

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

              {/* V18 演化时间线 trigger — 仅当此股有历史档案 */}
              {(() => {
                const priorCount = history.filter((h) => h.ticker === stockData.code || h.stockData?.code === stockData.code).length;
                if (priorCount < 2) return null;
                return (
                  <div style={{ marginTop: 14 }}>
                    <button
                      className="evo-trigger"
                      onClick={() => setEvolutionOpen(true)}
                      title="查看本股票历次议会的演化"
                    >
                      ◷ 此股已分析 {priorCount} 次 · 查看演化时间线
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {/* V20 财务数据 — 4Q sparkline + 可展开表格 */}
          {submittedTicker && stockData && financialsData && (
            <FinancialsBadge financialsData={financialsData} />
          )}

          {/* V21 近期资讯 — 默认折叠条 */}
          {submittedTicker && stockData && newsData && (
            <NewsBadge newsData={newsData} />
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
                      onRetry={() => retryAnalyst(a.id)}
                      onRetryWithModel={(newId) => retryAnalystWithModel(a.id, newId)}
                      availableModels={models.filter((m) => apiKeys[m.id]?.trim())}
                      grade={editorState?.data?.grades?.[a.cnName]}
                      klineRange={klineRange}
                      onKlineRangeChange={changeKlineRange}
                      mentionDict={mentionDict}
                      currentCode={stockData?.code}
                      onSummonStock={handleSummonStock}
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
          {editorState && (() => {
            // V17 计算分析师进度
            const doneAnalysts = ANALYSTS.filter((a) => analyses[a.id]?.status === 'done').map((a) => a.cnName);
            const failedAnalysts = ANALYSTS.filter((a) => analyses[a.id]?.status === 'error').map((a) => a.cnName);
            const progress = {
              done: doneAnalysts.length + failedAnalysts.length,
              total: ANALYSTS.length,
              doneAnalysts,
              failedAnalysts,
            };
            return (
              <EditorSection
                state={editorState}
                model={models.find((m) => m.id === assignments.editor)}
                voteStats={consensus}
                onRetry={editorState.status === 'error' ? retryEditor : null}
                analystProgress={progress}
                mentionDict={mentionDict}
                currentCode={stockData?.code}
                onSummonStock={handleSummonStock}
              />
            );
          })()}

          {submittedTicker && stockData && (
            <QVMRPanel
              stockData={stockData}
              klineData={klineData}
              financialsData={financialsData}
              editorState={editorState}
            />
          )}

          {submittedTicker && stockData && (
            <InvestmentMemoSection
              stockData={stockData}
              memo={currentInvestmentMemo}
              draft={investmentMemoDraft}
              onSave={saveCurrentInvestmentMemo}
              onReset={resetCurrentInvestmentMemo}
              onExport={exportCurrentInvestmentMemo}
            />
          )}

          {/* 二次审稿触发按钮 — 仅当主编 done 且有分歧 */}
          {editorState?.status === 'done' &&
            Array.isArray(editorState.data?.dissent_areas) &&
            (() => {
              const dissents = editorState.data.dissent_areas;
              const consumed = (secondRound?.topics || []).length;
              const remaining = dissents.length - consumed;
              const hasAnyDissent = dissents.length > 0;
              const allConsumed = consumed >= dissents.length;
              const disabled = !hasAnyDissent || allConsumed || secondRoundRunning;

              let label;
              if (!hasAnyDissent) label = '本期无明显分歧可追问';
              else if (allConsumed) label = '所有分歧已追问完毕';
              else if (secondRoundRunning) label = '议会二审中…';
              else if (consumed === 0) label = '▶ 追问主要分歧';
              else label = `▶ 追问下一个分歧（剩 ${remaining} 个）`;

              return (
                <>
                  <button
                    className="second-round-trigger"
                    onClick={runSecondRound}
                    disabled={disabled}
                    title={
                      !hasAnyDissent
                        ? '本期没有 dissent_areas'
                        : allConsumed
                        ? '已无可追问的分歧'
                        : '让对立两派各写 100-150 字反驳，主编再综合（约 3 次模型调用）'
                    }
                  >
                    {label}
                  </button>
                  {!disabled && (
                    <div className="second-round-trigger-note">
                      约 3 次模型调用 · 不烧首轮的 token
                    </div>
                  )}
                </>
              );
            })()}

          {/* 二次审稿展示 */}
          {secondRound && <SecondRoundSection secondRound={secondRound} />}

          {/* V19 Free Ask · 用户自由追问 — 仅在主编 done 时显示 */}
          {editorState?.status === 'done' && stockData && (
            <FreeAskSection
              analysts={ANALYSTS}
              analyses={analyses}
              threads={freeAskThreads}
              onSubmit={runFreeAsk}
              isRunning={freeAskRunning}
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
              THE AI COUNCIL GAZETTE · DEMO EDITION v2
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
