const state = {
  config: null,
  loading: false,
  loadingTimer: null,
  loadingProgress: 0,
  loadingTick: 0,
  loadingStartedAt: 0,
  loadingMembers: []
};

const glyphSet = "01MAGI$#<>[]{}+-=/\\AXIOMRISKCNUS";
const defaultLoadingModels = ["DeepSeek", "Gemini", "Grok", "MINIMAX 2.7"];

const briefForm = document.querySelector("#briefForm");
const questionEl = document.querySelector("#question");
const runButton = document.querySelector("#runButton");
const decisionPanel = document.querySelector("#decisionPanel");
const membersEl = document.querySelector("#members");
const councilList = document.querySelector("#councilList");
const toolList = document.querySelector("#toolList");
const statusEl = document.querySelector("#status");
const toolEvidence = document.querySelector("#toolEvidence");

briefForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runCouncil();
});

loadConfig();

async function loadConfig() {
  const response = await fetch("/api/config");
  state.config = await response.json();
  renderConfig();
}

async function runCouncil() {
  setLoading(true);
  startLoadingSequence();
  membersEl.innerHTML = "";
  toolEvidence.innerHTML = "";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: questionEl.value,
        context: ""
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "分析失败。");
    await completeLoadingSequence(result);
    renderResult(result);
  } catch (error) {
    stopLoadingSequence();
    decisionPanel.innerHTML = `
      <div class="empty-state">
        <p class="section-kicker">Decision Memo</p>
        <h2>分析失败</h2>
        <p>${safeText(error.message)}</p>
      </div>
    `;
  } finally {
    setLoading(false);
  }
}

function startLoadingSequence() {
  stopLoadingSequence();
  state.loadingProgress = 4;
  state.loadingTick = 0;
  state.loadingStartedAt = performance.now();
  state.loadingMembers = loadingModels().map((name, index) => ({
    name,
    duration: 14000 + index * 2200 + (name.length % 5) * 850,
    progress: 1,
    finishStart: 0,
    finishFrom: 0,
    finishDuration: 0
  }));
  renderLoadingDecision();
  state.loadingTimer = window.setInterval(() => {
    state.loadingTick += 1;
    renderLoadingDecision();
  }, 520);
}

function stopLoadingSequence(progress) {
  if (state.loadingTimer) window.clearInterval(state.loadingTimer);
  state.loadingTimer = null;
  state.loadingMembers = [];
  if (Number.isFinite(progress)) {
    state.loadingProgress = progress;
    renderLoadingDecision();
  }
}

function completeLoadingSequence(result) {
  const members = state.loadingMembers.length ? state.loadingMembers : loadingModels().map((name) => ({ name, progress: 1 }));
  const startedAt = performance.now();
  state.loadingMembers = members.map((member) => {
    const output = memberOutput(result, member.name);
    const textLength = output.length || 120;
    return {
      ...member,
      finishStart: startedAt,
      finishFrom: currentMemberProgress(member, startedAt),
      finishDuration: Math.min(2600, Math.max(760, 520 + textLength * 3.2))
    };
  });

  return new Promise((resolve) => {
    const finishTimer = window.setInterval(() => {
      state.loadingTick += 1;
      renderLoadingDecision();
      if (state.loadingMembers.every((member) => currentMemberProgress(member) >= 100)) {
        window.clearInterval(finishTimer);
        stopLoadingSequence();
        resolve();
      }
    }, 120);
  });
}

function renderLoadingDecision() {
  const members = state.loadingMembers.length
    ? state.loadingMembers
    : loadingModels().map((name) => ({ name, progress: 1, duration: 16000 }));
  const progressValues = members.map((member) => currentMemberProgress(member));
  const total = Math.max(1, Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length));
  const rows = members.map((member, index) => {
    const value = progressValues[index];
    return `
      <div class="model-load-row">
        <span>${safeText(member.name)}</span>
        <div class="model-load-track"><i style="width: ${value}%"></i></div>
        <strong>${value}%</strong>
      </div>
    `;
  }).join("");

  decisionPanel.innerHTML = `
    <div class="terminal-screen" role="status" aria-live="polite">
      <div class="screen-header">
        <p class="section-kicker">Decision Memo</p>
        <span>MAGI DISPLAY ONLINE</span>
      </div>
      <div class="screen-body">
        <div class="matrix-readout" aria-hidden="true">
          ${matrixRows(8, 112).map((row) => `<span>${row}</span>`).join("")}
        </div>
        <div class="screen-message">
          <h2>MAGI 正在分析<span class="terminal-cursor"></span></h2>
          <p>四个模型并行生成回答。系统正在压缩共识、分歧和少数派信号。</p>
        </div>
        <div class="model-load-list">
          ${rows}
        </div>
        <div class="total-load">
          <span>同步加载</span>
          <div class="total-load-track"><i style="width: ${total}%"></i></div>
          <strong>${total}%</strong>
        </div>
      </div>
    </div>
  `;
}

