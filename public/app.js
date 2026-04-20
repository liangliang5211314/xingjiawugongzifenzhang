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

function showLogin() {
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("appView").classList.add("hidden");
}

function showApp() {
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("appView").classList.remove("hidden");
}

function getVisibleViews() {
  const isAdmin = state.profile?.user?.role === "admin";
  return [
    { id: "dashboardView", title: "仪表盘", roles: ["admin", "team_user"] },
    { id: "teamsView", title: "团队管理", roles: ["admin"] },
    { id: "membersView", title: "成员管理", roles: ["admin", "team_user"] },
    { id: "recordsView", title: "收入录入", roles: ["admin", "team_user"] },
    { id: "settlementView", title: "结算查询", roles: ["admin", "team_user"] },
    { id: "statsView", title: "汇总统计", roles: isAdmin ? ["admin"] : [] }
  ].filter((item) => item.roles.includes(state.profile?.user?.role));
}

function switchView(viewId) {
  document.querySelectorAll(".view-section").forEach((section) => section.classList.add("hidden"));
  const current = document.getElementById(viewId);
  if (current) {
    current.classList.remove("hidden");
  }
  const currentMeta = getVisibleViews().find((item) => item.id === viewId);
  document.getElementById("pageTitle").textContent = currentMeta?.title || "工作台";
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.target === viewId);
  });
}

function renderNav() {
  const menu = document.getElementById("navMenu");
  menu.innerHTML = "";
  getVisibleViews().forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-link";
    button.dataset.target = item.id;
    button.textContent = item.title;
    button.addEventListener("click", () => switchView(item.id));
    menu.appendChild(button);
    if (index === 0) {
      switchView(item.id);
    }
  });
}

function renderProfile() {
  const { user, team } = state.profile;
  document.getElementById("profileCard").innerHTML = `
    <strong>${user.username}</strong>
    <span>${user.role === "admin" ? "管理员" : "团队用户"}</span>
    <span>${team ? `所属团队：${team.name}` : "可查看全部团队"}</span>
  `;
  document.getElementById("teamBadge").textContent = team ? `${team.name} / ${team.rule_type}` : "管理员视角";
}

function renderDashboard() {
  const isAdmin = state.profile.user.role === "admin";
  const team = state.profile.team;
  document.getElementById("dashboardView").innerHTML = `
    <div class="section-grid ${isAdmin ? "three-col" : "two-col"}">
      <article class="metric-card">
        <span class="eyebrow">身份</span>
        <strong>${isAdmin ? "管理员" : "团队用户"}</strong>
        <p>${isAdmin ? "可查看全部团队、结算和统计。" : "仅可操作自己团队的数据。"}</p>
      </article>
      <article class="metric-card">
        <span class="eyebrow">团队模式</span>
        <strong>${team ? team.rule_type : "多团队总览"}</strong>
        <p>${team ? JSON.stringify(team.rule_config) : "请前往团队管理查看各团队规则。"}</p>
      </article>
      ${
        isAdmin
          ? `<article class="metric-card">
              <span class="eyebrow">Z团队规则</span>
              <strong>已内置</strong>
              <p>张明亮 20% 总收入 + 报销支出，其余成员平分剩余。</p>
            </article>`
          : ""
      }
    </div>
  `;
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function renderTeamsTable() {
  const container = document.getElementById("teamsTable");
  if (!state.teams.length) {
    container.innerHTML = `<div class="empty-state">暂无团队数据</div>`;
    return;
  }

  const rows = state.teams
    .map(
      (team) => `
        <tr>
          <td>${team.id}</td>
          <td>${team.name}</td>
          <td>${team.rule_type}</td>
          <td><pre>${formatJson(team.rule_config)}</pre></td>
        </tr>
      `
    )
    .join("");

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>ID</th><th>团队</th><th>规则类型</th><th>规则配置</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderMembersTable(teamId) {
  const members = state.membersByTeam[teamId] || [];
  const container = document.getElementById("membersTable");
  if (!members.length) {
    container.innerHTML = `<div class="empty-state">当前团队暂无成员</div>`;
    return;
  }
  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr><th>ID</th><th>姓名</th><th>团队ID</th><th>负责人</th></tr>
      </thead>
      <tbody>
        ${members
          .map(
            (member) => `
              <tr>
                <td>${member.id}</td>
                <td>${member.name}</td>
                <td>${member.team_id}</td>
                <td>${member.is_leader ? "是" : "否"}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function fillTeamSelectors() {
  const selects = [
    "memberTeamSelect",
    "memberListTeamSelect",
    "recordTeamSelect",
    "settleTeamSelect"
  ].map((id) => document.getElementById(id));

  selects.forEach((select) => {
    if (!select) return;
    select.innerHTML = state.teams
      .map((team) => `<option value="${team.id}">${team.name} (${team.rule_type})</option>`)
      .join("");
  });
}

function fillRecordMembers(teamId) {
  const select = document.getElementById("recordMemberSelect");
  const members = state.membersByTeam[teamId] || [];
  select.innerHTML = members.map((member) => `<option value="${member.id}">${member.name}</option>`).join("");
}

async function loadTeamsAndMembers() {
  if (state.profile.user.role === "admin") {
    state.teams = await api("/api/teams");
  } else if (state.profile.team) {
    state.teams = [state.profile.team];
  } else {
    state.teams = [];
  }

  fillTeamSelectors();
  renderTeamsTable();

  for (const team of state.teams) {
    state.membersByTeam[team.id] = await api(`/api/members?team_id=${team.id}`);
  }

  const currentTeamId = state.teams[0]?.id;
  if (currentTeamId) {
    renderMembersTable(currentTeamId);
    fillRecordMembers(currentTeamId);
  }
}

function applyRuleTemplate(ruleType) {
  document.getElementById("ruleConfigInput").value = formatJson(ruleTemplates[ruleType]);
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
    if (state.profile.user.role === "admin") {
      applyRuleTemplate("zteam");
    }
    await loadTeamsAndMembers();
  } catch (error) {
    localStorage.removeItem("token");
    state.token = "";
    showLogin();
  }
}

document.getElementById("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  document.getElementById("loginError").textContent = "";
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());

  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    state.token = result.token;
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
  await loadTeamsAndMembers();
});

document.getElementById("memberForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  await api("/api/members", {
    method: "POST",
    body: JSON.stringify({
      team_id: Number(form.get("team_id")),
      name: form.get("name"),
      is_leader: form.get("is_leader") === "on"
    })
  });
  await loadTeamsAndMembers();
});

document.getElementById("loadMembersBtn").addEventListener("click", async () => {
  const teamId = Number(document.getElementById("memberListTeamSelect").value);
  state.membersByTeam[teamId] = await api(`/api/members?team_id=${teamId}`);
  renderMembersTable(teamId);
});

document.getElementById("memberListTeamSelect").addEventListener("change", (event) => {
  renderMembersTable(Number(event.target.value));
});

document.getElementById("recordTeamSelect").addEventListener("change", async (event) => {
  const teamId = Number(event.target.value);
  state.membersByTeam[teamId] = state.membersByTeam[teamId] || (await api(`/api/members?team_id=${teamId}`));
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
  const result = await api(`/api/settle?team_id=${teamId}&month=${month}`, {
    method: "POST"
  });
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

bootstrap();
