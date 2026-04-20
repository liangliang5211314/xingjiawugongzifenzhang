const state = {
  token: localStorage.getItem("token") || "",
  profile: null,
  teams: [],
  membersByTeam: {}
};

const ruleTemplates = {
  zteam: {
    leader_member_name: "张明亮",
    leader_ratio: 0.2,
    reimburse_expenses: true
  },
  standard: {
    strategy: "leader-plus-equal",
    leader_member_id: null,
    leader_ratio: 0.2
  },
  custom: {
    strategy: "fixed-ratios",
    allocations: [
      { member_id: 1, ratio: 0.4 },
      { member_id: 2, ratio: 0.35 },
      { member_id: 3, ratio: 0.25 }
    ]
  }
};

function getCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("code") || "";
}

function clearCodeFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function normalizeLoginResult(result) {
  if (result.ok && result.data) {
    return result.data;
  }
  return result;
}

function toggleWechat(showWechat) {
  document.getElementById("loginForm").classList.toggle("hidden", showWechat);
  document.getElementById("wechatLoginView").classList.toggle("hidden", !showWechat);
  document.getElementById("accountTabBtn").classList.toggle("active", !showWechat);
  document.getElementById("wechatTabBtn").classList.toggle("active", showWechat);
}

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
}

function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
}

function getViews() {
  const role = state.profile?.user?.role;
  return [
    { id: "dashboardView", title: "仪表盘", roles: ["admin", "team_user", "user"] },
    { id: "teamsView", title: "团队管理", roles: ["admin"] },
    { id: "membersView", title: "成员管理", roles: ["admin", "team_user", "user"] },
    { id: "recordsView", title: "收入录入", roles: ["admin", "team_user", "user"] },
    { id: "settlementView", title: "结算查询", roles: ["admin", "team_user", "user"] },
    { id: "statsView", title: "汇总统计", roles: ["admin"] }
  ].filter((item) => item.roles.includes(role));
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.add("hidden");
}

function openSidebar() {
  document.getElementById("sidebar").classList.add("open");
  document.getElementById("overlay").classList.remove("hidden");
}

function switchView(viewId) {
  document.querySelectorAll(".view-section").forEach((node) => node.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  const current = getViews().find((item) => item.id === viewId);
  document.getElementById("pageTitle").textContent = current?.title || "工作台";
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.target === viewId);
  });
  closeSidebar();
}

function renderNav() {
  const menu = document.getElementById("navMenu");
  menu.innerHTML = "";
  getViews().forEach((view, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-link";
    button.dataset.target = view.id;
    button.textContent = view.title;
    button.addEventListener("click", () => switchView(view.id));
    menu.appendChild(button);
    if (index === 0) {
      switchView(view.id);
    }
  });
}

function renderProfile() {
  const user = state.profile.user;
  const teams = state.profile.teams || [];
  document.getElementById("profileCard").innerHTML = `
    <strong>${user.nickname || user.username}</strong>
    <span>${user.role === "admin" ? "管理员" : user.role === "team_user" ? "团队用户" : "普通用户"}</span>
    <span>${teams.length > 0 ? `可访问团队：${teams.map((item) => item.name).join("、")}` : "当前未绑定团队"}</span>
  `;
  document.getElementById("teamBadge").textContent =
    user.role === "admin" ? "管理员视角" : `${teams.length} 个团队已授权`;
  document.getElementById("wechatMessage").textContent =
    state.profile.wechat_login?.message || "已支持微信 code 登录。";

  const wxLink = document.getElementById("wechatAuthorizeLink");
  const authorizeUrl = state.profile.wechat_login?.authorize_url;
  if (authorizeUrl) {
    wxLink.href = authorizeUrl;
    wxLink.classList.remove("hidden");
  } else {
    wxLink.classList.add("hidden");
  }
}

function renderDashboard() {
  const role = state.profile.user.role;
  const teams = role === "admin" ? state.teams : state.profile.teams;
  document.getElementById("dashboardView").innerHTML = `
    <div class="metrics-grid">
      <article class="metric-card">
        <span class="eyebrow">角色</span>
        <strong>${role === "admin" ? "管理员" : role === "team_user" ? "团队用户" : "普通用户"}</strong>
        <p>${role === "admin" ? "可管理全部团队、统计和结算。" : "仅能查看被授权团队的数据。"}</p>
      </article>
      <article class="metric-card">
        <span class="eyebrow">团队数量</span>
        <strong>${teams.length}</strong>
        <p>${teams.length ? teams.map((item) => item.name).join("、") : "当前尚未分配团队。"}</p>
      </article>
      <article class="metric-card">
        <span class="eyebrow">微信登录</span>
        <strong>${state.profile.wechat_login?.enabled ? "已启用" : "待配置"}</strong>
        <p>${state.profile.wechat_login?.message || ""}</p>
      </article>
    </div>
  `;
}