function currentMemberProgress(member, now = performance.now()) {
  if (member.finishStart) {
    const elapsed = now - member.finishStart;
    const ratio = Math.min(1, elapsed / Math.max(1, member.finishDuration));
    const value = member.finishFrom + (100 - member.finishFrom) * ratio;
    member.progress = Math.max(member.progress || 0, Math.round(value));
    return member.progress;
  }
  const elapsed = now - state.loadingStartedAt;
  const value = Math.min(96, Math.max(1, (elapsed / Math.max(1, member.duration)) * 96));
  member.progress = Math.max(member.progress || 0, Math.round(value));
  return member.progress;
}

function memberOutput(result, name) {
  const member = (result.members || []).find((item) => item.name === name) || {};
  return [
    member.detailed_analysis,
    member.thesis,
    normalizeItems(member.main_conclusions || member.key_evidence).join(" "),
    member.decision_label
  ].filter(Boolean).join(" ");
}

function loadingModels() {
  const members = state.config?.council?.members || [];
  const names = members.map((member) => member.name).filter(Boolean).slice(0, 4);
  return names.length ? names : defaultLoadingModels;
}

function matrixRows(count, length = 42) {
  return Array.from({ length: count }, (_, rowIndex) => {
    return Array.from({ length }, (_, index) => {
      const cursor = (state.loadingTick * 7 + rowIndex * 11 + index * 5) % glyphSet.length;
      return glyphSet[cursor];
    }).join("");
  });
}

function renderConfig() {
  const members = state.config.council.members;
  const liveCount = members.filter((member) => member.configured).length;
  statusEl.textContent = liveCount ? `${liveCount} 个模型在线` : "演示模式";

  membersEl.innerHTML = members.map((member) => `
    <article class="member-card dormant">
      <div class="model-title">
        ${modelAvatar(member)}
        <h3>${escapeHtml(member.name)}</h3>
      </div>
      <p>${safeText(member.role)}</p>
    </article>
  `).join("");

  councilList.innerHTML = members.map((member) => `
    <p class="model-row">
      <strong>${modelAvatar(member)}<span class="model-name">${escapeHtml(member.name)}${statusDot(member.configured)}</span></strong>
      <span>${safeText(shortModel(member.model))}</span>
    </p>
  `).join("");

  toolList.innerHTML = state.config.tools.map((tool) => `
    <p><strong>${safeText(tool.name)}</strong><span>${safeText(tool.description)}</span></p>
  `).join("");
}

function renderResult(result) {
  renderDecision(result.decision, result.aggregate);
  renderMembers(result.members || []);
  renderToolEvidence(result.tools || []);
}

function renderDecision(decision, aggregate) {
  decisionPanel.innerHTML = `
    <div class="memo-primary">
      <p class="section-kicker">Decision Memo</p>
      <div class="memo-final">
        <span>最终决策</span>
        <h2>${safeText(decision.final_decision || formatStance(decision.decision))}</h2>
      </div>
      <p class="lead"><strong>${safeText(decision.rationale || aggregate.summary || "")}</strong></p>
    </div>
    <div class="memo-secondary">
      ${featuredBlock("分歧", decision.disagreements)}
      ${featuredBlock("共识", decision.consensus || decision.consensus_zone)}
      ${featuredBlock("建议", decision.recommendation || [decision.action])}
    </div>
  `;
}

