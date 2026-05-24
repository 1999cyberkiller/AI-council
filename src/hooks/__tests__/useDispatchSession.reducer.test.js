/**
 * useDispatchSession reducer 单元测试
 *
 * reducer 是纯函数，状态转换 16 个 action 的语义必须可预测。
 * 这个测试套件覆盖所有 action type + 关键边界情况，作为未来修改
 * reducer 时的回归防线。
 *
 * 运行：npx vitest run src/hooks/__tests__/useDispatchSession.reducer.test.js
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';

// ── Mock 掉所有有副作用风险的 import ──────────────────────────────
// reducer 本身不调用这些，但 useDispatchSession.jsx 顶部 import 了它们。
// mock 后即使这些模块顶层有意外副作用也不会影响测试。
vi.mock('../../lib/prompts', () => ({
  ANALYSTS: [
    { id: 'value', cnName: '价值派' },
    { id: 'tech', cnName: '技术派' },
    { id: 'macro', cnName: '宏观派' },
    { id: 'risk', cnName: '风险派' },
  ],
  buildSystemPrompt: () => '',
  buildUserPrompt: () => '',
  buildEditorSystemPrompt: () => '',
  buildEditorUserPrompt: () => '',
  buildRebuttalSystemPrompt: () => '',
  buildRebuttalUserPrompt: () => '',
  buildSecondRoundEditorSystemPrompt: () => '',
  buildSecondRoundEditorUserPrompt: () => '',
  buildFreeAskSystemPrompt: () => '',
  buildFreeAskUserPrompt: () => '',
  buildFreeAskEditorSystemPrompt: () => '',
  buildFreeAskEditorUserPrompt: () => '',
}));
vi.mock('../../lib/parser', () => ({
  parseAnalystResponse: (x) => x,
  parseEditorResponse: (x) => x,
  parseRebuttalResponse: (x) => x,
  parseSecondRoundEditor: (x) => x,
  parseFreeAskResponse: (x) => x,
  parseFreeAskEditor: (x) => x,
}));
vi.mock('../../api/stocks', () => ({
  resolveStock: vi.fn(),
  resolveKline: vi.fn(),
  resolveKlineByCode: vi.fn(),
  fetchBenchmarkSpot: vi.fn(),
  speculateMarketCode: vi.fn(),
}));
vi.mock('../../api/events', () => ({ resolveEvents: vi.fn() }));
vi.mock('../../api/financials', () => ({
  resolveFinancials: vi.fn(),
  formatFinancialsForPrompt: () => '',
}));
vi.mock('../../api/consensus', () => ({
  resolveConsensus: vi.fn(),
  formatConsensusForPrompt: () => '',
}));
vi.mock('../../api/news', () => ({
  resolveNews: vi.fn(),
  formatNewsForPrompt: () => '',
}));
vi.mock('../../api/models', () => ({
  callModel: vi.fn(),
  resolveVariant: () => ({ id: 'v', label: 'V' }),
}));
vi.mock('../../lib/scoring', () => ({ buildPersonaSignal: () => null }));
vi.mock('../../lib/prewarm', () => ({
  pausePrewarm: vi.fn(),
  resumePrewarm: vi.fn(),
}));

import { reducer, initialState, DATA_SOURCE_META, makeInitialDataHealth } from '../useDispatchSession.jsx';

const dispatch = (state, action) => reducer(state, action);

/* ════════════════════════════════════════════════════════════════
   initialState 形状
   ════════════════════════════════════════════════════════════════ */
