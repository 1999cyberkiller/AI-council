const REQUEST_TIMEOUT_MS = 7000;

const tickerAliases = new Map([
  ["nvidia", "NVDA"],
  ["英伟达", "NVDA"],
  ["台积电", "TSM"],
  ["tsmc", "TSM"],
  ["apple", "AAPL"],
  ["苹果", "AAPL"],
  ["microsoft", "MSFT"],
  ["微软", "MSFT"],
  ["google", "GOOGL"],
  ["alphabet", "GOOGL"],
  ["amazon", "AMZN"],
  ["亚马逊", "AMZN"],
  ["meta", "META"],
  ["tesla", "TSLA"],
  ["特斯拉", "TSLA"],
  ["broadcom", "AVGO"],
  ["博通", "AVGO"],
  ["amd", "AMD"],
  ["asml", "ASML"]
]);

export function inferSymbols({ question, context }) {
  const text = `${question || ""}\n${context || ""}`;
  const symbols = new Set();
  const upperMatches = text.match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g) || [];

  for (const token of upperMatches) {
    if (!commonWords.has(token)) symbols.add(token);
  }

  const lowerText = text.toLowerCase();
  for (const [alias, ticker] of tickerAliases) {
    const normalizedAlias = alias.toLowerCase();
    if (lowerText.includes(normalizedAlias)) symbols.add(ticker);
  }

  return [...symbols].slice(0, 8);
}

export async function getMarketData({ question, context }) {
  const symbols = inferSymbols({ question, context });
  if (!symbols.length) {
    return skipped("market_data", "实时行情", "未识别到明确 ticker，因此未拉取行情。");
  }

  try {
    if (dataMode() === "paid" && process.env.ALPACA_API_KEY_ID && process.env.ALPACA_API_SECRET_KEY) {
      return await getAlpacaQuotes(symbols);
    }
    try {
      return await getYahooQuotes(symbols);
    } catch {
      return await getStooqQuotes(symbols);
    }
  } catch (error) {
    return failed("market_data", "实时行情", error);
  }
}

export async function getFundamentals({ question, context }) {
  const symbols = inferSymbols({ question, context });
  if (!symbols.length) {
    return skipped("fundamentals", "财报与基本面", "未识别到明确 ticker，因此未拉取财报数据。");
  }

  try {
    const mapping = await fetchSecTickerMap();
    const rows = [];
    for (const symbol of symbols) {
      const item = mapping.get(symbol.toUpperCase());
      if (!item) {
        rows.push({
          symbol,
          status: "skipped",
          note: "SEC 数据库未匹配该 ticker，可能是非美国上市主体或 ADR 映射缺失。"
        });
        continue;
      }
      rows.push(await fetchCompanyFacts(item));
    }

    return {
      id: "fundamentals",
      name: "财报与基本面",
      status: "ok",
      source: "SEC Company Facts API",
      generated_at: new Date().toISOString(),
      result: { companies: rows }
    };
  } catch (error) {
    return failed("fundamentals", "财报与基本面", error);
  }
}

export async function getWebResearch({ question, context }) {
  const query = buildResearchQuery(question, context);
  if (!query) {
    return skipped("web_research", "Web research", "问题为空，因此未执行检索。");
  }

  try {
    if (dataMode() === "paid" && process.env.BRAVE_SEARCH_API_KEY) {
      return await searchBrave(query);
    }
    if (dataMode() === "paid" && process.env.TAVILY_API_KEY) {
      return await searchTavily(query);
    }
    return await searchDuckDuckGo(query);
  } catch (error) {
    return failed("web_research", "Web research", error);
  }
}

async function getAlpacaQuotes(symbols) {
  const url = new URL("https://data.alpaca.markets/v2/stocks/quotes/latest");
  url.searchParams.set("symbols", symbols.join(","));

  const data = await fetchJson(url, {
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_API_KEY_ID,
      "APCA-API-SECRET-KEY": process.env.ALPACA_API_SECRET_KEY
    }
  });

  const quotes = symbols.map((symbol) => {
    const quote = data.quotes?.[symbol];
    return {
      symbol,
      bid: quote?.bp ?? null,
      ask: quote?.ap ?? null,
      bid_size: quote?.bs ?? null,
      ask_size: quote?.as ?? null,
      timestamp: quote?.t ?? null
    };
  });

  return {
    id: "market_data",
    name: "实时行情",
    status: "ok",
    source: "Alpaca Market Data",
    generated_at: new Date().toISOString(),
    result: { symbols, quotes }
  };
}