function renderMembers(members) {
  membersEl.innerHTML = members.map((member) => `
    <article class="member-card">
      <div class="member-head">
        <div class="model-title">
          ${modelAvatar(member)}
          <h3>${escapeHtml(member.name)}</h3>
        </div>
      </div>
      <div class="analysis-scroll">
        <section class="analysis-block">
          <h4>详细分析</h4>
          <p>${safeText(member.detailed_analysis || member.thesis)}</p>
        </section>
        <section class="analysis-block">
          <h4>主要结论</h4>
          <ul>${normalizeItems(member.main_conclusions || member.key_evidence).slice(0, 4).map((item) => `<li>${safeText(item)}</li>`).join("")}</ul>
        </section>
      </div>
    </article>
  `).join("");
}

function renderToolEvidence(tools) {
  const useful = tools.filter((tool) => tool.status !== "skipped").slice(0, 4);
  toolEvidence.innerHTML = useful.map((tool) => `
    <article class="evidence-card ${escapeHtml(tool.id)}">
      <p class="section-kicker">${safeText(tool.source || "local")}</p>
      <h3>${safeText(tool.name)}</h3>
      ${renderEvidenceBody(tool)}
    </article>
  `).join("");
}

function renderEvidenceBody(tool) {
  if (tool.id === "market_data") return renderQuoteEvidence(tool);
  if (tool.id === "fundamentals") return renderFundamentalEvidence(tool);
  return `<p>${safeText(summarizeToolResult(tool))}</p>`;
}

function renderQuoteEvidence(tool) {
  const quotes = (tool.result?.quotes || []).slice(0, 4);
  if (!quotes.length) return `<p>${safeText(summarizeToolResult(tool))}</p>`;
  return `
    <div class="evidence-list">
      ${quotes.map((quote) => `
        <div class="evidence-item">
          <div class="evidence-topline">
            <strong>${escapeHtml(quote.symbol)}</strong>
            <span>${safeText(marketLabel(quote.market))}</span>
          </div>
          <p>${safeText(quote.name || quote.exchange || quote.currency || "行情")}</p>
          <div class="evidence-metrics">
            <span>${escapeHtml(formatPrice(quote.regular_market_price ?? quote.last_close, quote.currency))}</span>
            <span class="${Number(quote.change_pct) >= 0 ? "up" : "down"}">${escapeHtml(formatPct(quote.change_pct))}</span>
          </div>
        </div>
      `).join("")}
      ${renderEvidenceErrors(tool)}
    </div>
  `;
}

function renderFundamentalEvidence(tool) {
  const companies = (tool.result?.companies || []).slice(0, 4);
  if (!companies.length) return `<p>${safeText(summarizeToolResult(tool))}</p>`;
  return `
    <div class="evidence-list">
      ${companies.map((company) => `
        <div class="evidence-item">
          <div class="evidence-topline">
            <strong>${escapeHtml(company.symbol)}</strong>
            <span>${safeText(marketLabel(company.market))}</span>
          </div>
          <p>${safeText(company.company || company.note || "基本面")}</p>
          <div class="evidence-metrics">
            <span>营收 ${escapeHtml(formatMoney(company.metrics?.revenue))}</span>
            <span>净利 ${escapeHtml(formatMoney(company.metrics?.net_income))}</span>
            ${company.market === "CN" ? `<span>ROE ${escapeHtml(formatPct(company.metrics?.roe?.value))}</span>` : ""}
          </div>
          ${company.report_date ? `<p class="evidence-foot">${safeText(company.report_type || "报告期")} ${safeText(company.report_date)}</p>` : ""}
        </div>
      `).join("")}
      ${renderEvidenceErrors(tool)}
    </div>
  `;
}

function renderEvidenceErrors(tool) {
  const errors = tool.result?.errors || [];
  return errors.slice(0, 2).map((item) => `
    <div class="evidence-item evidence-error">
      <div class="evidence-topline">
        <strong>${safeText(marketLabel(item.market))}</strong>
        <span>数据源失败</span>
      </div>
      <p>${safeText(item.source || "external")} ${safeText(item.error || "无返回")}</p>
    </div>
  `).join("");
}

