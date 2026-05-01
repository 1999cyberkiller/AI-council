const state = {
  config: null,
  loading: false
};

const briefForm = document.querySelector("#briefForm");
const questionEl = document.querySelector("#question");
const contextEl = document.querySelector("#context");
const runButton = document.querySelector("#runButton");
const sampleButton = document.querySelector("#sampleButton");
const decisionPanel = document.querySelector("#decisionPanel");
const membersEl = document.querySelector("#members");
const memberCount = document.querySelector("#memberCount");
const councilList = document.querySelector("#councilList");
const toolList = document.querySelector("#toolList");
const statusEl = document.querySelector("#status");
const chairModel = document.querySelector("#chairModel");
const toolEvidence = document.querySelector("#toolEvidence");
const toolEvidenceCount = document.querySelector("#toolEvidenceCount");

briefForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runCouncil();
});
sampleButton.addEventListener("click", loadSample);

loadConfig();

async function loadConfig() {
  const response = await fetch("/api/config");
  state.config = await response.json();
  renderConfig();
}

async function runCouncil() {
  setLoading(true);
  decisionPanel.innerHTML = `
    <div class="empty-state">
      <p class="section-kicker">Decision Memo</p>
      <h2>议会正在分析</h2>
      <p>四席并行调用中。先让模型各自说完，再交给主席整理。</p>
    </div>
  `;
  membersEl.innerHTML = "";
  toolEvidence.innerHTML = "";
  toolEvidenceCount.textContent = "0";

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        question: questionEl.value,
        context: contextEl.value
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "分析失败。");
    renderResult(result);
  } catch (error) {
    decisionPanel.innerHTML = `
      <div class="empty-state">
        <p class="section-kicker">Decision Memo</p>
        <h2>分析失败</h2>
        <p>${escapeHtml(error.message)}</p>
      </div>
    `;
  } finally {
    setLoading(false);
  }
}

function renderConfig() {
  const members = state.config.council.members;
  const liveCount = members.filter((member) => member.configured).length;
  statusEl.textContent = liveCount ? `${liveCount} 个模型在线` : "演示模式";
  memberCount.textContent = String(members.length);
  chairModel.textContent = shortModel(state.config.council.chair.model);
  toolEvidenceCount.textContent = String(state.config.tools.length);

  membersEl.innerHTML = members.map((member) => `
    <article class="member-card dormant">
      <div>
        <p class="section-kicker">${escapeHtml(member.provider)}</p>
        <h3>${escapeHtml(member.name)}</h3>
      </div>
      <p>${escapeHtml(member.role)}</p>
      <span class="status-line">${member.configured ? "已接入" : "演示"}</span>
    </article>
  `).join("");

  councilList.innerHTML = members.map((member) => `
    <p><strong>${escapeHtml(member.name)}</strong><span>${escapeHtml(shortModel(member.model))}</span></p>
  `).join("");

  toolList.innerHTML = state.config.tools.map((tool) => `
    <p><strong>${escapeHtml(tool.name)}</strong><span>${escapeHtml(tool.description)}</span></p>
  `).join("");
}

function renderResult(result) {
  renderDecision(result.chair, result.aggregate);
  renderMembers(result.members || []);
  renderToolEvidence(result.tools || []);
}

function renderDecision(chair, aggregate) {
  const probability = percent(chair.probability);
  const confidence = percent(chair.confidence);
  decisionPanel.innerHTML = `
    <div class="memo-primary">
      <p class="section-kicker">Decision Memo</p>
      <h2>${formatStance(chair.decision)}</h2>
      <p class="lead">${escapeHtml(chair.rationale)}</p>
      <div class="metric-row">
        <span><strong>${probability}</strong> 决策概率</span>
        <span><strong>${confidence}</strong> 主席信心</span>
        <span><strong>${escapeHtml(chair.direction || aggregate.direction)}</strong> 方向</span>
      </div>
    </div>
    <div class="memo-secondary">
      ${compactBlock("下一步", [chair.action])}
      ${compactBlock("关键分歧", chair.disagreements)}
      ${compactBlock("少数派", [chair.minority_opinion_preserved])}
      ${compactBlock("观察项", chair.watchlist)}
    </div>
  `;
}

function renderMembers(members) {
  memberCount.textContent = String(members.length);
  membersEl.innerHTML = members.map((member) => `
    <article class="member-card">
      <div class="member-head">
        <div>
          <p class="section-kicker">${escapeHtml(member.provider)}</p>
          <h3>${escapeHtml(member.name)}</h3>
        </div>
        <span class="stance ${escapeHtml(member.stance)}">${formatStance(member.stance)}</span>
      </div>
      <p class="thesis">${escapeHtml(member.thesis)}</p>
      <div class="mini-metrics">
        <span>${percent(member.probability)} 概率</span>
        <span>${percent(member.confidence)} 信心</span>
      </div>
      ${compactBlock("假设", member.key_assumptions, 2)}
      ${compactBlock("会改观点", member.what_would_change_my_mind, 2)}
    </article>
  `).join("");
}

function renderToolEvidence(tools) {
  const useful = tools.filter((tool) => tool.status !== "skipped").slice(0, 4);
  toolEvidenceCount.textContent = String(useful.length);
  toolEvidence.innerHTML = useful.map((tool) => `
    <article class="evidence-card">
      <p class="section-kicker">${escapeHtml(tool.source || "local")}</p>
      <h3>${escapeHtml(tool.name)}</h3>
      <p>${escapeHtml(summarizeToolResult(tool))}</p>
    </article>
  `).join("");
}

function compactBlock(title, items = [], limit = 3) {
  const clean = normalizeItems(items).slice(0, limit);
  if (!clean.length) return "";
  return `
    <section class="compact-block">
      <h4>${escapeHtml(title)}</h4>
      <ul>${clean.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </section>
  `;
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) items = [items];
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function setLoading(value) {
  state.loading = value;
  runButton.disabled = value;
  runButton.textContent = value ? "分析中" : "启动议会";
}

function loadSample() {
  questionEl.value = "台积电回撤 12% 后，是否应该加仓，还是继续等待更低的买入价格？";
  contextEl.value = "投资期限：6 至 12 个月。当前组合已经持有 Nvidia 敞口。我更重视回撤控制，而不是追上每一段上涨。";
}

function summarizeToolResult(tool) {
  const result = tool.result || {};
  if (tool.id === "market_data") {
    const quotes = result.quotes || [];
    if (!quotes.length) return result.reason || result.error || "未返回行情。";
    return quotes.map((quote) => {
      const price = quote.regular_market_price ?? quote.last_close ?? quote.bid ?? "无价格";
      const change = quote.change_pct == null ? "" : `，${quote.change_pct}%`;
      return `${quote.symbol} ${price}${change}`;
    }).join("；");
  }
  if (tool.id === "fundamentals") {
    const companies = result.companies || [];
    if (!companies.length) return result.reason || result.error || "未返回财报。";
    return companies.map((company) => {
      const revenue = company.metrics?.revenue?.value;
      const netIncome = company.metrics?.net_income?.value;
      return `${company.symbol} 营收 ${formatNumber(revenue)}，净利润 ${formatNumber(netIncome)}`;
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
    disagree: "反对",
    agree_with_conditions: "有条件",
    abstain: "弃权"
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