function renderTeamCards() {
  const root = document.getElementById("teamsCards");
  if (!state.teams.length) {
    root.innerHTML = `<div class="empty-state">暂无团队数据</div>`;
    return;
  }
  root.innerHTML = state.teams
    .map(
      (team) => `
        <article class="info-card">
          <div class="info-card-head">
            <strong>${team.name}</strong>
            <span>${team.rule_type}</span>
          </div>
          <pre>${formatJson(team.rule_config)}</pre>
        </article>
      `
    )
    .join("");
}

function renderMemberCards(teamId) {
  const members = state.membersByTeam[teamId] || [];
  const root = document.getElementById("membersCards");
  if (!members.length) {
    root.innerHTML = `<div class="empty-state">当前团队暂无成员</div>`;
    return;
  }
  root.innerHTML = members
    .map(
      (member) => `
        <article class="info-card">
          <div class="info-card-head">
            <strong>${member.name}</strong>
            <span>${member.is_leader ? "负责人" : "成员"}</span>
          </div>
          <p>成员 ID：${member.id}</p>
          <p>团队 ID：${member.team_id}</p>
        </article>
      `
    )
    .join("");
}

function fillTeamSelectors() {
  ["memberListTeamSelect", "recordTeamSelect", "settleTeamSelect", "memberLinkTeamSelect"].forEach((id) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = state.teams
      .map((team) => `<option value="${team.id}">${team.name} (${team.rule_type})</option>`)
      .join("");
  });
}

function renderTeamChecklist() {
  const root = document.getElementById("memberTeamsChecklist");
  root.innerHTML = state.teams
    .map(
      (team) => `
        <label class="check-item">
          <input type="checkbox" name="team_ids" value="${team.id}" />
          <span>${team.name}</span>
        </label>
      `
    )
    .join("");
}

function fillRecordMembers(teamId) {
  const members = state.membersByTeam[teamId] || [];
  document.getElementById("recordMemberSelect").innerHTML = members
    .map((member) => `<option value="${member.id}">${member.name}${member.is_leader ? "（负责人）" : ""}</option>`)
    .join("");
}

async function loadTeams() {
  state.teams = await api("/api/teams");
  fillTeamSelectors();
  renderTeamChecklist();
  renderTeamCards();
  for (const team of state.teams) {
    state.membersByTeam[team.id] = await api(`/api/members?team_id=${team.id}`);
  }
  const firstTeamId = state.teams[0]?.id;
  if (firstTeamId) {
    renderMemberCards(firstTeamId);
    fillRecordMembers(firstTeamId);
  } else {
    document.getElementById("membersCards").innerHTML = `<div class="empty-state">暂无团队成员</div>`;
  }
}

function applyRuleTemplate(type) {
  document.getElementById("ruleConfigInput").value = formatJson(ruleTemplates[type]);
}

async function bootstrap() {
  if (!state.token) {
    showLogin();
    return;
  }
  try {
    state.profile = await api("/api/me");
    showApp();
    renderProfile();
    renderNav();
    renderDashboard();
    applyRuleTemplate("zteam");
    await loadTeams();
  } catch (error) {
    localStorage.removeItem("token");
    state.token = "";
    showLogin();
  }
}

async function handleWechatLogin(code) {
  document.getElementById("wechatHint").textContent = "正在提交微信授权信息...";
  try {
    const result = await api("/api/auth/wx-oauth", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    const normalized = normalizeLoginResult(result);
    state.token = normalized.token;
    localStorage.setItem("token", state.token);
    clearCodeFromUrl();
    document.getElementById("wechatHint").textContent = normalized.isNew ? "微信账号首次登录成功。" : "微信登录成功。";
    await bootstrap();
  } catch (error) {
    document.getElementById("wechatHint").textContent = error.message;
  }
}

document.getElementById("accountTabBtn").addEventListener("click", () => toggleWechat(false));
document.getElementById("wechatTabBtn").addEventListener("click", () => toggleWechat(true));
document.getElementById("wechatBackBtn").addEventListener("click", () => toggleWechat(false));
document.getElementById("wechatCodeSubmitBtn").addEventListener("click", async () => {
  const code = document.getElementById("wechatCodeInput").value.trim();
  if (!code) {
    document.getElementById("wechatHint").textContent = "请输入微信回调 code。";
    return;
  }
  await handleWechatLogin(code);
});

document.getElementById("openMenuBtn").addEventListener("click", openSidebar);
document.getElementById("closeMenuBtn").addEventListener("click", closeSidebar);
document.getElementById("overlay").addEventListener("click", closeSidebar);

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  document.getElementById("loginError").textContent = "";
  const form = new FormData(event.target);
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(form.entries()))
    });
    const normalized = normalizeLoginResult(result);
    state.token = normalized.token;
    localStorage.setItem("token", state.token);
    await bootstrap();
  } catch (error) {
    document.getElementById("loginError").textContent = error.message;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("token");
  state.token = "";
  state.profile = null;
  state.teams = [];
  state.membersByTeam = {};
  showLogin();
});

