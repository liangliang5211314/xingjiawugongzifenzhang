// 获取JWT token
function getToken() {
  return localStorage.getItem('admin_token');
}

// 退出登录
function logout() {
  localStorage.removeItem('admin_token');
  location.href = '/';
}

// 侧边栏切换
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

// 统一fetch封装（带JWT、错误提示）
async function api(url, options = {}) {
  const token = getToken();
  if (!token && !url.includes('/login')) {
    location.href = '/';
    return null;
  }
  const defaults = {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': 'Bearer ' + token } : {}),
    },
  };
  const merged = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };
  try {
    const res = await fetch(url, merged);
    if (res.status === 401) { logout(); return null; }
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

// 全局错误提示
function showError(msg) {
  // 尝试找页面上的error容器，否则用alert
  const errEls = document.querySelectorAll('.error-msg');
  const visible = [...errEls].find(el => el.style.display !== 'none');
  if (visible) { visible.textContent = msg; visible.style.display = 'block'; return; }
  const anyErr = errEls[0];
  if (anyErr) { anyErr.textContent = msg; anyErr.style.display = 'block'; return; }
  alert('错误: ' + msg);
}

// 进入页面时检查登录状态（login页不检查）
(function checkAuth() {
  if (location.pathname === '/' || location.pathname === '/login') return;
  if (!getToken()) { location.href = '/'; }
})();
