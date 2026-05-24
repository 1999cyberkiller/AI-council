/* ──────────────────────────────────────────────────────────────────
   useDispatchSession · 一次完整议会的状态机
   - 用 useReducer 统一管理 session 内全部派生状态
   - 把 App.jsx 中 run* 系列函数收编到这里
   - 通过 onEvent 回调上报 telemetry；通过返回的 state 让 App 做 tab/history 同步
   - 不持有任何持久化职责（tabs / history / watchlist 都留在 App）
   ────────────────────────────────────────────────────────────────── */

import { useReducer, useRef, useCallback } from 'react';
import {
  ANALYSTS,
  buildSystemPrompt, buildUserPrompt,
  buildEditorSystemPrompt, buildEditorUserPrompt,
  buildRebuttalSystemPrompt, buildRebuttalUserPrompt,
  buildSecondRoundEditorSystemPrompt, buildSecondRoundEditorUserPrompt,
  buildFreeAskSystemPrompt, buildFreeAskUserPrompt,
  buildFreeAskEditorSystemPrompt, buildFreeAskEditorUserPrompt,
} from '../lib/prompts';
import {
  parseAnalystResponse, parseEditorResponse,
  parseRebuttalResponse, parseSecondRoundEditor,
  parseFreeAskResponse, parseFreeAskEditor,
} from '../lib/parser';
import {
  resolveStock, resolveKline, resolveKlineByCode,
  fetchBenchmarkSpot, speculateMarketCode,
} from '../api/stocks';
import { resolveEvents } from '../api/events';
import { resolveFinancials, formatFinancialsForPrompt } from '../api/financials';
import { resolveConsensus, formatConsensusForPrompt } from '../api/consensus';
import { resolveNews, formatNewsForPrompt } from '../api/news';
import { callModel, resolveVariant } from '../api/models';
import { buildPersonaSignal } from '../lib/scoring';
import { pausePrewarm, resumePrewarm } from '../lib/prewarm';

export const ANALYST_CALL_TIMEOUT_MS = 28000;
export const EDITOR_CALL_TIMEOUT_MS = 35000;

const DATA_SOURCE_META = {
  quote: { label: '行情' },
  kline: { label: 'K 线' },
  baseline: { label: '基准' },
  events: { label: '事件' },
  financials: { label: '财务' },
  consensus: { label: '共识' },
  news: { label: '新闻' },
};

const makeInitialDataHealth = () =>
  Object.fromEntries(
    Object.entries(DATA_SOURCE_META).map(([id, meta]) => [
      id,
      { ...meta, status: 'pending', detail: '等待返回' },
    ])
  );

const errText = (e) => String(e?.message || e || '未知错误').slice(0, 160);

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

/* ──────────────────────────────────────────────────────────────
   STATE SHAPE
   ────────────────────────────────────────────────────────────── */
const initialState = {
  phase: 'idle',         // idle | fetching | analysts | editor | done | error | stopped
  ticker: '',
  stockData: null,
  stockError: '',
  klineData: null,
  klineLoading: false,
  klineRange: 90,
  analyses: {},          // { [analystId]: { status, data?, error?, rawPreview?, code? } }
  editorState: null,     // null | { status, data?, error?, ... }
  eventsData: null,
  financialsData: null,
  consensusData: null,
  newsData: null,
  dataHealth: {},
  baseline: null,        // { market, code, name, price } 或 null
  secondRound: null,     // null | { status, topics: [...] }
  secondRoundRunning: false,
  freeAskThreads: [],    // [{ id, question, picks, answers, editorFinal }]
  freeAskRunning: false,
  taskConsole: {},       // { [taskId]: { label, roleId, status, ms, modelName, ... } }
  startedAt: null,
};

/* ──────────────────────────────────────────────────────────────
   REDUCER
   ────────────────────────────────────────────────────────────── */
