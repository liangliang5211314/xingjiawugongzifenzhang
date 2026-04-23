let __sessionPromise = null;

function getToken() {
  return localStorage.getItem('admin_token');
}

function getLeaderTeamId() {
  return localStorage.getItem('leader_team_id');
}

function logout() {
  localStorage.removeItem('admin_token');
  localStorage.removeItem('leader_team_id');
  __sessionPromise = null;
  location.href = '/';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

async function api(url, options = {}) {
  const token = getToken();
  if (!token && !url.includes('/login')) {
    location.href = '/';
    return null;
  }

  const defaults = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(getLeaderTeamId() ? { 'X-Leader-Team-Id': getLeaderTeamId() } : {})
    }
  };

  const merged = {
    ...defaults,
    ...options,
    headers: { ...defaults.headers, ...(options.headers || {}) }
  };

  try {
    const res = await fetch(url, merged);
    if (res.status === 401) {
      logout();
      return null;
    }
    const data = await res.json();
    if (!data.ok && data.message) {
      showError(data.message);
    }
    return data;
  } catch (e) {
    showError('网络请求失败: ' + e.message);
    return null;
  }
}

function showError(msg) {
  const errEls = document.querySelectorAll('.error-msg');
  const visible = [...errEls].find(function(el) { return el.style.display !== 'none'; });
  if (visible) {
    visible.textContent = msg;
    visible.style.display = 'block';
    return;
  }

  const anyErr = errEls[0];
  if (anyErr) {
    anyErr.textContent = msg;
    anyErr.style.display = 'block';
    return;
  }

  alert('错误: ' + msg);
}

function getCurrentSession() {
  if (!getToken()) return Promise.resolve(null);
  if (!__sessionPromise) {
    __sessionPromise = api('/api/me').then(function(res) {
      return res && res.ok ? res.data : null;
    });
  }
  return __sessionPromise;
}

async function applyAdminShellPermissions() {
  if (location.pathname === '/' || location.pathname === '/login') return;
  const session = await getCurrentSession();
  if (!session || !session.user) return;

  const isAdmin = session.user.role === 'admin';
  const dashboardLink = document.querySelector('a[href="/admin/dashboard"]');
  if (dashboardLink && !isAdmin) {
    dashboardLink.parentElement.style.display = 'none';
  }
}

(function checkAuth() {
  if (location.pathname === '/' || location.pathname === '/login') return;
  if (!getToken()) {
    location.href = '/';
    return;
  }
  applyAdminShellPermissions();
})();
