/* ──────────────────────────────────────────────────────────────────
   STOCK MENTIONS · 在专栏正文里识别可跳转的股票名称
   - 字典来自 watchlist + history（用户已知集合）
   - 匹配优先级：完整名 > 简称 > 代码
   - 避免误匹配：不匹配纯英文小写词、过短中文（<2 字）
   ────────────────────────────────────────────────────────────────── */

/**
 * 从已知数据中构建字典
 * @param {Array} watchlist  自选股 [{ code, name, market }]
 * @param {Array} history    历史档案
 * @returns {Array<{ code, name, market, aliases }>}
 */
export function buildMentionDictionary(watchlist = [], history = []) {
  const map = new Map(); // code → entry

  const addEntry = (item) => {
    if (!item || !item.code) return;
    const code = String(item.code).toUpperCase();
    if (!map.has(code)) {
      map.set(code, {
        code,
        name: item.name || code,
        market: item.market || (/^\d{6}$/.test(code) ? 'A' : 'US'),
        aliases: new Set(),
      });
    }
    const entry = map.get(code);
    if (item.name) entry.aliases.add(item.name);
    // 美股 code 本身可作为别名（"AAPL"）
    if (entry.market === 'US') entry.aliases.add(code);
  };

  watchlist.forEach(addEntry);
  history.forEach((h) => {
    if (h?.stockData) addEntry(h.stockData);
  });

  return Array.from(map.values()).map((e) => ({
    ...e,
    aliases: Array.from(e.aliases).filter((a) => isMatchable(a)),
  }));
}

/**
 * 判断一个别名是否值得加入匹配池：
 * - 长度 ≥ 2（避免单字误匹配）
 * - 不是纯数字（避免匹配"2024"等）
 * - 不是常见英文 stop words
 */
const STOP_WORDS = new Set([
  'THE', 'AND', 'BUY', 'SELL', 'HOLD', 'PE', 'PB', 'ROE', 'EPS', 'GDP', 'CPI',
  'A股', '美股', 'A 股', '美 股',
]);

function isMatchable(s) {
  if (!s || typeof s !== 'string') return false;
  if (s.length < 2) return false;
  if (/^\d+$/.test(s)) return false;
  if (STOP_WORDS.has(s.toUpperCase())) return false;
  return true;
}

/**
 * 把一段文本拆成 [text, mention, text, mention, ...] 段
 * 用于 React 渲染：text 段直接显示，mention 段渲染为可点击
 *
 * @param {string} text   原始文本
 * @param {Array} dict    字典 [{ code, name, market, aliases }]
 * @returns {Array<{ type: 'text'|'mention', value: string, code?, name?, market? }>}
 */
export function tokenizeWithMentions(text, dict) {
  if (!text || !dict || dict.length === 0) {
    return [{ type: 'text', value: text || '' }];
  }

  // 构建匹配列表：把所有 aliases 拍平 + 按长度降序（长的优先匹配）
  const candidates = [];
  dict.forEach((entry) => {
    entry.aliases.forEach((alias) => {
      candidates.push({ alias, entry });
    });
  });
  candidates.sort((a, b) => b.alias.length - a.alias.length);

  // 用占位符替换法做不重叠的多模式匹配
  // 简单实现：遍历文本，每个位置尝试匹配最长的字典词
  const tokens = [];
  let cursor = 0;
  const lower = text.toLowerCase(); // 美股代码可能小写形式出现

  while (cursor < text.length) {
    let matched = null;
    for (const { alias, entry } of candidates) {
      // 中文别名严格大小写；英文大小写不敏感
      const aliasLower = alias.toLowerCase();
      const slice = text.substr(cursor, alias.length);
      const sliceLower = lower.substr(cursor, alias.length);
      const isChinese = /[\u4e00-\u9fa5]/.test(alias);

      if (isChinese ? slice === alias : sliceLower === aliasLower) {
        // 英文额外检查：必须是词边界（前后不是英文字符或数字）
        if (!isChinese) {
          const before = cursor > 0 ? text[cursor - 1] : ' ';
          const after = cursor + alias.length < text.length ? text[cursor + alias.length] : ' ';
          if (/[a-zA-Z0-9]/.test(before) || /[a-zA-Z0-9]/.test(after)) {
            continue;
          }
        }
        matched = { alias, entry, length: alias.length };
        break; // 因为已按长度降序，第一个命中就是最长的
      }
    }

    if (matched) {
      // push 已经累积的 text
      const pendingStart = tokens.length > 0 && tokens[tokens.length - 1].type === 'mention'
        ? tokens.findLastIndex((t) => t.type === 'mention') + 1
        : 0;
      // mention
      tokens.push({
        type: 'mention',
        value: text.substr(cursor, matched.length),
        code: matched.entry.code,
        name: matched.entry.name,
        market: matched.entry.market,
      });
      cursor += matched.length;
    } else {
      // 没匹配：吃一个字符到 pending
      const last = tokens[tokens.length - 1];
      if (last && last.type === 'text') {
        last.value += text[cursor];
      } else {
        tokens.push({ type: 'text', value: text[cursor] });
      }
      cursor += 1;
    }
  }

  return tokens;
}
