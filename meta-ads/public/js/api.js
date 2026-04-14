// Tiny fetch wrapper for the JSON API.
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async put(path, body) {
    const r = await fetch(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  },
  async del(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(r.statusText);
    return r.json();
  },
  async upload(path, file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(path, { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
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