document.getElementById("ruleTypeSelect").addEventListener("change", (event) => {
  applyRuleTemplate(event.target.value);
});

document.getElementById("teamForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = {
    name: form.get("name"),
    rule_type: form.get("rule_type"),
    rule_config: JSON.parse(form.get("rule_config") || "{}")
  };
  if (form.get("team_username") && form.get("team_password")) {
    payload.user = {
      username: form.get("team_username"),
      password: form.get("team_password")
    };
  }
  await api("/api/teams", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  event.target.reset();
  applyRuleTemplate("zteam");
  await loadTeams();
  renderDashboard();
});

document.getElementById("memberForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const teamIds = form.getAll("team_ids").map(Number);
  if (teamIds.length === 0) {
    alert("请至少勾选一个团队");
    return;
  }
  await api("/api/members", {
    method: "POST",
    body: JSON.stringify({
      name: form.get("name"),
      team_ids: teamIds,
      is_leader: form.get("is_leader") === "on"
    })
  });
  event.target.reset();
  await loadTeams();
});

document.getElementById("memberLinkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/members/link", {
    method: "POST",
    body: JSON.stringify({
      member_id: Number(form.get("member_id")),
      team_id: Number(form.get("team_id")),
      is_leader: form.get("is_leader") === "on"
    })
  });
  event.target.reset();
  await loadTeams();
});

document.getElementById("memberListTeamSelect").addEventListener("change", (event) => {
  renderMemberCards(Number(event.target.value));
});

document.getElementById("loadMembersBtn").addEventListener("click", async () => {
  const teamId = Number(document.getElementById("memberListTeamSelect").value);
  state.membersByTeam[teamId] = await api(`/api/members?team_id=${teamId}`);
  renderMemberCards(teamId);
});

document.getElementById("recordTeamSelect").addEventListener("change", async (event) => {
  const teamId = Number(event.target.value);
  if (!state.membersByTeam[teamId]) {
    state.membersByTeam[teamId] = await api(`/api/members?team_id=${teamId}`);
  }
  fillRecordMembers(teamId);
});

document.getElementById("recordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/records", {
    method: "POST",
    body: JSON.stringify({
      team_id: Number(form.get("team_id")),
      member_id: Number(form.get("member_id")),
      type: form.get("type"),
      amount: Number(form.get("amount")),
      month: form.get("month")
    })
  });
  alert("记录提交成功");
});

document.getElementById("settleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const teamId = Number(form.get("team_id"));
  const month = form.get("month");
  const result = await api(`/api/settle?team_id=${teamId}&month=${month}`, { method: "POST" });
  document.getElementById("settlementResult").textContent = formatJson(result.result_json);
});

document.getElementById("fetchSettlementBtn").addEventListener("click", async () => {
  const form = new FormData(document.getElementById("settleForm"));
  const teamId = Number(form.get("team_id"));
  const month = form.get("month");
  const result = await api(`/api/settlement?team_id=${teamId}&month=${month}`);
  document.getElementById("settlementResult").textContent = formatJson(result.result_json);
});

document.getElementById("loadMonthStatsBtn").addEventListener("click", async () => {
  const result = await api("/api/stats/month");
  document.getElementById("statsResult").textContent = formatJson(result);
});

document.getElementById("loadYearStatsBtn").addEventListener("click", async () => {
  const result = await api("/api/stats/year");
  document.getElementById("statsResult").textContent = formatJson(result);
});

const codeFromUrl = getCodeFromUrl();
if (codeFromUrl) {
  toggleWechat(true);
  document.getElementById("wechatCodeInput").value = codeFromUrl;
  handleWechatLogin(codeFromUrl);
}

bootstrap();
