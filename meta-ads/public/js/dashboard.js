const state = { sort: 'spend', dir: 'desc' };

async function loadAll() {
  const params = {
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
    tag: document.getElementById('tag').value,
  };
  const [totals, leaderboard, fatigue] = await Promise.all([
    api.get('/api/metrics/totals?' + qs(params)),
    api.get('/api/metrics/leaderboard?' + qs({ ...params, sort: state.sort, dir: state.dir, limit: 50 })),
    api.get('/api/metrics/fatigue'),
  ]);
  renderKpis(totals);
  renderLeaderboard(leaderboard);
  renderAlerts(fatigue);
}

function renderKpis(t) {
  const tiles = [
    ['Spend', fmt.money(t.spend)],
    ['Revenue', fmt.money(t.revenue)],
    ['ROAS', fmt.ratio(t.roas)],
    ['CPA', fmt.cents(t.cpa)],
    ['CTR', fmt.pct(t.ctr)],
    ['CPM', fmt.cents(t.cpm)],
    ['Purchases', fmt.num(t.purchases)],
  ];
  document.getElementById('kpis').innerHTML = tiles
    .map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');
}

function renderLeaderboard(rows) {
  const tbody = document.querySelector('#leaderboard tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:32px">No data. Click "Load Demo Data" or import a CSV.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td><img class="thumb" src="${r.thumbnail_url || ''}" alt="" onerror="this.style.visibility='hidden'"></td>
      <td><a href="/creative.html?id=${r.id}">${escapeHtml(r.name)}</a><div style="color:var(--muted);font-size:11px">${r.format}</div></td>
      <td class="num">${fmt.money(r.spend)}</td>
      <td class="num">${fmt.money(r.revenue)}</td>
      <td class="num ${r.roas >= 2 ? 'good' : r.roas < 1 ? 'bad' : ''}">${fmt.ratio(r.roas)}</td>
      <td class="num">${fmt.cents(r.cpa)}</td>
      <td class="num">${fmt.pct(r.ctr)}</td>
      <td class="num">${fmt.num(r.purchases)}</td>
    </tr>`).join('');
}

function renderAlerts(rows) {
  const c = document.getElementById('alerts');
  if (!rows.length) { c.innerHTML = ''; return; }
  c.innerHTML = `<div class="alert">⚠ <strong>${rows.length}</strong> creative(s) showing fatigue (ROAS dropped >30% week-over-week): ${
    rows.slice(0, 5).map(r => `<a href="/creative.html?id=${r.id}" style="color:var(--bad)">${escapeHtml(r.name)}</a> (-${(r.drop * 100).toFixed(0)}%)`).join(', ')
  }</div>`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function loadTags() {
  const tags = await api.get('/api/creatives/tags/all');
  const sel = document.getElementById('tag');
  sel.innerHTML = '<option value="">All tags</option>' + tags.map(t => `<option>${escapeHtml(t)}</option>`).join('');
}

async function loadDateRange() {
  const r = await api.get('/api/ads/date-range');
  if (r.min) document.getElementById('from').value = r.min;
  if (r.max) document.getElementById('to').value = r.max;
}

document.querySelectorAll('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.dir = (state.sort === k && state.dir === 'desc') ? 'asc' : 'desc';
    state.sort = k;
    loadAll();
  });
});

document.getElementById('apply').addEventListener('click', loadAll);

document.getElementById('upload').addEventListener('click', async () => {
  const f = document.getElementById('csv').files[0];
  if (!f) return alert('Choose a CSV first.');
  try {
    const r = await api.upload('/api/ads/import', f);
    alert(`Imported ${r.rowsInserted} rows.`);
    await loadDateRange(); await loadTags(); await loadAll();
  } catch (e) { alert('Import failed: ' + e.message); }
});

document.getElementById('seed').addEventListener('click', async () => {
  const r = await api.post('/api/ads/seed');
  alert(`Seeded ${r.rowsInserted} insight rows across ${r.creatives} creatives.`);
  await loadDateRange(); await loadTags(); await loadAll();
});

document.getElementById('reset').addEventListener('click', async () => {
  if (!confirm('Delete all data?')) return;
  await api.post('/api/ads/reset');
  await loadAll();
});

/* ── Onboarding banner ───────────────────────────────── */
async function checkOnboarding() {
  // Respect explicit dismissal for this session
  if (sessionStorage.getItem('onboard_dismissed')) return;
  try {
    const ob = await api.get('/api/settings/onboarding');
    if (ob.complete) return; // all done — no banner

    const el = document.getElementById('onboarding');
    el.style.display = 'block';

    const steps = ob.steps;
    const done = [steps.meta_token, steps.gemini_key, steps.ad_account].filter(Boolean).length;

    // Checkmarks
    setCheck('ob-meta-check',    steps.meta_token);
    setCheck('ob-gemini-check',  steps.gemini_key);
    setCheck('ob-account-check', steps.ad_account);

    // Completed step styling
    if (steps.meta_token) document.getElementById('ob-meta').classList.add('onboard-step-done');
    if (steps.gemini_key) document.getElementById('ob-gemini').classList.add('onboard-step-done');
    if (steps.ad_account) document.getElementById('ob-account').classList.add('onboard-step-done');

    // Progress
    document.getElementById('ob-bar').style.width = ((done / 3) * 100) + '%';
    document.getElementById('ob-pct').textContent = done + ' of 3';
  } catch (_) { /* settings API not available — skip banner */ }
}

function setCheck(id, done) {
  const el = document.getElementById(id);
  el.textContent = done ? '\u2713' : '';
  el.classList.toggle('onboard-check-done', done);
}

document.getElementById('onboard-dismiss').addEventListener('click', () => {
  document.getElementById('onboarding').style.display = 'none';
  sessionStorage.setItem('onboard_dismissed', '1');
});

(async function init() {
  checkOnboarding();
  await loadDateRange();
  await loadTags();
  await loadAll();
})();
