/* ──────────────────────────────────────────────────────────────────
   stockMentions 回归测试
   - 锁住 tokenizeWithMentions 的核心行为（本次重构删除了死代码）
   ────────────────────────────────────────────────────────────────── */

import { describe, it, expect } from 'vitest';
import { buildMentionDictionary, tokenizeWithMentions } from '../stockMentions';

const watchlist = [
  { code: '600519', name: '贵州茅台', market: 'A' },
  { code: 'AAPL', name: 'Apple Inc', market: 'US' },
];

const dict = buildMentionDictionary(watchlist, []);

describe('buildMentionDictionary', () => {
  it('收录自选股并为美股附加代码别名', () => {
    const aapl = dict.find((d) => d.code === 'AAPL');
    expect(aapl).toBeTruthy();
    expect(aapl.aliases).toContain('AAPL');
    const moutai = dict.find((d) => d.code === '600519');
    expect(moutai.aliases).toContain('贵州茅台');
  });

  it('过滤纯数字与过短别名', () => {
    const d2 = buildMentionDictionary([{ code: '000001', name: 'A' }], []);
    expect(d2[0].aliases).not.toContain('A');
    expect(d2[0].aliases).not.toContain('000001');
  });
});

describe('tokenizeWithMentions', () => {
  it('在中文段落中识别完整公司名', () => {
    const tokens = tokenizeWithMentions('本期看好贵州茅台的护城河。', dict);
    const mention = tokens.find((t) => t.type === 'mention');
    expect(mention).toBeTruthy();
    expect(mention.code).toBe('600519');
    expect(tokens.map((t) => t.value).join('')).toBe('本期看好贵州茅台的护城河。');
  });

  it('美股代码大小写不敏感且要求词边界', () => {
    const hit = tokenizeWithMentions('对比 aapl 的现金流。', dict);
    expect(hit.some((t) => t.type === 'mention' && t.code === 'AAPL')).toBe(true);
    // AAPLX 不应命中（右侧仍是字母）
    const miss = tokenizeWithMentions('AAPLX 不是同一家公司。', dict);
    expect(miss.every((t) => t.type !== 'mention')).toBe(true);
  });

  it('空字典时原样返回单个 text 段', () => {
    const tokens = tokenizeWithMentions('随便一段话', []);
    expect(tokens).toEqual([{ type: 'text', value: '随便一段话' }]);
  });

  it('相邻文本字符聚合为单个 text 段（重构后无碎片）', () => {
    const tokens = tokenizeWithMentions('前缀贵州茅台后缀', dict);
    expect(tokens.length).toBe(3);
    expect(tokens[0]).toEqual({ type: 'text', value: '前缀' });
    expect(tokens[2]).toEqual({ type: 'text', value: '后缀' });
  });
});