async function getYahooQuotes(symbols) {
  const quotes = await Promise.all(symbols.map(fetchYahooChart));
  return {
    id: "market_data",
    name: "实时行情",
    status: "ok",
    source: "Yahoo Finance chart endpoint",
    generated_at: new Date().toISOString(),
    result: { symbols, quotes }
  };
}

async function getStooqQuotes(symbols) {
  const quotes = await Promise.all(symbols.map(fetchStooqQuote));
  return {
    id: "market_data",
    name: "实时行情",
    status: "ok",
    source: "Stooq CSV",
    generated_at: new Date().toISOString(),
    result: { symbols, quotes }
  };
}

async function fetchStooqQuote(symbol) {
  const url = new URL("https://stooq.com/q/l/");
  url.searchParams.set("s", `${symbol.toLowerCase()}.us`);
  url.searchParams.set("f", "sd2t2ohlcv");
  url.searchParams.set("h", "");
  url.searchParams.set("e", "csv");

  const csv = await fetchText(url, {
    headers: { "user-agent": "AI-Finance-Council/0.1" }
  });
  const [, row] = csv.trim().split(/\r?\n/);
  const [returnedSymbol, date, time, open, high, low, close, volume] = parseCsvRow(row || "");
  const price = toNumber(close);
  return {
    symbol,
    returned_symbol: returnedSymbol || null,
    currency: "USD",
    exchange: null,
    regular_market_price: price,
    previous_close: null,
    last_close: price,
    open: toNumber(open),
    high: toNumber(high),
    low: toNumber(low),
    volume: toNumber(volume),
    change_pct: null,
    timestamp: date && time && date !== "N/D" ? `${date}T${time}Z` : null
  };
}

async function fetchYahooChart(symbol) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", "5d");
  url.searchParams.set("interval", "1d");

  const data = await fetchJson(url, {
    headers: { "user-agent": "AI-Finance-Council/0.1" }
  });
  const result = data.chart?.result?.[0];
  const meta = result?.meta || {};
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const opens = quote.open || [];
  const volumes = quote.volume || [];
  const lastIndex = [...closes].map((value, index) => ({ value, index })).reverse().find((item) => item.value != null)?.index;
  const prevIndex = lastIndex > 0 ? lastIndex - 1 : null;
  const lastClose = lastIndex != null ? closes[lastIndex] : null;
  const prevClose = prevIndex != null ? closes[prevIndex] : null;

  return {
    symbol,
    currency: meta.currency || null,
    exchange: meta.exchangeName || null,
    regular_market_price: meta.regularMarketPrice ?? lastClose,
    previous_close: meta.previousClose ?? prevClose,
    last_close: lastClose,
    open: lastIndex != null ? opens[lastIndex] : null,
    volume: lastIndex != null ? volumes[lastIndex] : null,
    change_pct: pctChange(meta.regularMarketPrice ?? lastClose, meta.previousClose ?? prevClose),
    timestamp: lastIndex != null && timestamps[lastIndex]
      ? new Date(timestamps[lastIndex] * 1000).toISOString()
      : null
  };
}

async function fetchSecTickerMap() {
  const data = await fetchJson("https://www.sec.gov/files/company_tickers.json", secHeaders());
  const mapping = new Map();
  for (const item of Object.values(data)) {
    mapping.set(String(item.ticker).toUpperCase(), {
      cik: String(item.cik_str).padStart(10, "0"),
      ticker: String(item.ticker).toUpperCase(),
      title: item.title
    });
  }
  return mapping;
}