function reducer(state, action) {
  switch (action.type) {
    case 'reset':
      return { ...initialState, klineRange: state.klineRange };

    case 'start':
      return {
        ...initialState,
        phase: 'fetching',
        ticker: action.ticker,
        klineRange: action.klineRange ?? state.klineRange ?? 90,
        dataHealth: makeInitialDataHealth(),
        taskConsole: action.taskConsole || {},
        startedAt: Date.now(),
      };

    case 'hydrate':
      return {
        ...initialState,
        ...action.snapshot,
        phase: 'done',
        klineLoading: false,
        secondRoundRunning: false,
        freeAskRunning: false,
      };

    case 'quote_ready':
      return { ...state, stockData: action.data, phase: 'analysts' };

    case 'quote_error':
      return { ...state, stockError: action.error, phase: 'error' };

    case 'stop':
      return {
        ...state,
        phase: 'stopped',
        klineLoading: false,
        secondRoundRunning: false,
        freeAskRunning: false,
      };

    case 'phase':
      return { ...state, phase: action.value };

    case 'analyst_pending':
      return {
        ...state,
        analyses: { ...state.analyses, [action.id]: { status: 'pending' } },
      };

    case 'analyst_done':
      return {
        ...state,
        analyses: {
          ...state.analyses,
          [action.id]: { status: 'done', data: action.data },
        },
      };

    case 'analyst_error':
      return {
        ...state,
        analyses: {
          ...state.analyses,
          [action.id]: {
            status: 'error',
            error: action.error,
            rawPreview: action.rawPreview || null,
            code: action.code || null,
          },
        },
      };

    case 'analysts_finalize_pending':
      // 停止时把仍 pending 的分析师标 error
      return {
        ...state,
        analyses: Object.fromEntries(
          ANALYSTS.map((a) => {
            const cur = state.analyses[a.id];
            if (!cur || cur.status === 'pending') {
              return [a.id, { status: 'error', error: '本次分析已停止' }];
            }
            return [a.id, cur];
          })
        ),
      };

    case 'editor_pending':
      return { ...state, editorState: { status: 'pending' }, phase: 'editor' };

    case 'editor_done':
      return { ...state, editorState: { status: 'done', data: action.data }, phase: 'done' };

    case 'editor_error':
      return {
        ...state,
        editorState: {
          status: 'error',
          error: action.error,
          rawPreview: action.rawPreview || null,
          code: action.code || null,
        },
        phase: 'done',
      };

    case 'editor_skip':
      return { ...state, phase: 'done' };

    case 'editor_finalize_pending':
      return {
        ...state,
        editorState:
          state.editorState?.status === 'pending'
            ? { status: 'error', error: '本次分析已停止' }
            : state.editorState,
      };

    case 'kline_loading':
      return { ...state, klineLoading: action.value };

    case 'kline_data':
      return { ...state, klineData: action.data, klineLoading: false };

    case 'kline_range':
      return { ...state, klineRange: action.value };

    case 'data_health':
      return {
        ...state,
        dataHealth: {
          ...state.dataHealth,
          [action.id]: {
            ...(DATA_SOURCE_META[action.id] || { label: action.id }),
            ...(state.dataHealth[action.id] || {}),
            ...action.patch,
          },
        },
      };

    case 'set_data':
      return { ...state, [action.field]: action.value };

    case 'baseline':
      return { ...state, baseline: action.data };

    case 'task_update':
      return {
        ...state,
        taskConsole: {
          ...state.taskConsole,
          [action.id]: { ...(state.taskConsole[action.id] || {}), ...action.patch },
        },
      };

    case 'task_finalize_pending':
      return {
        ...state,
        taskConsole: Object.fromEntries(
          Object.entries(state.taskConsole).map(([id, task]) => [
            id,
            task.status === 'pending'
              ? { ...task, status: 'stopped', error: '用户停止' }
              : task,
          ])
        ),
      };

    case 'second_round_start':
      return {
        ...state,
        secondRoundRunning: true,
        secondRound: {
          status: 'running',
          topics: [...(state.secondRound?.topics || []), action.topic],
        },
      };

    case 'second_round_update_topic': {
      if (!state.secondRound) return state;
      const next = { ...state.secondRound, topics: [...state.secondRound.topics] };
      if (next.topics[action.idx]) {
        next.topics[action.idx] = action.update(next.topics[action.idx]);
      }
      return { ...state, secondRound: next };
    }

    case 'second_round_done':
      return { ...state, secondRoundRunning: false };

    case 'free_ask_start':
      // action.thread 必须已经带有 .id（由调用方生成）
      return {
        ...state,
        freeAskRunning: true,
        freeAskThreads: [...state.freeAskThreads, action.thread],
      };

    case 'free_ask_update': {
      const idx = state.freeAskThreads.findIndex((t) => t.id === action.threadId);
      if (idx === -1) return state;
      const next = [...state.freeAskThreads];
      next[idx] = action.update(next[idx]);
      return { ...state, freeAskThreads: next };
    }

    case 'free_ask_done':
      return { ...state, freeAskRunning: false };

    default:
      return state;
  }
}

/* ──────────────────────────────────────────────────────────────
   THE HOOK
   ────────────────────────────────────────────────────────────── */
