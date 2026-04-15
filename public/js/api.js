// Tiny fetch wrapper for the JSON API.
//
// If any call returns 401 the session has expired (or the user was never
// signed in) — stash the current URL so login.js can bounce the user back
// after they authenticate, then redirect to the login page.
function _handle401() {
  if (window.location.pathname === '/login.html') return;
  try {
    sessionStorage.setItem('login_redirect',
      window.location.pathname + window.location.search);
  } catch { /* ignore storage errors */ }
  window.location.replace('/login.html');
}

async function _parseError(r) {
  try {
    const body = await r.json();
    return new Error(body.error || r.statusText);
  } catch {
    return new Error(r.statusText);
  }
}

async function _check(r) {
  if (r.status === 401) {
    _handle401();
    throw new Error('auth required');
  }
  if (!r.ok) throw await _parseError(r);
  return r.json();
}

const api = {
  async get(path) {
    return _check(await fetch(path));
  },
  async post(path, body) {
    return _check(await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
  async put(path, body) {
    return _check(await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
  async del(path) {
    return _check(await fetch(path, { method: 'DELETE' }));
  },
  async upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    return _check(await fetch(path, { method: 'POST', body: fd }));
  },
};

// Formatters
const fmt = {
  money: n => '$' + (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }),
  num: n => (n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }),
  pct: n => ((n || 0) * 100).toFixed(2) + '%',
  ratio: n => (n || 0).toFixed(2) + 'x',
  cents: n => '$' + (n || 0).toFixed(2),
};

function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v != null && v !== '') p.set(k, v);
  return p.toString();
}

function getUrlParam(name) {
  return new URLSearchParams(location.search).get(name);
}
