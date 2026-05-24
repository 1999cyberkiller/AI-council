/**
 * models.js 单元测试
 *
 * 直接回归保护 Task 2 的修复：
 * - HTTP status code 决定可重试性，正则匹配错误正文已废弃
 * - "got 400 results back" 这类错误文本不再被误判为 HTTP 400
 * - AbortError 永远不重试
 *
 * 运行：npx vitest run src/api/__tests__/models.test.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  makeProxyError,
  isRetryable,
  withRetry,
  callModel,
  resolveVariant,
  DEFAULT_MODELS,
} from '../models.js';

/* ════════════════════════════════════════════════════════════════
   makeProxyError —— 错误对象形状
   ════════════════════════════════════════════════════════════════ */
describe('makeProxyError', () => {
  it('返回 Error 实例，message/status 字段正确', () => {
    const err = makeProxyError('DeepSeek 504 timeout', 504);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('DeepSeek 504 timeout');
    expect(err.status).toBe(504);
  });

  it('status 可以是 0（网络层错误）', () => {
    const err = makeProxyError('Network unreachable', 0);
    expect(err.status).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════
   isRetryable —— Task 2 核心修复
   ════════════════════════════════════════════════════════════════ */
describe('isRetryable', () => {
  describe('可重试 (返回 true)', () => {
    it('status === 0（网络层）', () => {
      expect(isRetryable(makeProxyError('network', 0))).toBe(true);
    });
    it('status === 408 (request timeout)', () => {
      expect(isRetryable(makeProxyError('timeout', 408))).toBe(true);
    });
    it('status === 429 (rate limited)', () => {
      expect(isRetryable(makeProxyError('rate limited', 429))).toBe(true);
    });
    it.each([500, 502, 503, 504, 599])('status === %d (5xx)', (status) => {
      expect(isRetryable(makeProxyError(`server error ${status}`, status))).toBe(true);
    });
  });

  describe('不可重试 (返回 false)', () => {
    it.each([400, 401, 403, 404, 418, 422])('status === %d (4xx 客户端错误)', (status) => {
      expect(isRetryable(makeProxyError(`client error ${status}`, status))).toBe(false);
    });

    it('status === 200 (理论上不该到这，但仍 false)', () => {
      expect(isRetryable(makeProxyError('ok?', 200))).toBe(false);
    });

    it('status === 600 (超出 5xx 范围)', () => {
      expect(isRetryable(makeProxyError('huh', 600))).toBe(false);
    });

    it('status === 499 (小于 500 的不重试)', () => {
      expect(isRetryable(makeProxyError('canceled', 499))).toBe(false);
    });

    it('error.name === "AbortError" 永远不重试，即使 status 是 5xx', () => {
      const err = makeProxyError('aborted', 504);
      err.name = 'AbortError';
      expect(isRetryable(err)).toBe(false);
    });

    it('普通 Error（无 status 字段）不重试', () => {
      const err = new Error('something broke');
      expect(isRetryable(err)).toBe(false);
    });

    it('status 是字符串而不是数字 → 不重试', () => {
      const err = new Error('weird');
      err.status = '500';
      expect(isRetryable(err)).toBe(false);
    });

    it('null/undefined 安全处理', () => {
      expect(isRetryable(null)).toBe(false);
      expect(isRetryable(undefined)).toBe(false);
    });
  });

  /* ★★★ Task 2 修复的核心回归 ★★★ */
  describe('Task 2 回归：错误正文里的数字不再误导', () => {
    it('错误正文 "got 400 results back" 不会被当成 HTTP 400', () => {
      // 旧实现用 /\b(400|401|403|404)\b/.test(msg) 会误判
      // 新实现只看 error.status，正文里的数字无关
      const err = makeProxyError('Upstream returned: got 400 results back, parse failed', 502);
      expect(isRetryable(err)).toBe(true);
    });

    it('错误正文里的 "401 Unauthorized" 字样不影响（看的是 status）', () => {
      const err = makeProxyError('Got 503 but message says 401 somewhere', 503);
      expect(isRetryable(err)).toBe(true);
    });

    it('错误正文里出现 "500" 但实际 status 是 401 → 不重试（避免在鉴权失败时浪费 retry）', () => {
      const err = makeProxyError('Auth failed (debug code 500-xyz)', 401);
      expect(isRetryable(err)).toBe(false);
    });
  });
});

/* ════════════════════════════════════════════════════════════════
   withRetry —— 重试控制流
   ════════════════════════════════════════════════════════════════ */
describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('第一次成功就不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, 2);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('第一次可重试错误 + 第二次成功 → 共 2 次调用', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(makeProxyError('502 boom', 502))
      .mockResolvedValueOnce('ok');
    const promise = withRetry(fn, 2);
    // 推进退避计时（800ms）
    await vi.advanceTimersByTimeAsync(900);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('两次都失败 → 抛最后一个错', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(makeProxyError('first 502', 502))
      .mockRejectedValueOnce(makeProxyError('second 503', 503));
    // .catch 立即附 handler，避免 fake-timer 下的 unhandled rejection
    const captured = withRetry(fn, 2).catch((e) => e);
    await vi.advanceTimersByTimeAsync(900);
    const err = await captured;
    expect(err.message).toBe('second 503');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('不可重试错误（401）立即抛，不调第二次', async () => {
    const fn = vi.fn().mockRejectedValueOnce(makeProxyError('401 unauthorized', 401));
    await expect(withRetry(fn, 2)).rejects.toThrow('401 unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('AbortError 立即抛，不重试（即使 status 是 502）', async () => {
    const err = makeProxyError('canceled', 502);
    err.name = 'AbortError';
    const fn = vi.fn().mockRejectedValueOnce(err);
    await expect(withRetry(fn, 2)).rejects.toThrow('canceled');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('maxAttempts=3 时最多调 3 次', async () => {
    const fn = vi.fn().mockRejectedValue(makeProxyError('always 502', 502));
    const captured = withRetry(fn, 3).catch((e) => e);
    await vi.advanceTimersByTimeAsync(800);   // 第 1 次失败后等 800
    await vi.advanceTimersByTimeAsync(1600);  // 第 2 次失败后等 1600
    const err = await captured;
    expect(err.message).toBe('always 502');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

/* ════════════════════════════════════════════════════════════════
   callModel —— 入口层的校验
   ════════════════════════════════════════════════════════════════ */
describe('callModel input validation', () => {
  const model = DEFAULT_MODELS[0];

  it('空 API Key 抛 401 status', async () => {
    try {
      await callModel(model, '', 'sys', 'user');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(401);
      expect(err.message).toContain('未配置');
    }
  });

  it('空白 API Key（只有空格）抛 401 status', async () => {
    try {
      await callModel(model, '   ', 'sys', 'user');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(401);
    }
  });

  it('未知 variant 抛 status=0（custom model 无 modelName 时）', async () => {
    const brokenCustom = { id: 'custom-x', name: 'X', custom: true, modelName: '', maxTokens: 0 };
    // 触发 resolveVariant 返回 { id: '' } —— 仍然有 variant，所以这测试不适合
    // 真正的 "未找到 variant" 走在普通 model 但 variants 为空的情况
    const noVariants = { id: 'broken', name: 'Broken', custom: false, variants: [] };
    try {
      await callModel(noVariants, 'somekey', 'sys', 'user');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(0);
      expect(err.message).toContain('变体');
    }
  });
});

/* ════════════════════════════════════════════════════════════════
   resolveVariant —— 选型逻辑
   ════════════════════════════════════════════════════════════════ */
describe('resolveVariant', () => {
  const model = DEFAULT_MODELS.find((m) => m.id === 'deepseek');

  it('给定的 variantId 存在 → 返回该 variant', () => {
    const v = resolveVariant(model, 'deepseek-reasoner');
    expect(v.id).toBe('deepseek-reasoner');
    expect(v.reasoning).toBe(true);
  });

  it('未指定 variantId → 回退到 defaultVariant', () => {
    const v = resolveVariant(model, undefined);
    expect(v.id).toBe('deepseek-chat');
  });

  it('指定不存在的 variantId → 回退到 defaultVariant', () => {
    const v = resolveVariant(model, 'nonexistent');
    expect(v.id).toBe('deepseek-chat');
  });

  it('custom model 直接用 modelName 当 id/label', () => {
    const custom = {
      id: 'cx', name: 'CX', custom: true,
      modelName: 'my-finetune-v2',
      maxTokens: 3000,
    };
    const v = resolveVariant(custom, null);
    expect(v.id).toBe('my-finetune-v2');
    expect(v.label).toBe('my-finetune-v2');
    expect(v.maxTokens).toBe(3000);
  });

  it('custom model 没指定 maxTokens 时用默认 2000', () => {
    const custom = { id: 'cx', name: 'CX', custom: true, modelName: 'x' };
    const v = resolveVariant(custom, null);
    expect(v.maxTokens).toBe(2000);
  });
});