async function fetchCompanyFacts(company) {
  const data = await fetchJson(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`,
    secHeaders()
  );
  const facts = mergeTaxonomies(data.facts || {});
  return {
    symbol: company.ticker,
    company: company.title,
    cik: company.cik,
    metrics: {
      revenue: latestFact(firstFact(facts, [
        "Revenues",
        "Revenue",
        "SalesRevenueNet",
        "RevenueFromContractsWithCustomers",
        "RevenueFromSaleOfGoods"
      ])),
      net_income: latestFact(firstFact(facts, [
        "NetIncomeLoss",
        "ProfitLoss",
        "AccountingProfit",
        "ProfitLossAttributableToOwnersOfParent"
      ])),
      operating_income: latestFact(firstFact(facts, [
        "OperatingIncomeLoss",
        "OperatingProfitLoss",
        "ProfitLossFromOperatingActivities"
      ])),
      diluted_eps: latestFact(firstFact(facts, [
        "EarningsPerShareDiluted",
        "DilutedEarningsLossPerShare"
      ])),
      assets: latestFact(firstFact(facts, ["Assets"])),
      liabilities: latestFact(firstFact(facts, ["Liabilities"])),
      equity: latestFact(firstFact(facts, [
        "StockholdersEquity",
        "Equity",
        "EquityAttributableToOwnersOfParent"
      ]))
    }
  };
}

function mergeTaxonomies(facts) {
  return Object.values(facts).reduce((merged, taxonomy) => ({ ...merged, ...taxonomy }), {});
}

function firstFact(facts, candidates) {
  return candidates.map((name) => facts[name]).find(Boolean);
}

function latestFact(fact) {
  const unitGroups = fact?.units || {};
  const rows = Object.values(unitGroups).flat().filter((row) => row.fy && row.fp && row.val != null);
  rows.sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")));
  const row = rows[0];
  if (!row) return null;
  return {
    value: row.val,
    unit: row.form === "10-Q" ? "quarter" : "annual",
    period: row.fp,
    fiscal_year: row.fy,
    end: row.end,
    form: row.form,
    filed: row.filed
  };
}

async function searchBrave(query) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "6");
  url.searchParams.set("freshness", "pm");

  const data = await fetchJson(url, {
    headers: {
      accept: "application/json",
      "x-subscription-token": process.env.BRAVE_SEARCH_API_KEY
    }
  });

  return {
    id: "web_research",
    name: "Web research",
    status: "ok",
    source: "Brave Search API",
    generated_at: new Date().toISOString(),
    result: {
      query,
      results: (data.web?.results || []).slice(0, 6).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.description
      }))
    }
  };
}

async function searchTavily(query) {
  const data = await fetchJson("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: 6
    })
  });

  return {
    id: "web_research",
    name: "Web research",
    status: "ok",
    source: "Tavily Search API",
    generated_at: new Date().toISOString(),
    result: {
      query,
      results: (data.results || []).slice(0, 6).map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.content
      }))
    }
  };
}

async function searchDuckDuckGo(query) {
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const html = await fetchText(url, {
    headers: { "user-agent": "AI-Finance-Council/0.1" }
  });

  const results = [...html.matchAll(/<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)]
    .slice(0, 6)
    .map((match) => ({
      title: cleanHtml(match[2]),
      url: decodeDuckUrl(match[1]),
      snippet: cleanHtml(match[3])
    }));

  return {
    id: "web_research",
    name: "Web research",
    status: results.length ? "ok" : "skipped",
    source: "DuckDuckGo HTML",
    generated_at: new Date().toISOString(),
    result: {
      query,
      results,
      note: results.length ? undefined : "未解析到检索结果。建议配置 Brave 或 Tavily key。"
    }
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`数据源返回非 JSON 内容：${text.slice(0, 160)}`);
  }
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || response.statusText);
  }
  return data;
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(text.slice(0, 160) || response.statusText);
  return text;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildResearchQuery(question, context) {
  const symbols = inferSymbols({ question, context });
  const symbolText = symbols.length ? ` ${symbols.join(" ")}` : "";
  return `${question || ""}${symbolText} earnings valuation outlook latest`.trim();
}

function secHeaders() {
  return {
    headers: {
      "user-agent": process.env.SEC_USER_AGENT || "AI-Finance-Council contact@example.com",
      accept: "application/json"
    }
  };
}

function dataMode() {
  return String(process.env.DATA_MODE || "free").toLowerCase();
}

function parseCsvRow(row) {
  const values = [];
  let current = "";
  let quoted = false;
  for (const char of row) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function skipped(id, name, reason) {
  return {
    id,
    name,
    status: "skipped",
    source: "local",
    generated_at: new Date().toISOString(),
    result: { reason }
  };
}

function failed(id, name, error) {
  return {
    id,
    name,
    status: "error",
    source: "external",
    generated_at: new Date().toISOString(),
    result: { error: error.message || String(error) }
  };
}

function pctChange(current, previous) {
  const a = Number(current);
  const b = Number(previous);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Number((((a - b) / b) * 100).toFixed(2));
}

function cleanHtml(value) {
  return String(value)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeDuckUrl(value) {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.href;
  } catch {
    return value;
  }
}

const commonWords = new Set([
  "AI",
  "API",
  "CEO",
  "CFO",
  "EPS",
  "ETF",
  "GDP",
  "IPO",
  "PE",
  "PCE",
  "ROE",
  "SEC",
  "USA",
  "USD"
]);