export function useDispatchSession({
  models, apiKeys, modelVariants, assignments,
  alphaKey, finnhubKey,
  modelHealth, personaSignalsEnabled, credibilityStats,
  onEvent,
} = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // 状态镜像（用于回调里读取最新值）
  const stateRef = useRef(state);
  stateRef.current = state;

  // 依赖镜像（这样 useCallback 不需要把它们写进 deps）
  const depsRef = useRef({});
  depsRef.current = {
    models, apiKeys, modelVariants, assignments,
    alphaKey, finnhubKey,
    modelHealth, personaSignalsEnabled, credibilityStats,
    onEvent,
  };

  // 防 race：每次 start 自增；fetch closure 通过 isCurrent 判断
  const seqRef = useRef(0);
  const activeControllersRef = useRef(new Set());

  const abortAllInFlight = useCallback(() => {
    activeControllersRef.current.forEach((c) => {
      try { c.abort(); } catch {}
    });
    activeControllersRef.current.clear();
  }, []);

  /* ── 模型调用辅助 ─────────────────────────────────────────── */
  const chooseFallbackModel = useCallback((primaryModelId, roleId = null, extraExcludeIds = []) => {
    const { models, apiKeys, modelHealth, assignments } = depsRef.current;
    const excluded = new Set([primaryModelId, ...extraExcludeIds].filter(Boolean));
    const configured = models.filter((m) => apiKeys[m.id]?.trim() && !excluded.has(m.id));
    if (configured.length === 0) return null;
    const healthy = configured.find((m) => modelHealth[m.id]?.status === 'ok');
    if (healthy) return healthy;
    const roleFallback = roleId && assignments[roleId] && !excluded.has(assignments[roleId])
      ? configured.find((m) => m.id === assignments[roleId])
      : null;
    if (roleFallback) return roleFallback;
    const preferred = ['deepseek', 'zhipu', 'grok', 'gemini', 'minimax'];
    return configured.sort((a, b) => preferred.indexOf(a.id) - preferred.indexOf(b.id))[0] || null;
  }, []);

  const callModelTracked = useCallback(async ({
    taskId, label, roleId, model, apiKey,
    systemPrompt, userPrompt, timeoutMs,
    allowFallback = true, shouldUpdate = () => true,
  }) => {
    const { apiKeys, modelVariants, modelHealth } = depsRef.current;
    if (!model || !apiKey?.trim()) throw new Error('未配置模型或 API Key');

    const runOnce = async (targetModel, fallbackFrom = null) => {
      const variant = resolveVariant(targetModel, modelVariants[targetModel.id]);
      const controller = new AbortController();
      activeControllersRef.current.add(controller);
      const started = performance.now();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (shouldUpdate()) dispatch({
        type: 'task_update', id: taskId,
        patch: {
          label, roleId,
          status: 'pending',
          modelId: targetModel.id,
          modelName: targetModel.name,
          variant: variant?.label || variant?.id || '',
          fallbackFrom,
          error: '',
        },
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
        if (shouldUpdate()) dispatch({
          type: 'task_update', id: taskId,
          patch: { status: fallbackFrom ? 'warning' : 'ok', ms, error: '' },
        });
        return raw;
      } catch (e) {
        clearTimeout(timer);
        activeControllersRef.current.delete(controller);
        const ms = Math.round(performance.now() - started);
        const message = e?.name === 'AbortError' ? `${Math.round(timeoutMs / 1000)} 秒超时` : errText(e);
        if (shouldUpdate()) dispatch({
          type: 'task_update', id: taskId,
          patch: { status: 'error', ms, error: message },
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
      if (initialModel) return await runOnce(initialModel, model.name);
      return await runOnce(model);
    } catch (firstError) {
      if (!allowFallback) throw firstError;
      const fallback = chooseFallbackModel(model.id, roleId, Array.from(attemptedIds));
      if (!fallback) throw firstError;
      return runOnce(fallback, model.name);
    }
  }, [chooseFallbackModel]);

  /* ── 单个分析师 ───────────────────────────────────────────── */
  const runAnalyst = useCallback(async (
    analyst, data, klinePromise, modelOverride = null, promptExtras = null, isCurrent = () => true
  ) => {
    const { models, apiKeys, assignments, personaSignalsEnabled, credibilityStats } = depsRef.current;
    const modelId = modelOverride || assignments[analyst.id];
    const model = models.find((m) => m.id === modelId);
    const key = model ? apiKeys[model.id] : null;
    if (!model || !key) {
      if (isCurrent()) dispatch({ type: 'analyst_error', id: analyst.id, error: '未配置模型或 API Key' });
      return { analyst, error: '未配置模型或 API Key' };
    }
    if (isCurrent()) dispatch({ type: 'analyst_pending', id: analyst.id });
    try {
      let klineForPrompt = null;
      if (analyst.id === 'tech' && klinePromise) klineForPrompt = await klinePromise;
      if (!isCurrent()) return { analyst, error: '本次分析已取消' };
      const personaSignal = personaSignalsEnabled
        ? buildPersonaSignal(credibilityStats, analyst.id, data.sector || null)
        : null;
      const extras = promptExtras || {
        financialsText: formatFinancialsForPrompt(stateRef.current.financialsData),
        consensusText: formatConsensusForPrompt(stateRef.current.consensusData),
      };
      const sys = buildSystemPrompt(analyst, personaSignal);
      const usr = buildUserPrompt(data, klineForPrompt, analyst.id, extras);
      const raw = await callModelTracked({
        taskId: `analyst:${analyst.id}`,
        label: analyst.cnName,
        roleId: analyst.id,
        model, apiKey: key,
        systemPrompt: sys, userPrompt: usr,
        timeoutMs: ANALYST_CALL_TIMEOUT_MS,
        shouldUpdate: isCurrent,
      });
      if (!isCurrent()) return { analyst, error: '本次分析已取消' };
      const parsed = parseAnalystResponse(raw);
      if (isCurrent()) dispatch({ type: 'analyst_done', id: analyst.id, data: parsed });
      return { analyst, data: parsed };
    } catch (err) {
      if (isCurrent()) {
        dispatch({
          type: 'analyst_error', id: analyst.id,
          error: err.message || '未知错误',
          rawPreview: err.rawPreview || null,
          code: err.code || null,
        });
      }
      return { analyst, error: err.message };
    }
  }, [callModelTracked]);

  /* ── 主编 ─────────────────────────────────────────────────── */
  const runEditor = useCallback(async (data, currentAnalyses, extrasOverride = null, isCurrent = () => true) => {
    const { models, apiKeys, assignments } = depsRef.current;
    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (!editorModel || !editorKey || !editorKey.trim()) {
      if (isCurrent()) dispatch({ type: 'editor_skip' });
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
        dispatch({ type: 'editor_error', error: '完成的专栏不足 2 篇，主编不出札记' });
      }
      return null;
    }

    if (isCurrent()) dispatch({ type: 'editor_pending' });
    try {
      const eSys = buildEditorSystemPrompt();
      const eExtras = extrasOverride || {
        financialsText: formatFinancialsForPrompt(stateRef.current.financialsData),
        consensusText: formatConsensusForPrompt(stateRef.current.consensusData),
        newsText: formatNewsForPrompt(stateRef.current.newsData),
      };
      const eUsr = buildEditorUserPrompt(data, [...successful, ...failed], eExtras);
      const eRaw = await callModelTracked({
        taskId: 'editor', label: '主编', roleId: 'editor',
        model: editorModel, apiKey: editorKey,
        systemPrompt: eSys, userPrompt: eUsr,
        timeoutMs: EDITOR_CALL_TIMEOUT_MS,
        shouldUpdate: isCurrent,
      });
      if (!isCurrent()) return null;
      const eParsed = parseEditorResponse(eRaw);
      if (isCurrent()) dispatch({ type: 'editor_done', data: eParsed });
      return eParsed;
    } catch (err) {
      if (isCurrent()) {
        dispatch({
          type: 'editor_error',
          error: err.message || '未知错误',
          rawPreview: err.rawPreview || null,
          code: err.code || null,
        });
      }
      return null;
    }
  }, [callModelTracked]);

  /* ── 主流程：start ───────────────────────────────────────── */
  const start = useCallback(async (ticker) => {
    const { models, apiKeys, alphaKey, finnhubKey, assignments, modelVariants, onEvent } = depsRef.current;
    if (!ticker) return;

    // 验证至少配置了一位分析师
    const ready = ANALYSTS.filter((a) => {
      const m = models.find((x) => x.id === assignments[a.id]);
      return m && apiKeys[m.id] && apiKeys[m.id].trim();
    });
    if (ready.length === 0) {
      dispatch({ type: 'quote_error', error: '请先点击右上角 ⚙ 按钮，至少配置一位分析师对应的模型 API Key' });
      return { needsConfig: true };
    }

    // 序号自增；旧请求 closure 会被视为过期
    const mySeq = ++seqRef.current;
    const isCurrent = () => seqRef.current === mySeq;
    abortAllInFlight();

    // 准备 taskConsole 初始格子
    const initialTasks = Object.fromEntries([
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
        label: '主编', roleId: 'editor', status: 'idle',
        modelName: models.find((m) => m.id === assignments.editor)?.name || '未配置',
        variant: resolveVariant(
          models.find((m) => m.id === assignments.editor) || {},
          modelVariants[assignments.editor]
        )?.label || '',
      }],
    ]);

    dispatch({ type: 'start', ticker, klineRange: stateRef.current.klineRange, taskConsole: initialTasks });
    pausePrewarm();

    // ── 投机式提前发起 K 线和基准 ──
    const spec = speculateMarketCode(ticker);
    if (isCurrent() && spec) dispatch({ type: 'kline_loading', value: true });

    const klinePromiseSpec = spec
      ? resolveKlineByCode(spec.market, spec.code, alphaKey, stateRef.current.klineRange)
          .then((kl) => {
            if (isCurrent()) {
              dispatch({ type: 'kline_data', data: kl });
              dispatch({
                type: 'data_health', id: 'kline',
                patch: kl?.length
                  ? { status: 'ok', detail: 'K 线已返回', count: kl.length, source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
                  : { status: 'error', detail: 'K 线返回为空或接口失败', source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() },
              });
            }
            return kl;
          })
          .catch((e) => {
            if (isCurrent()) {
              dispatch({ type: 'kline_data', data: null });
              dispatch({ type: 'data_health', id: 'kline', patch: { status: 'error', detail: errText(e), source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() } });
            }
            return null;
          })
      : null;

    const baselinePromiseSpec = spec
      ? fetchBenchmarkSpot(spec.market, alphaKey)
          .then((b) => {
            if (isCurrent()) {
              dispatch({ type: 'baseline', data: b });
              dispatch({
                type: 'data_health', id: 'baseline',
                patch: b
                  ? { status: 'ok', detail: `${b.name || '基准'} 可用`, source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
                  : { status: 'empty', detail: '基准指数暂无返回', source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() },
              });
            }
            return b;
          })
          .catch((e) => {
            if (isCurrent()) dispatch({ type: 'data_health', id: 'baseline', patch: { status: 'warning', detail: errText(e), source: spec.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() } });
            return null;
          })
      : null;

    // ── 1. 拉行情（必须等） ──
    let data;
    try {
      data = await resolveStock(ticker, alphaKey);
      if (!isCurrent()) return;
      dispatch({ type: 'quote_ready', data });
      dispatch({ type: 'data_health', id: 'quote', patch: { status: 'ok', detail: `${data.market === 'A' ? 'A 股' : '美股'}行情可用`, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() } });
    } catch (e) {
      if (!isCurrent()) return;
      dispatch({ type: 'data_health', id: 'quote', patch: { status: 'error', detail: errText(e), source: '行情接口', fetchedAt: Date.now() } });
      dispatch({ type: 'quote_error', error: `行情数据获取失败：${e.message}` });
      resumePrewarm();
      return;
    }

    // ── 2. 后台拉事件/财务/共识/新闻 ──
    resolveEvents(data, finnhubKey)
      .then((ed) => {
        if (!isCurrent()) return;
        dispatch({ type: 'set_data', field: 'eventsData', value: ed });
        if (ed?.hasMissingKey) dispatch({ type: 'data_health', id: 'events', patch: { status: 'warning', detail: '美股事件需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() } });
        else if (ed?.events?.length) dispatch({ type: 'data_health', id: 'events', patch: { status: 'ok', detail: '事件日历可用', count: ed.events.length, source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
        else dispatch({ type: 'data_health', id: 'events', patch: { status: 'empty', detail: '暂无临近财报或分红事件', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
      })
      .catch((e) => {
        if (isCurrent()) dispatch({ type: 'data_health', id: 'events', patch: { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
      });

    const finPromise = resolveFinancials(data, finnhubKey)
      .then((fd) => {
        if (isCurrent()) {
          dispatch({ type: 'set_data', field: 'financialsData', value: fd });
          if (fd?.hasMissingKey) dispatch({ type: 'data_health', id: 'financials', patch: { status: 'warning', detail: '美股财务需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() } });
          else if (fd?.quarters?.length) dispatch({ type: 'data_health', id: 'financials', patch: { status: 'ok', detail: '季度财务可用', count: fd.quarters.length, source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
          else dispatch({ type: 'data_health', id: 'financials', patch: { status: 'empty', detail: '未取得最近季度财务', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
        }
        return fd;
      })
      .catch((e) => {
        if (isCurrent()) dispatch({ type: 'data_health', id: 'financials', patch: { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
        return null;
      });

    const consPromise = resolveConsensus(data, finnhubKey)
      .then((cd) => {
        if (isCurrent()) {
          dispatch({ type: 'set_data', field: 'consensusData', value: cd });
          if (cd?.hasMissingKey) dispatch({ type: 'data_health', id: 'consensus', patch: { status: 'warning', detail: '美股共识需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() } });
          else if (cd?.data) dispatch({ type: 'data_health', id: 'consensus', patch: { status: 'ok', detail: '卖方共识可用', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
          else dispatch({ type: 'data_health', id: 'consensus', patch: { status: 'empty', detail: '暂无可用卖方共识', source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
        }
        return cd;
      })
      .catch((e) => {
        if (isCurrent()) dispatch({ type: 'data_health', id: 'consensus', patch: { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Finnhub', fetchedAt: Date.now() } });
        return null;
      });

    const newsPromise = resolveNews(data, finnhubKey)
      .then((nd) => {
        if (isCurrent()) {
          dispatch({ type: 'set_data', field: 'newsData', value: nd });
          if (nd?.hasMissingKey) dispatch({ type: 'data_health', id: 'news', patch: { status: 'warning', detail: '美股新闻需要 Finnhub key', source: 'Finnhub', fetchedAt: Date.now() } });
          else if (nd?.items?.length) dispatch({ type: 'data_health', id: 'news', patch: { status: 'ok', detail: '近期资讯可用', count: nd.items.length, source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() } });
          else dispatch({ type: 'data_health', id: 'news', patch: { status: 'empty', detail: '暂无近期资讯', source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() } });
        }
        return nd;
      })
      .catch((e) => {
        if (isCurrent()) dispatch({ type: 'data_health', id: 'news', patch: { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富搜索' : 'Finnhub', fetchedAt: Date.now() } });
        return null;
      });

    // ── 等财务和共识 ready 再发分析师（最多 4 秒）──
    const promptExtras = await (async () => {
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

    // ── 补发 K 线和基准（如果之前 spec 没成）──
    const actualKlinePromise = klinePromiseSpec || (() => {
      if (isCurrent()) dispatch({ type: 'kline_loading', value: true });
      return resolveKline(data, alphaKey, stateRef.current.klineRange)
        .then((kl) => {
          if (isCurrent()) {
            dispatch({ type: 'kline_data', data: kl });
            dispatch({
              type: 'data_health', id: 'kline',
              patch: kl?.length
                ? { status: 'ok', detail: 'K 线已返回', count: kl.length, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
                : { status: 'error', detail: 'K 线返回为空或接口失败', source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() },
            });
          }
          return kl;
        })
        .catch((e) => {
          if (isCurrent()) {
            dispatch({ type: 'kline_data', data: null });
            dispatch({ type: 'data_health', id: 'kline', patch: { status: 'error', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() } });
          }
          return null;
        });
    })();

    const actualBaselinePromise = baselinePromiseSpec || fetchBenchmarkSpot(data.market, alphaKey)
      .then((b) => {
        if (isCurrent()) {
          dispatch({ type: 'baseline', data: b });
          dispatch({
            type: 'data_health', id: 'baseline',
            patch: b
              ? { status: 'ok', detail: `${b.name || '基准'} 可用`, source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() }
              : { status: 'empty', detail: '基准指数暂无返回', source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() },
          });
        }
        return b;
      })
      .catch((e) => {
        if (isCurrent()) dispatch({ type: 'data_health', id: 'baseline', patch: { status: 'warning', detail: errText(e), source: data.market === 'A' ? '东方财富' : 'Alpha Vantage', fetchedAt: Date.now() } });
        return null;
      });

    // ── 4 位分析师并行 ──
    const jobs = ANALYSTS.map((a) => runAnalyst(a, data, actualKlinePromise, null, promptExtras, isCurrent));
    const results = await Promise.allSettled(jobs);
    if (!isCurrent()) return;

    const baseline = await actualBaselinePromise;
    if (!isCurrent()) return;

    // ── 主编 ──
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

    let editorExtras = {
      financialsData: promptExtras.financialsData,
      consensusData: promptExtras.consensusData,
      newsData: null,
      financialsText: promptExtras.financialsText,
      consensusText: promptExtras.consensusText,
      newsText: '',
    };
    let editorParsed = null;
    const { models: ms, apiKeys: aks, assignments: ass } = depsRef.current;
    const editorModel = ms.find((m) => m.id === ass.editor);
    const editorKey = editorModel ? aks[editorModel.id] : null;
    if (editorModel && editorKey && editorKey.trim()) {
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
    } else {
      if (isCurrent()) dispatch({ type: 'editor_skip' });
    }

    if (!isCurrent()) return;

    // ── 上报完成事件，告知 App 持久化 ──
    const klFinal = await actualKlinePromise;
    if (!isCurrent()) return;

    if (typeof onEvent === 'function') {
      onEvent({
        type: 'session_complete',
        ticker,
        market: data.market,
        stockData: data,
        klineData: klFinal,
        analyses: currentAnalyses,
        editorState: editorParsed ? { status: 'done', data: editorParsed } : (stateRef.current.editorState || null),
        baseline,
        eventsData: stateRef.current.eventsData,
        financialsData: editorExtras.financialsData,
        consensusData: editorExtras.consensusData,
        newsData: editorExtras.newsData,
        dataHealth: stateRef.current.dataHealth,
      });
    }

    resumePrewarm();
  }, [abortAllInFlight, runAnalyst, runEditor]);

  /* ── stop ────────────────────────────────────────────────── */
  const stop = useCallback(() => {
    seqRef.current += 1;
    abortAllInFlight();
    dispatch({ type: 'stop' });
    dispatch({ type: 'analysts_finalize_pending' });
    dispatch({ type: 'editor_finalize_pending' });
    dispatch({ type: 'task_finalize_pending' });
    resumePrewarm();
  }, [abortAllInFlight]);

  /* ── reset ───────────────────────────────────────────────── */
  const reset = useCallback(() => {
    seqRef.current += 1;
    abortAllInFlight();
    dispatch({ type: 'reset' });
  }, [abortAllInFlight]);

  /* ── hydrate（从 tab/history 加载）────────────────────────── */
  const hydrate = useCallback((snapshot) => {
    seqRef.current += 1;
    abortAllInFlight();
    dispatch({ type: 'hydrate', snapshot });
  }, [abortAllInFlight]);

  /* ── 重试单个分析师 ──────────────────────────────────────── */
  const retryAnalyst = useCallback(async (analystId, modelOverride = null) => {
    const cur = stateRef.current;
    if (!cur.stockData) return;
    const analyst = ANALYSTS.find((a) => a.id === analystId);
    if (!analyst) return;

    const mySeq = seqRef.current; // 不自增，复用当前 seq
    const isCurrent = () => seqRef.current === mySeq;
    const { alphaKey } = depsRef.current;
    const klinePromise = cur.klineData != null
      ? Promise.resolve(cur.klineData)
      : resolveKline(cur.stockData, alphaKey, cur.klineRange);
    await runAnalyst(analyst, cur.stockData, klinePromise, modelOverride, null, isCurrent);
  }, [runAnalyst]);

  const retryAnalystWithModel = useCallback((analystId, newModelId) => {
    return retryAnalyst(analystId, newModelId);
  }, [retryAnalyst]);

  /* ── 重试主编 ────────────────────────────────────────────── */
  const retryEditor = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur.stockData) return;
    const mySeq = seqRef.current;
    const isCurrent = () => seqRef.current === mySeq;
    await runEditor(cur.stockData, cur.analyses, null, isCurrent);
  }, [runEditor]);

  /* ── 重试所有失败 ────────────────────────────────────────── */
  const retryFailedTasks = useCallback(async () => {
    const cur = stateRef.current;
    if (!cur.stockData) return;
    const failed = ANALYSTS.filter((a) => cur.analyses[a.id]?.status === 'error');
    if (failed.length === 0) {
      if (cur.editorState?.status === 'error') await retryEditor();
      return;
    }
    const { alphaKey } = depsRef.current;
    const klinePromise = cur.klineData != null
      ? Promise.resolve(cur.klineData)
      : resolveKline(cur.stockData, alphaKey, cur.klineRange);
    const mySeq = seqRef.current;
    const isCurrent = () => seqRef.current === mySeq;
    const results = await Promise.allSettled(failed.map((a) => runAnalyst(a, cur.stockData, klinePromise, null, null, isCurrent)));
    const repaired = { ...cur.analyses };
    results.forEach((r, i) => {
      const a = failed[i];
      if (r.status === 'fulfilled' && r.value?.data) repaired[a.id] = { status: 'done', data: r.value.data };
      else if (r.status === 'fulfilled' && r.value?.error) repaired[a.id] = { status: 'error', error: r.value.error };
      else repaired[a.id] = { status: 'error', error: '重试失败' };
    });
    const successful = ANALYSTS.filter((a) => repaired[a.id]?.status === 'done');
    if (successful.length >= 2) await runEditor(cur.stockData, repaired, null, isCurrent);
  }, [runAnalyst, runEditor, retryEditor]);

  /* ── 切换 K 线时间窗 ─────────────────────────────────────── */
  const changeKlineRange = useCallback(async (newDays) => {
    dispatch({ type: 'kline_range', value: newDays });
    const cur = stateRef.current;
    if (!cur.stockData) return;
    dispatch({ type: 'kline_loading', value: true });
    try {
      const { alphaKey } = depsRef.current;
      const kl = await resolveKline(cur.stockData, alphaKey, newDays);
      dispatch({ type: 'kline_data', data: kl });
    } catch {
      dispatch({ type: 'kline_data', data: null });
    }
  }, []);

  /* ── 二审 ────────────────────────────────────────────────── */
  const runSecondRound = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.secondRoundRunning) return;
    if (!cur.stockData || cur.editorState?.status !== 'done') return;
    const dissents = cur.editorState.data?.dissent_areas;
    if (!Array.isArray(dissents) || dissents.length === 0) return;
    const consumedCount = (cur.secondRound?.topics || []).length;
    if (consumedCount >= dissents.length) return;
    const dissent = dissents[consumedCount];
    if (!dissent || !dissent.topic) return;
    const positionEntries = Object.entries(dissent.positions || {});
    if (positionEntries.length < 2) return;
    const [pairA, pairB] = positionEntries.slice(0, 2);
    const [nameA, stanceA] = pairA;
    const [nameB, stanceB] = pairB;
    const analystA = ANALYSTS.find((a) => a.cnName === nameA);
    const analystB = ANALYSTS.find((a) => a.cnName === nameB);
    if (!analystA || !analystB) return;
    const aFirstRound = cur.analyses[analystA.id]?.data;
    const bFirstRound = cur.analyses[analystB.id]?.data;
    if (!aFirstRound || !bFirstRound) return;

    pausePrewarm();
    const mySeq = seqRef.current;
    const isCurrent = () => seqRef.current === mySeq;

    const topic = {
      topic: dissent.topic,
      rebuttals: [
        { analystName: nameA, status: 'pending' },
        { analystName: nameB, status: 'pending' },
      ],
      editorFinal: null,
    };
    dispatch({ type: 'second_round_start', topic });
    const topicIdx = consumedCount;

    const { models, apiKeys, assignments } = depsRef.current;
    const runRebut = async (analyst, ownStance, opponent, opponentFirstRound) => {
      const model = models.find((m) => m.id === assignments[analyst.id]);
      const key = model ? apiKeys[model.id] : null;
      if (!model || !key || !key.trim()) return { status: 'error', error: '未配置 API key' };
      try {
        const sys = buildRebuttalSystemPrompt(analyst);
        const usr = buildRebuttalUserPrompt(cur.stockData, dissent.topic, ownStance, {
          name: opponent.cnName,
          stance: opponentFirstRound.headline,
          headline: opponentFirstRound.headline,
          key_points: opponentFirstRound.key_points,
          risk: opponentFirstRound.risk,
        });
        const raw = await callModelTracked({
          taskId: `second:${topicIdx}:${analyst.id}`,
          label: `二审 · ${analyst.cnName}`,
          roleId: analyst.id, model, apiKey: key,
          systemPrompt: sys, userPrompt: usr,
          timeoutMs: ANALYST_CALL_TIMEOUT_MS,
          shouldUpdate: isCurrent,
        });
        if (!isCurrent()) return { status: 'error', error: '本次追问已取消' };
        return { status: 'done', data: parseRebuttalResponse(raw) };
      } catch (err) {
        return { status: 'error', error: err.message || '未知错误' };
      }
    };

    const [resA, resB] = await Promise.allSettled([
      runRebut(analystA, stanceA, analystB, bFirstRound),
      runRebut(analystB, stanceB, analystA, aFirstRound),
    ]);
    const rebutA = resA.status === 'fulfilled' ? resA.value : { status: 'error', error: String(resA.reason) };
    const rebutB = resB.status === 'fulfilled' ? resB.value : { status: 'error', error: String(resB.reason) };

    dispatch({
      type: 'second_round_update_topic', idx: topicIdx,
      update: (t) => ({
        ...t,
        rebuttals: [
          { analystName: nameA, ...rebutA },
          { analystName: nameB, ...rebutB },
        ],
        editorFinal: { status: 'pending' },
      }),
    });

    const editorModel = models.find((m) => m.id === assignments.editor);
    const editorKey = editorModel ? apiKeys[editorModel.id] : null;
    if (!editorModel || !editorKey || !editorKey.trim()) {
      dispatch({
        type: 'second_round_update_topic', idx: topicIdx,
        update: (t) => ({ ...t, editorFinal: { status: 'error', error: '主编未配置 API key' } }),
      });
      if (isCurrent()) {
        dispatch({ type: 'second_round_done' });
        resumePrewarm();
      }
      return;
    }

    try {
      const eSys = buildSecondRoundEditorSystemPrompt();
      const eUsr = buildSecondRoundEditorUserPrompt(
        cur.stockData, cur.editorState.data, dissent.topic,
        [
          { analystName: nameA, ...rebutA },
          { analystName: nameB, ...rebutB },
        ]
      );
      const eRaw = await callModelTracked({
        taskId: `second:${topicIdx}:editor`,
        label: '二审 · 主编', roleId: 'editor',
        model: editorModel, apiKey: editorKey,
        systemPrompt: eSys, userPrompt: eUsr,
        timeoutMs: EDITOR_CALL_TIMEOUT_MS,
        shouldUpdate: isCurrent,
      });
      if (isCurrent()) {
        const eParsed = parseSecondRoundEditor(eRaw);
        dispatch({
          type: 'second_round_update_topic', idx: topicIdx,
          update: (t) => ({ ...t, editorFinal: { status: 'done', data: eParsed } }),
        });
      }
    } catch (err) {
      dispatch({
        type: 'second_round_update_topic', idx: topicIdx,
        update: (t) => ({ ...t, editorFinal: { status: 'error', error: err.message || '未知错误' } }),
      });
    }

    if (isCurrent()) {
      dispatch({ type: 'second_round_done' });
      resumePrewarm();
      const { onEvent } = depsRef.current;
      if (typeof onEvent === 'function') {
        onEvent({ type: 'second_round_done', ticker: cur.stockData.code, topicIdx });
      }
    }
  }, [callModelTracked]);

  /* ── 自由追问 ────────────────────────────────────────────── */
  const runFreeAsk = useCallback(async (question, pickedAnalystIds) => {
    const cur = stateRef.current;
    if (cur.freeAskRunning) return;
    if (!cur.stockData) return;
    if (!Array.isArray(pickedAnalystIds) || pickedAnalystIds.length === 0) return;
    if (!question || question.trim().length < 4) return;

    pausePrewarm();
    const mySeq = seqRef.current;
    const isCurrent = () => seqRef.current === mySeq;

    const pickedAnalysts = pickedAnalystIds
      .map((id) => ANALYSTS.find((a) => a.id === id))
      .filter(Boolean);

    // ★ Fix: 生成稳定 thread id，避免双击竞态
    const threadId = `free-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const thread = {
      id: threadId,
      question,
      picks: pickedAnalystIds,
      answers: pickedAnalysts.map((a) => ({
        analystName: a.cnName, analystId: a.id, status: 'pending',
      })),
      editorFinal: pickedAnalysts.length >= 2 ? { status: 'pending' } : null,
    };
    dispatch({ type: 'free_ask_start', thread });

    const updateThread = (mut) => {
      if (!isCurrent()) return;
      dispatch({ type: 'free_ask_update', threadId, update: mut });
    };

    const { models, apiKeys, assignments } = depsRef.current;
    const runOne = async (analyst) => {
      const model = models.find((m) => m.id === assignments[analyst.id]);
      const key = model ? apiKeys[model.id] : null;
      if (!model || !key || !key.trim()) return { status: 'error', error: '未配置 API key' };
      try {
        const sys = buildFreeAskSystemPrompt(analyst);
        const usr = buildFreeAskUserPrompt(cur.stockData, question, cur.analyses[analyst.id]?.data);
        const raw = await callModelTracked({
          taskId: `free:${threadId}:${analyst.id}`,
          label: `追问 · ${analyst.cnName}`,
          roleId: analyst.id, model, apiKey: key,
          systemPrompt: sys, userPrompt: usr,
          timeoutMs: ANALYST_CALL_TIMEOUT_MS,
          shouldUpdate: isCurrent,
        });
        if (!isCurrent()) return { status: 'error', error: '本次追问已取消' };
        return { status: 'done', data: parseFreeAskResponse(raw) };
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

    const doneAnswers = answerResults.filter((a) => a.status === 'done');
    if (doneAnswers.length >= 2) {
      const editorModel = models.find((m) => m.id === assignments.editor);
      const editorKey = editorModel ? apiKeys[editorModel.id] : null;
      if (!editorModel || !editorKey || !editorKey.trim()) {
        updateThread((t) => ({ ...t, editorFinal: { status: 'error', error: '主编未配置' } }));
      } else {
        try {
          const eSys = buildFreeAskEditorSystemPrompt();
          const eUsr = buildFreeAskEditorUserPrompt(cur.stockData, question, doneAnswers);
          const eRaw = await callModelTracked({
            taskId: `free:${threadId}:editor`,
            label: '追问 · 主编', roleId: 'editor',
            model: editorModel, apiKey: editorKey,
            systemPrompt: eSys, userPrompt: eUsr,
            timeoutMs: EDITOR_CALL_TIMEOUT_MS,
            shouldUpdate: isCurrent,
          });
          if (isCurrent()) {
            const eParsed = parseFreeAskEditor(eRaw);
            updateThread((t) => ({ ...t, editorFinal: { status: 'done', data: eParsed } }));
          }
        } catch (err) {
          updateThread((t) => ({ ...t, editorFinal: { status: 'error', error: err.message || '未知错误' } }));
        }
      }
    } else {
      updateThread((t) => ({ ...t, editorFinal: null }));
    }

    if (isCurrent()) {
      dispatch({ type: 'free_ask_done' });
      resumePrewarm();
      const { onEvent } = depsRef.current;
      if (typeof onEvent === 'function') {
        onEvent({ type: 'free_ask_done', ticker: cur.stockData.code, picks: pickedAnalystIds });
      }
    }
  }, [callModelTracked]);

  return {
    state,
    actions: {
      start, stop, reset, hydrate,
      retryAnalyst, retryAnalystWithModel, retryEditor, retryFailedTasks,
      changeKlineRange,
      runSecondRound, runFreeAsk,
    },
  };
}