function featuredBlock(title, items = [], limit = 3) {
  const clean = normalizeItems(items).slice(0, limit);
  if (!clean.length) return "";
  return `
    <section class="featured-card">
      <h4>${safeText(title)}</h4>
      <ul>${clean.map((item) => `<li>${safeText(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function modelAvatar(member) {
  if (!member.avatarUrl) return "";
  return `<img class="model-avatar" src="${escapeHtml(member.avatarUrl)}" alt="${escapeHtml(member.name)} logo" loading="lazy" />`;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) items = [items];
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function setLoading(value) {
  state.loading = value;
  runButton.disabled = value;
  runButton.classList.toggle("loading", value);
  runButton.setAttribute("aria-label", value ? "MAGI 分析中" : "启动 MAGI");
}

function summarizeToolResult(tool) {
  const result = tool.result || {};
  if (tool.id === "market_data") {
    const quotes = result.quotes || [];
    if (!quotes.length) return result.reason || result.error || "未返回行情。";
    return quotes.map((quote) => {
      const price = quote.regular_market_price ?? quote.last_close ?? quote.bid ?? "无价格";
      const change = quote.change_pct == null ? "" : `，${quote.change_pct}%`;
      const market = quote.market ? `${marketLabel(quote.market)} ` : "";
      return `${market}${quote.symbol} ${price}${change}`;
    }).join("；");
  }
  if (tool.id === "fundamentals") {
    const companies = result.companies || [];
    if (!companies.length) return result.reason || result.error || "未返回财报。";
    return companies.map((company) => {
      const revenue = company.metrics?.revenue?.value;
      const netIncome = company.metrics?.net_income?.value;
      const market = company.market ? `${marketLabel(company.market)} ` : "";
      return `${market}${company.symbol} 营收 ${formatNumber(revenue)}，净利润 ${formatNumber(netIncome)}`;
    }).join("；");
  }
  if (tool.id === "web_research") {
    const results = result.results || [];
    if (!results.length) return result.reason || result.error || result.note || "未返回检索结果。";
    return results.slice(0, 2).map((item) => item.title).join("；");
  }
  if (tool.id === "risk_register") return (result.risks || []).slice(0, 2).join("；");
  if (tool.id === "scenario_matrix") {
    return `乐观 ${Math.round((result.bull || 0) * 100)}%，基准 ${Math.round((result.base || 0) * 100)}%，悲观 ${Math.round((result.bear || 0) * 100)}%。`;
  }
  if (tool.id === "position_sizing") return `试探仓位 ${result.starter || "无"}，完整仓位 ${result.full_size || "无"}。`;
  if (tool.id === "valuation_sanity") return result.check || "估值检查已完成。";
  return result.error || result.reason || "工具已完成。";
}

function marketLabel(value) {
  if (value === "CN") return "A股";
  if (value === "US") return "美股";
  return value || "市场";
}

function formatPrice(value, currency) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "无价格";
  const unit = currency === "CNY" ? "¥" : currency === "USD" ? "$" : "";
  return `${unit}${number.toFixed(number >= 100 ? 2 : 3)}`;
}

function formatPct(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "无涨跌";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

function formatMoney(fact) {
  if (!fact || fact.value == null) return "无";
  const unit = fact.unit || "";
  const number = Number(fact.value);
  if (!Number.isFinite(number)) return "无";
  if (unit.includes("CNY")) return `${(number / 1e8).toFixed(2)}亿`;
  if (unit.includes("USD")) return formatNumber(number);
  return `${formatNumber(number)}${unit}`;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "无";
  if (Math.abs(number) >= 1e9) return `${(number / 1e9).toFixed(2)}B`;
  if (Math.abs(number) >= 1e6) return `${(number / 1e6).toFixed(2)}M`;
  return String(number);
}

function formatStance(value) {
  const map = {
    agree: "赞同",
    disagree: "不赞同",
    divided: "分歧",
    agree_with_conditions: "分歧",
    abstain: "分歧"
  };
  return map[value] || value || "未定";
}

function percent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(number * 100)}%`;
}

function shortModel(value = "") {
  return String(value).split("/").pop().replace(/-/g, " ");
}

function statusDot(configured) {
  const label = configured ? "在线" : "掉线";
  return `<i class="status-dot ${configured ? "online" : "offline"}" aria-label="${label}" title="${label}"></i>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeText(value) {
  return escapeHtml(spaceCjkEnglish(value));
}

function spaceCjkEnglish(value) {
  return String(value ?? "")
    .replace(/([\u3400-\u9fff])([A-Za-z0-9][A-Za-z0-9.+/#-]*)/g, "$1 $2")
    .replace(/([A-Za-z0-9][A-Za-z0-9.+/#-]*)([\u3400-\u9fff])/g, "$1 $2");
}