describe('initialState', () => {
  it('phase 默认为 idle', () => {
    expect(initialState.phase).toBe('idle');
  });
  it('所有集合字段非 null', () => {
    expect(initialState.analyses).toEqual({});
    expect(initialState.freeAskThreads).toEqual([]);
    expect(initialState.taskConsole).toEqual({});
    expect(initialState.dataHealth).toEqual({});
  });
  it('running flags 都为 false', () => {
    expect(initialState.secondRoundRunning).toBe(false);
    expect(initialState.freeAskRunning).toBe(false);
    expect(initialState.klineLoading).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
   reset / start / hydrate
   ════════════════════════════════════════════════════════════════ */
describe('reset', () => {
  it('回到 initialState 但保留 klineRange', () => {
    const dirty = {
      ...initialState,
      phase: 'done',
      klineRange: 180,
      stockData: { code: '600519' },
      analyses: { value: { status: 'done', data: {} } },
      freeAskThreads: [{ id: 'x' }],
    };
    const next = dispatch(dirty, { type: 'reset' });
    expect(next.phase).toBe('idle');
    expect(next.stockData).toBeNull();
    expect(next.analyses).toEqual({});
    expect(next.freeAskThreads).toEqual([]);
    expect(next.klineRange).toBe(180); // 保留
  });
});

describe('start', () => {
  it('清空所有旧 session 状态，保留 klineRange', () => {
    const dirty = {
      ...initialState,
      phase: 'done',
      stockData: { code: 'old' },
      ticker: 'OLD',
      analyses: { value: { status: 'done' } },
      editorState: { status: 'done' },
      secondRound: { topics: [{}] },
      freeAskThreads: [{ id: '1' }],
      klineRange: 180,
    };
    const next = dispatch(dirty, { type: 'start', ticker: 'NEW' });
    expect(next.ticker).toBe('NEW');
    expect(next.phase).toBe('fetching');
    expect(next.stockData).toBeNull();
    expect(next.analyses).toEqual({});
    expect(next.editorState).toBeNull();
    expect(next.secondRound).toBeNull();
    expect(next.freeAskThreads).toEqual([]);
    expect(next.klineRange).toBe(180);
  });

  it('action.klineRange 优先于 state.klineRange', () => {
    const next = dispatch(
      { ...initialState, klineRange: 90 },
      { type: 'start', ticker: 'X', klineRange: 365 }
    );
    expect(next.klineRange).toBe(365);
  });

  it('action.taskConsole 直接注入', () => {
    const tasks = { 'analyst:value': { status: 'pending', label: '价值派' } };
    const next = dispatch(initialState, { type: 'start', ticker: 'X', taskConsole: tasks });
    expect(next.taskConsole).toEqual(tasks);
  });

  it('dataHealth 被填成 7 项 pending', () => {
    const next = dispatch(initialState, { type: 'start', ticker: 'X' });
    expect(Object.keys(next.dataHealth)).toHaveLength(Object.keys(DATA_SOURCE_META).length);
    Object.values(next.dataHealth).forEach((d) => {
      expect(d.status).toBe('pending');
      expect(d.detail).toBe('等待返回');
    });
  });

  it('多次 start 总是完全重置', () => {
    let s = dispatch(initialState, { type: 'start', ticker: 'A' });
    s = dispatch(s, { type: 'analyst_done', id: 'value', data: { v: 1 } });
    s = dispatch(s, { type: 'start', ticker: 'B' });
    expect(s.ticker).toBe('B');
    expect(s.analyses).toEqual({});
  });
});

describe('hydrate', () => {
  it('从快照恢复到 done 阶段，并清掉 running flags', () => {
    const snapshot = {
      ticker: '600519',
      stockData: { code: '600519', name: '贵州茅台' },
      analyses: { value: { status: 'done', data: {} } },
      editorState: { status: 'done', data: { verdict: 'BUY' } },
      secondRoundRunning: true,   // ← hydrate 应忽略
      freeAskRunning: true,        // ← hydrate 应忽略
    };
    const next = dispatch(initialState, { type: 'hydrate', snapshot });
    expect(next.phase).toBe('done');
    expect(next.ticker).toBe('600519');
    expect(next.stockData.code).toBe('600519');
    expect(next.secondRoundRunning).toBe(false);
    expect(next.freeAskRunning).toBe(false);
    expect(next.klineLoading).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════
   quote / stop / phase
   ════════════════════════════════════════════════════════════════ */
describe('quote_ready / quote_error', () => {
  it('quote_ready 设置 stockData 并进入 analysts 阶段', () => {
    const data = { code: '600519', market: 'A' };
    const next = dispatch(
      { ...initialState, phase: 'fetching' },
      { type: 'quote_ready', data }
    );
    expect(next.stockData).toBe(data);
    expect(next.phase).toBe('analysts');
  });

  it('quote_error 设置 stockError 并进入 error 阶段', () => {
    const next = dispatch(
      { ...initialState, phase: 'fetching' },
      { type: 'quote_error', error: '行情接口超时' }
    );
    expect(next.stockError).toBe('行情接口超时');
    expect(next.phase).toBe('error');
  });
});

describe('stop', () => {
  it('phase 设为 stopped，所有 running flags 清空', () => {
    const dirty = {
      ...initialState,
      phase: 'analysts',
      klineLoading: true,
      secondRoundRunning: true,
      freeAskRunning: true,
    };
    const next = dispatch(dirty, { type: 'stop' });
    expect(next.phase).toBe('stopped');
    expect(next.klineLoading).toBe(false);
    expect(next.secondRoundRunning).toBe(false);
    expect(next.freeAskRunning).toBe(false);
  });
});

describe('phase', () => {
  it('直接切换 phase', () => {
    const next = dispatch(initialState, { type: 'phase', value: 'editor' });
    expect(next.phase).toBe('editor');
  });
});

/* ════════════════════════════════════════════════════════════════
   analyst_*  /  analysts_finalize_pending
   ════════════════════════════════════════════════════════════════ */
describe('analyst transitions', () => {
  it('analyst_pending 标记单个 analyst 为 pending', () => {
    const next = dispatch(initialState, { type: 'analyst_pending', id: 'value' });
    expect(next.analyses.value).toEqual({ status: 'pending' });
  });

  it('analyst_done 保存数据', () => {
    const data = { verdict: 'BUY', conviction: 4 };
    const next = dispatch(initialState, { type: 'analyst_done', id: 'value', data });
    expect(next.analyses.value).toEqual({ status: 'done', data });
  });

  it('analyst_error 保存 error + rawPreview + code', () => {
    const next = dispatch(initialState, {
      type: 'analyst_error', id: 'value',
      error: '超时', rawPreview: '部分内容...', code: 'TIMEOUT',
    });
    expect(next.analyses.value.status).toBe('error');
    expect(next.analyses.value.error).toBe('超时');
    expect(next.analyses.value.rawPreview).toBe('部分内容...');
    expect(next.analyses.value.code).toBe('TIMEOUT');
  });

  it('更新单个 analyst 不影响其他 analyst', () => {
    let s = dispatch(initialState, { type: 'analyst_done', id: 'value', data: { v: 1 } });
    s = dispatch(s, { type: 'analyst_error', id: 'tech', error: 'X' });
    expect(s.analyses.value).toEqual({ status: 'done', data: { v: 1 } });
    expect(s.analyses.tech.status).toBe('error');
  });

  it('analysts_finalize_pending 只 mark pending 的，不动 done/error', () => {
    const state = {
      ...initialState,
      analyses: {
        value: { status: 'done', data: { v: 1 } },
        tech: { status: 'pending' },
        macro: { status: 'error', error: 'X' },
        // risk 不存在 → 也应被标 error
      },
    };
    const next = dispatch(state, { type: 'analysts_finalize_pending' });
    expect(next.analyses.value.status).toBe('done');
    expect(next.analyses.tech.status).toBe('error');
    expect(next.analyses.tech.error).toBe('本次分析已停止');
    expect(next.analyses.macro.status).toBe('error');
    expect(next.analyses.macro.error).toBe('X');  // 原错误保留
    expect(next.analyses.risk.status).toBe('error');
  });
});

/* ════════════════════════════════════════════════════════════════
   editor_*
   ════════════════════════════════════════════════════════════════ */
describe('editor transitions', () => {
  it('editor_pending 设置 editorState + phase=editor', () => {
    const next = dispatch(initialState, { type: 'editor_pending' });
    expect(next.editorState.status).toBe('pending');
    expect(next.phase).toBe('editor');
  });

  it('editor_done 设置数据 + phase=done', () => {
    const data = { verdict: 'BUY' };
    const next = dispatch(initialState, { type: 'editor_done', data });
    expect(next.editorState).toEqual({ status: 'done', data });
    expect(next.phase).toBe('done');
  });

  it('editor_error 保存错误 + phase=done', () => {
    const next = dispatch(initialState, {
      type: 'editor_error', error: '超时', rawPreview: 'x', code: 'TIMEOUT',
    });
    expect(next.editorState.status).toBe('error');
    expect(next.editorState.error).toBe('超时');
    expect(next.phase).toBe('done');
  });

  it('editor_skip 只改 phase 不动 editorState', () => {
    const state = { ...initialState, editorState: { status: 'idle' } };
    const next = dispatch(state, { type: 'editor_skip' });
    expect(next.phase).toBe('done');
    expect(next.editorState).toEqual({ status: 'idle' });
  });

  it('editor_finalize_pending 只 mark pending 的', () => {
    const pending = { ...initialState, editorState: { status: 'pending' } };
    const np = dispatch(pending, { type: 'editor_finalize_pending' });
    expect(np.editorState.status).toBe('error');
    expect(np.editorState.error).toBe('本次分析已停止');

    const done = { ...initialState, editorState: { status: 'done', data: {} } };
    const nd = dispatch(done, { type: 'editor_finalize_pending' });
    expect(nd.editorState.status).toBe('done');  // 不变

    const nullState = dispatch(initialState, { type: 'editor_finalize_pending' });
    expect(nullState.editorState).toBeNull();
  });
});

/* ════════════════════════════════════════════════════════════════
   kline_*
   ════════════════════════════════════════════════════════════════ */
describe('kline transitions', () => {
  it('kline_loading toggle 状态', () => {
    const on = dispatch(initialState, { type: 'kline_loading', value: true });
    expect(on.klineLoading).toBe(true);
    const off = dispatch(on, { type: 'kline_loading', value: false });
    expect(off.klineLoading).toBe(false);
  });

  it('kline_data 设置数据并自动关掉 loading', () => {
    const data = [{ date: '2024-01-01', close: 100 }];
    const next = dispatch(
      { ...initialState, klineLoading: true },
      { type: 'kline_data', data }
    );
    expect(next.klineData).toBe(data);
    expect(next.klineLoading).toBe(false);
  });

  it('kline_range 只改 range', () => {
    const next = dispatch(initialState, { type: 'kline_range', value: 365 });
    expect(next.klineRange).toBe(365);
  });
});

/* ════════════════════════════════════════════════════════════════
   data_health
   ════════════════════════════════════════════════════════════════ */
describe('data_health', () => {
  it('浅合并 patch 到指定数据源', () => {
    const state = { ...initialState, dataHealth: makeInitialDataHealth() };
    const next = dispatch(state, {
      type: 'data_health', id: 'quote',
      patch: { status: 'ok', detail: '行情可用', source: '东方财富' },
    });
    expect(next.dataHealth.quote.status).toBe('ok');
    expect(next.dataHealth.quote.detail).toBe('行情可用');
    expect(next.dataHealth.quote.source).toBe('东方财富');
    expect(next.dataHealth.quote.label).toBe('行情');  // meta 不丢
  });

  it('未知 id 也能用，自动用 id 当 label', () => {
    const next = dispatch(initialState, {
      type: 'data_health', id: 'mystery',
      patch: { status: 'ok' },
    });
    expect(next.dataHealth.mystery.status).toBe('ok');
    expect(next.dataHealth.mystery.label).toBe('mystery');
  });

  it('多次 patch 累积，不互相覆盖未提及字段', () => {
    let s = initialState;
    s = dispatch(s, { type: 'data_health', id: 'quote', patch: { status: 'pending', detail: 'X' } });
    s = dispatch(s, { type: 'data_health', id: 'quote', patch: { status: 'ok' } });
    expect(s.dataHealth.quote.status).toBe('ok');
    expect(s.dataHealth.quote.detail).toBe('X');
  });
});

/* ════════════════════════════════════════════════════════════════
   set_data / baseline
   ════════════════════════════════════════════════════════════════ */
describe('set_data and baseline', () => {
  it('set_data 通用字段写入', () => {
    const fd = { quarters: [{ y: 2024 }] };
    const next = dispatch(initialState, { type: 'set_data', field: 'financialsData', value: fd });
    expect(next.financialsData).toBe(fd);
  });

  it('baseline 写入', () => {
    const b = { market: 'A', code: '000300', price: 4000 };
    const next = dispatch(initialState, { type: 'baseline', data: b });
    expect(next.baseline).toBe(b);
  });
});

/* ════════════════════════════════════════════════════════════════
   task_console
   ════════════════════════════════════════════════════════════════ */
describe('taskConsole transitions', () => {
  it('task_update 创建/合并 task', () => {
    let s = dispatch(initialState, {
      type: 'task_update', id: 'analyst:value',
      patch: { label: '价值派', status: 'pending', modelName: 'DeepSeek' },
    });
    expect(s.taskConsole['analyst:value']).toEqual({
      label: '价值派', status: 'pending', modelName: 'DeepSeek',
    });
    s = dispatch(s, {
      type: 'task_update', id: 'analyst:value',
      patch: { status: 'ok', ms: 2300 },
    });
    expect(s.taskConsole['analyst:value']).toMatchObject({
      label: '价值派', status: 'ok', ms: 2300, modelName: 'DeepSeek',
    });
  });

  it('task_finalize_pending 只动 pending 的 task', () => {
    const state = {
      ...initialState,
      taskConsole: {
        a: { status: 'pending', label: 'A' },
        b: { status: 'ok', label: 'B', ms: 100 },
        c: { status: 'error', label: 'C', error: 'X' },
      },
    };
    const next = dispatch(state, { type: 'task_finalize_pending' });
    expect(next.taskConsole.a.status).toBe('stopped');
    expect(next.taskConsole.a.error).toBe('用户停止');
    expect(next.taskConsole.b).toEqual({ status: 'ok', label: 'B', ms: 100 });
    expect(next.taskConsole.c).toEqual({ status: 'error', label: 'C', error: 'X' });
  });
});

/* ════════════════════════════════════════════════════════════════
   second_round_*
   ════════════════════════════════════════════════════════════════ */
describe('second round transitions', () => {
  const baseTopic = {
    topic: '估值是否合理',
    rebuttals: [{ analystName: '价值派', status: 'pending' }],
    editorFinal: null,
  };

  it('second_round_start 累加 topic 并标 running', () => {
    let s = dispatch(initialState, { type: 'second_round_start', topic: baseTopic });
    expect(s.secondRoundRunning).toBe(true);
    expect(s.secondRound.status).toBe('running');
    expect(s.secondRound.topics).toHaveLength(1);
    expect(s.secondRound.topics[0]).toBe(baseTopic);

    const topic2 = { ...baseTopic, topic: '增长持续性' };
    s = dispatch(s, { type: 'second_round_start', topic: topic2 });
    expect(s.secondRound.topics).toHaveLength(2);
    expect(s.secondRound.topics[1].topic).toBe('增长持续性');
  });

  it('second_round_update_topic 通过 mut 函数更新指定 idx', () => {
    let s = dispatch(initialState, { type: 'second_round_start', topic: baseTopic });
    s = dispatch(s, {
      type: 'second_round_update_topic', idx: 0,
      update: (t) => ({ ...t, editorFinal: { status: 'done', data: { v: 1 } } }),
    });
    expect(s.secondRound.topics[0].editorFinal.status).toBe('done');
  });

  it('second_round_update_topic 越界 idx 安全（不修改 state）', () => {
    let s = dispatch(initialState, { type: 'second_round_start', topic: baseTopic });
    const before = s.secondRound;
    const next = dispatch(s, {
      type: 'second_round_update_topic', idx: 99,
      update: (t) => ({ ...t, bogus: true }),
    });
    // topics 数组内容不应变化（注意 secondRound 对象本身可能被复制了）
    expect(next.secondRound.topics).toHaveLength(before.topics.length);
    expect(next.secondRound.topics[0]).toEqual(before.topics[0]);
  });

  it('second_round_update_topic secondRound 为 null 时不报错', () => {
    expect(() =>
      dispatch(initialState, {
        type: 'second_round_update_topic', idx: 0, update: (t) => t,
      })
    ).not.toThrow();
  });

  it('second_round_done 清掉 running 标记', () => {
    let s = dispatch(initialState, { type: 'second_round_start', topic: baseTopic });
    s = dispatch(s, { type: 'second_round_done' });
    expect(s.secondRoundRunning).toBe(false);
    expect(s.secondRound.topics).toHaveLength(1); // topics 保留
  });
});

/* ════════════════════════════════════════════════════════════════
   free_ask_*  (★ 验证 threadId 修复)
   ════════════════════════════════════════════════════════════════ */
describe('free ask transitions', () => {
  const makeThread = (id, q = '为何看多') => ({
    id, question: q,
    picks: ['value'],
    answers: [{ analystId: 'value', analystName: '价值派', status: 'pending' }],
    editorFinal: null,
  });

  it('free_ask_start 必须带 id 才能后续更新', () => {
    const thread = makeThread('free-123-abc');
    const next = dispatch(initialState, { type: 'free_ask_start', thread });
    expect(next.freeAskRunning).toBe(true);
    expect(next.freeAskThreads).toHaveLength(1);
    expect(next.freeAskThreads[0].id).toBe('free-123-abc');
  });

  it('free_ask_update 通过 threadId 精确定位（双击竞态修复）', () => {
    let s = dispatch(initialState, { type: 'free_ask_start', thread: makeThread('A') });
    s = dispatch(s, { type: 'free_ask_start', thread: makeThread('B', '为何看空') });

    // 更新 A 不应该影响 B
    s = dispatch(s, {
      type: 'free_ask_update', threadId: 'A',
      update: (t) => ({ ...t, answers: [{ analystId: 'value', status: 'done', data: { x: 1 } }] }),
    });
    expect(s.freeAskThreads).toHaveLength(2);
    expect(s.freeAskThreads[0].answers[0].status).toBe('done');
    expect(s.freeAskThreads[1].answers[0].status).toBe('pending');

    // 更新 B
    s = dispatch(s, {
      type: 'free_ask_update', threadId: 'B',
      update: (t) => ({ ...t, answers: [{ analystId: 'value', status: 'error', error: 'X' }] }),
    });
    expect(s.freeAskThreads[0].answers[0].status).toBe('done');  // A 还是 done
    expect(s.freeAskThreads[1].answers[0].status).toBe('error');
  });

  it('free_ask_update 未知 threadId 不报错，返回原 state', () => {
    let s = dispatch(initialState, { type: 'free_ask_start', thread: makeThread('A') });
    const before = s;
    const next = dispatch(s, {
      type: 'free_ask_update', threadId: 'GHOST',
      update: (t) => ({ ...t, bogus: true }),
    });
    expect(next).toBe(before);  // 引用相等：state 没变
  });

  it('free_ask_done 只清 running flag，thread 内容保留', () => {
    let s = dispatch(initialState, { type: 'free_ask_start', thread: makeThread('A') });
    s = dispatch(s, { type: 'free_ask_done' });
    expect(s.freeAskRunning).toBe(false);
    expect(s.freeAskThreads).toHaveLength(1);
  });
});

/* ════════════════════════════════════════════════════════════════
   unknown / fallthrough
   ════════════════════════════════════════════════════════════════ */
describe('unknown action', () => {
  it('返回原 state，不报错', () => {
    const next = dispatch(initialState, { type: 'never_heard_of_it' });
    expect(next).toBe(initialState);
  });
});

/* ════════════════════════════════════════════════════════════════
   完整 happy path 集成
   ════════════════════════════════════════════════════════════════ */
describe('happy path integration', () => {
  it('一次完整议会的状态轨迹', () => {
    let s = initialState;

    // 1. 启动
    s = dispatch(s, { type: 'start', ticker: '600519' });
    expect(s.phase).toBe('fetching');

    // 2. 拉行情成功
    s = dispatch(s, { type: 'quote_ready', data: { code: '600519', market: 'A', price: 1500 } });
    expect(s.phase).toBe('analysts');

    // 3. K 线返回
    s = dispatch(s, { type: 'kline_data', data: [{ date: '2024-01-01', close: 1500 }] });
    expect(s.klineLoading).toBe(false);

    // 4. 后台数据陆续返回
    s = dispatch(s, { type: 'set_data', field: 'financialsData', value: { quarters: [{}] } });
    s = dispatch(s, { type: 'set_data', field: 'consensusData', value: { data: {} } });
    s = dispatch(s, { type: 'set_data', field: 'newsData', value: { items: [{}] } });

    // 5. 四位分析师并发
    s = dispatch(s, { type: 'analyst_pending', id: 'value' });
    s = dispatch(s, { type: 'analyst_pending', id: 'tech' });
    s = dispatch(s, { type: 'analyst_pending', id: 'macro' });
    s = dispatch(s, { type: 'analyst_pending', id: 'risk' });
    s = dispatch(s, { type: 'analyst_done', id: 'value', data: { verdict: 'BUY' } });
    s = dispatch(s, { type: 'analyst_done', id: 'tech', data: { verdict: 'HOLD' } });
    s = dispatch(s, { type: 'analyst_done', id: 'macro', data: { verdict: 'BUY' } });
    s = dispatch(s, { type: 'analyst_error', id: 'risk', error: '超时' });
    expect(Object.keys(s.analyses)).toHaveLength(4);

    // 6. 主编
    s = dispatch(s, { type: 'editor_pending' });
    expect(s.phase).toBe('editor');
    s = dispatch(s, { type: 'editor_done', data: { verdict: 'BUY', dissent_areas: [{ topic: 'X' }] } });
    expect(s.phase).toBe('done');

    // 7. 二审
    s = dispatch(s, {
      type: 'second_round_start',
      topic: { topic: 'X', rebuttals: [], editorFinal: null },
    });
    expect(s.secondRoundRunning).toBe(true);
    s = dispatch(s, { type: 'second_round_done' });
    expect(s.secondRoundRunning).toBe(false);

    // 8. 自由追问
    s = dispatch(s, {
      type: 'free_ask_start',
      thread: { id: 't1', question: 'Q', picks: ['value'], answers: [], editorFinal: null },
    });
    s = dispatch(s, {
      type: 'free_ask_update', threadId: 't1',
      update: (t) => ({ ...t, editorFinal: { status: 'done', data: {} } }),
    });
    s = dispatch(s, { type: 'free_ask_done' });
    expect(s.freeAskRunning).toBe(false);
    expect(s.freeAskThreads[0].editorFinal.status).toBe('done');

    // 最终状态：phase=done，所有 running flag 都清空
    expect(s.phase).toBe('done');
    expect(s.secondRoundRunning).toBe(false);
    expect(s.freeAskRunning).toBe(false);
  });
});
