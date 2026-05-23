/* ──────────────────────────────────────────────────────────────────
   FINANCIALS · 最近 4 季度财务数据
   - A 股：东方财富 datacenter-web RPT_LICO_FN_CPD
   - 美股：Finnhub /stock/financials-reported
   - 缓存：12 小时 TTL（季度数据变化慢）
   - 优雅降级：失败返回 null，不阻塞议会

   返回的统一形态：
   {
     quarters: [
       { period: 'YYYY-MM-DD', revenue, revenueYoY, netIncome, netIncomeYoY,
         grossMargin, netMargin, roe, debtRatio, cfoToNI },
       ... (最多 4 条，最新在前)
     ]
   }
   - 所有数字字段单位：YoY/margin/roe/debtRatio = 百分比小数 (0.235 = 23.5%)
                     revenue/netIncome = 原始货币（A股：元；美股：USD）
                     cfoToNI = 比率（无单位）
   - 字段为 null 表示该指标无法计算
   ────────────────────────────────────────────────────────────────── */

import { fetchEastmoney, fetchWithTimeout } from './jsonp';

const FIN_CACHE_PREFIX = 'dispatch:fin:v1:';
const FIN_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

function cacheGet(key) {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.sessionStorage.getItem(FIN_CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() - entry.t > FIN_TTL_MS) {
      window.sessionStorage.removeItem(FIN_CACHE_PREFIX + key);
      return null;
    }
    return entry.v;
  } catch { return null; }
}
function cacheSet(key, value) {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(FIN_CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch {}
}

/* ──────────────────────────────────────────────────────────────
   A 股：东方财富 RPT_LICO_FN_CPD（综合财务指标）
   字段名基于 AKShare 等开源项目验证
   ────────────────────────────────────────────────────────────── */
async function fetchAShareFinancials(code) {
  const url =
    `https://datacenter-web.eastmoney.com/api/data/v1/get` +
    `?sortColumns=REPORT_DATE&sortTypes=-1&pageSize=8&pageNumber=1` +
    `&reportName=RPT_LICO_FN_CPD&columns=ALL` +
    `&filter=(SECURITY_CODE%3D%22${encodeURIComponent(code)}%22)`;
  try {
    const r = await fetchEastmoney(url);
    const d = await r.json();
    const rows = d?.result?.data;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    // 取最近 4 个季度
    const recent = rows.slice(0, 4);
    const quarters = recent.map((row) => {
      const period = (row.REPORT_DATE || '').slice(0, 10);
      // 字段名可能因东方财富改造而变，做防御性读取
      const revenue       = num(row.TOTAL_OPERATE_INCOME) ?? num(row.REVENUE);
      const revenueYoY    = pct(row.YOY_TOTAL_OPERATE_INCOME ?? row.OPERATE_INCOME_YOY);
      const netIncome     = num(row.PARENT_NETPROFIT) ?? num(row.NETPROFIT);
      const netIncomeYoY  = pct(row.YOY_PARENT_NETPROFIT ?? row.NETPROFIT_YOY);
      const grossMargin   = pct(row.GROSS_PROFIT_RATIO ?? row.GROSSPROFIT_MARGIN);
      const netMargin     = pct(row.PARENT_NETPROFIT_RATIO ?? row.NETPROFIT_MARGIN);
      const roe           = pct(row.WEIGHTAVG_ROE ?? row.ROE_AVG);
      const debtRatio     = pct(row.DEBT_ASSET_RATIO ?? row.DEBTASSETRATIO);
      const cfoToNI       = ratio(row.NETCASH_OPERATE, row.PARENT_NETPROFIT ?? row.NETPROFIT);
      return { period, revenue, revenueYoY, netIncome, netIncomeYoY, grossMargin, netMargin, roe, debtRatio, cfoToNI };
    });
    return { quarters };
  } catch (e) {
    console.debug('[financials] A股 财务拉取失败:', e?.message);
    return null;
  }
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
function pct(v) {
  // 东方财富 ROE/margin 通常返回百分比（如 23.5 表 23.5%），不要再除 100
  // YoY 同理
  const n = num(v);
  return n == null ? null : n / 100;
}
function ratio(a, b) {
  const na = num(a), nb = num(b);
  if (na == null || nb == null || nb === 0) return null;
  return na / nb;
}

/* ──────────────────────────────────────────────────────────────
   美股：Finnhub /stock/financials-reported
   ────────────────────────────────────────────────────────────── */
async function fetchUSFinancials(symbol, finnhubKey) {
  if (!finnhubKey) return { _needsKey: true };
  const url = `https://finnhub.io/api/v1/stock/financials-reported?symbol=${encodeURIComponent(symbol)}&freq=quarterly&token=${finnhubKey}`;
  try {
    const r = await fetchWithTimeout(url, 10000);
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new Error('Finnhub key 无效');
      if (r.status === 429) throw new Error('Finnhub 频率限制');
      throw new Error(`Finnhub HTTP ${r.status}`);
    }
    const d = await r.json();
    const reports = d?.data;
    if (!Array.isArray(reports) || reports.length === 0) return null;

    // Finnhub 返回 SEC 报告，按 endDate 降序排
    const recent = reports.slice(0, 4);
    const quarters = recent.map((rep) => {
      const period = rep.endDate || rep.startDate || '';
      // SEC 报告字段在 rep.report.ic (income), .bs (balance), .cf (cashflow)
      const ic = (rep.report?.ic || []).reduce((acc, item) => { acc[item.concept] = item.value; return acc; }, {});
      const bs = (rep.report?.bs || []).reduce((acc, item) => { acc[item.concept] = item.value; return acc; }, {});
      const cf = (rep.report?.cf || []).reduce((acc, item) => { acc[item.concept] = item.value; return acc; }, {});

      // 字段名 mapping（US GAAP / IFRS 都尝试）
      const revenue = ic['us-gaap_Revenues']
        ?? ic['us-gaap_SalesRevenueNet']
        ?? ic['us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax']
        ?? null;
      const netIncome = ic['us-gaap_NetIncomeLoss']
        ?? ic['us-gaap_ProfitLoss']
        ?? null;
      const grossProfit = ic['us-gaap_GrossProfit'] ?? null;
      const totalAssets = bs['us-gaap_Assets'] ?? null;
      const totalLiab = bs['us-gaap_Liabilities'] ?? null;
      const stockEquity = bs['us-gaap_StockholdersEquity']
        ?? bs['us-gaap_StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest']
        ?? null;
      const cfo = cf['us-gaap_NetCashProvidedByUsedInOperatingActivities']
        ?? cf['us-gaap_NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']
        ?? null;

      return {
        period: typeof period === 'string' ? period.slice(0, 10) : period,
        revenue,
        revenueYoY: null,  // 后处理填充
        netIncome,
        netIncomeYoY: null,
        grossMargin: (grossProfit && revenue && revenue !== 0) ? grossProfit / revenue : null,
        netMargin: (netIncome != null && revenue && revenue !== 0) ? netIncome / revenue : null,
        roe: (netIncome != null && stockEquity && stockEquity !== 0) ? netIncome / stockEquity : null,
        debtRatio: (totalLiab != null && totalAssets && totalAssets !== 0) ? totalLiab / totalAssets : null,
        cfoToNI: (cfo != null && netIncome && netIncome !== 0) ? cfo / netIncome : null,
      };
    });

    // 后处理：计算 YoY（同比，需要 t-4 季度数据；只能算前 N-4 个）
    // 但我们只有 4 季度，所以拿全部 8 季度算更靠谱。这里简化：跳过 YoY 计算，让 prompt 文本以"-"标注
    return { quarters };
  } catch (e) {
    console.debug('[financials] 美股 财务拉取失败:', e?.message);
    return null;
  }
}

/* ──────────────────────────────────────────────────────────────
   公开 API：resolveFinancials
   ────────────────────────────────────────────────────────────── */
export async function resolveFinancials(stockData, finnhubKey, opts = {}) {
  if (!stockData || !stockData.code) {
    return { quarters: [], hasMissingKey: false, market: null };
  }
  const cacheKey = `${stockData.market}:${stockData.code}`;
  if (!opts.bypassCache) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  let quarters = [];
  let hasMissingKey = false;

  if (stockData.market === 'A') {
    const r = await fetchAShareFinancials(stockData.code);
    if (r) quarters = r.quarters;
  } else if (stockData.market === 'US') {
    const r = await fetchUSFinancials(stockData.code, finnhubKey);
    if (r?._needsKey) {
      hasMissingKey = true;
    } else if (r) {
      quarters = r.quarters;
    }
  }

  const result = { quarters, hasMissingKey, market: stockData.market };
  cacheSet(cacheKey, result);
  return result;
}

/**
 * 把财务数据格式化为简洁的中文文本，注入到 LLM prompt
 * @param {Object} financialsData
 * @returns {string} 简洁文本，约 200-300 token
 */
export function formatFinancialsForPrompt(financialsData) {
  if (!financialsData || !Array.isArray(financialsData.quarters) || financialsData.quarters.length === 0) {
    return '';
  }
  const lines = ['【最近季度财务】'];
  financialsData.quarters.forEach((q, i) => {
    if (!q || !q.period) return;
    const tag = i === 0 ? '最新' : `T-${i}`;
    const cells = [];
    if (q.revenueYoY != null) cells.push(`营收 YoY ${pctFmt(q.revenueYoY)}`);
    if (q.netIncomeYoY != null) cells.push(`净利 YoY ${pctFmt(q.netIncomeYoY)}`);
    if (q.grossMargin != null) cells.push(`毛利率 ${pctFmt(q.grossMargin)}`);
    if (q.netMargin != null) cells.push(`净利率 ${pctFmt(q.netMargin)}`);
    if (q.roe != null) cells.push(`ROE ${pctFmt(q.roe)}`);
    if (q.debtRatio != null) cells.push(`资产负债率 ${pctFmt(q.debtRatio)}`);
    if (q.cfoToNI != null) cells.push(`经营现金/净利 ${q.cfoToNI.toFixed(2)}`);
    if (cells.length > 0) {
      lines.push(`${tag} ${q.period}: ${cells.join('；')}`);
    }
  });
  if (lines.length === 1) return ''; // 没有可显示的数据
  return lines.join('\n');
}

function pctFmt(v) {
  if (v == null) return '—';
  const pct = v * 100;
  if (Math.abs(pct) >= 1000) return `${(pct / 100).toFixed(0)}x`;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}
