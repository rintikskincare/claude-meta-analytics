/* Reports tab — list, generate, view detail, delete */

const tbl       = document.getElementById('tbl');
const tbody     = tbl.querySelector('tbody');
const emptyEl   = document.getElementById('empty');
const detailEl  = document.getElementById('detail');
const modal     = document.getElementById('modal');
const confirmEl = document.getElementById('confirm');
const toastEl   = document.getElementById('toast');
const genForm   = document.getElementById('gen-form');
const genErr    = document.getElementById('gen-err');
const acctSel   = document.getElementById('account-sel');

let pendingDelete = null;
let currentView   = 'list'; // 'list' | 'detail'

/* ── Helpers ─────────────────────────────────────────── */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function showToast(msg, kind = 'info') {
  toastEl.textContent = msg;
  toastEl.className = 'toast ' + kind;
  toastEl.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toastEl.style.display = 'none'; }, 2800);
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function statusBadge(s) {
  const cls = { done: 'badge-ok', error: 'badge-err', running: 'badge-run' }[s] || '';
  return `<span class="report-badge ${cls}">${esc(s)}</span>`;
}

/* ── List ────────────────────────────────────────────── */
async function loadList() {
  currentView = 'list';
  detailEl.style.display = 'none';
  try {
    const rows = await api.get('/api/reports');
    if (!rows.length) {
      tbl.style.display  = 'none';
      emptyEl.style.display = 'block';
      return;
    }
    tbl.style.display  = 'table';
    emptyEl.style.display = 'none';

    tbody.innerHTML = rows.map(r => {
      const p = r.params || {};
      const window = p.from && p.to ? `${p.from} → ${p.to}` : `${p.days || '—'} days`;
      return `<tr>
        <td><a href="#" class="report-link" data-id="${r.id}">${esc(r.name)}</a></td>
        <td>${r.ad_account_id || 'All'}</td>
        <td style="font-size:12px">${esc(window)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px">${fmtDate(r.created_at)}</td>
        <td style="text-align:right">
          <button class="icon-btn" data-view="${r.id}" title="View">&#128065;</button>
          <button class="icon-btn danger-hover" data-del="${r.id}" data-name="${esc(r.name)}" title="Delete">&#128465;</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.report-link, [data-view]').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); viewReport(el.dataset.id || el.dataset.view); }));
    tbody.querySelectorAll('[data-del]').forEach(el =>
      el.addEventListener('click', () => askDelete(el.dataset.del, el.dataset.name)));
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Detail view ─────────────────────────────────────── */
async function viewReport(id) {
  try {
    const r = await api.get(`/api/reports/${id}`);
    if (!r || !r.result) { showToast('Report has no result data', 'error'); return; }
    currentView = 'detail';
    tbl.style.display     = 'none';
    emptyEl.style.display = 'none';
    detailEl.style.display = 'block';

    const res = r.result;
    const w   = res.window || {};

    // Meta line
    document.getElementById('detail-meta').textContent =
      `${res.accountName || 'All accounts'} · Generated ${fmtDate(res.generatedAt)}`;

    // Window card
    document.getElementById('detail-window').innerHTML =
      `<div style="font-size:13px;color:var(--muted)">
         Window: <strong>${esc(w.from)}</strong> to <strong>${esc(w.to)}</strong>
         (${w.days} days) · ${res.creativesInWindow || 0} creatives
       </div>`;

    // KPIs
    const t = res.totals || {};
    document.getElementById('detail-kpis').innerHTML = [
      kpiCard('Spend',       fmt.money(t.spend)),
      kpiCard('Revenue',     fmt.money(t.revenue)),
      kpiCard('ROAS',        fmt.ratio(t.roas)),
      kpiCard('CTR',         fmt.pct(t.ctr)),
      kpiCard('CPA',         fmt.cents(t.cpa)),
      kpiCard('Impressions', fmt.num(t.impressions)),
    ].join('');

    // Top performers
    renderPerformers('#top-table tbody', res.topPerformers || []);
    // Bottom performers
    renderPerformers('#bottom-table tbody', res.bottomPerformers || []);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function kpiCard(label, value) {
  return `<div class="kpi"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
}

function renderPerformers(sel, list) {
  const tb = document.querySelector(sel);
  if (!list.length) {
    tb.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center">No data</td></tr>';
    return;
  }
  tb.innerHTML = list.map((p, i) => `<tr>
    <td style="color:var(--muted)">${i + 1}</td>
    <td>${esc(p.name)}</td>
    <td class="num">${fmt.money(p.spend)}</td>
    <td class="num">${fmt.money(p.revenue)}</td>
    <td class="num">${fmt.ratio(p.roas)}</td>
  </tr>`).join('');
}

/* ── Back button ─────────────────────────────────────── */
document.getElementById('back-btn').addEventListener('click', loadList);

/* ── Generate modal ──────────────────────────────────── */
function openGenerate() {
  genForm.reset();
  genErr.style.display = 'none';
  // Set default dates: last 30 days
  const today = new Date();
  const from  = new Date(today);
  from.setDate(from.getDate() - 30);
  document.getElementById('gen-to').value   = today.toISOString().slice(0, 10);
  document.getElementById('gen-from').value = from.toISOString().slice(0, 10);
  modal.style.display = 'flex';
}
function closeGenerate() { modal.style.display = 'none'; }

document.getElementById('gen-btn').addEventListener('click', openGenerate);
document.getElementById('gen-empty-btn').addEventListener('click', openGenerate);
document.getElementById('modal-close').addEventListener('click', closeGenerate);
document.getElementById('cancel-btn').addEventListener('click', closeGenerate);
modal.addEventListener('click', e => { if (e.target === modal) closeGenerate(); });

genForm.addEventListener('submit', async e => {
  e.preventDefault();
  genErr.style.display = 'none';
  const fd = Object.fromEntries(new FormData(genForm).entries());
  const body = {
    account_id: fd.account_id || null,
    name:       fd.name || undefined,
    from:       fd.from || undefined,
    to:         fd.to   || undefined,
    top_n:      fd.top_n ? Number(fd.top_n) : undefined,
  };
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = 'Generating…';
  try {
    await api.post('/api/reports/generate', body);
    showToast('Report generated');
    closeGenerate();
    loadList();
  } catch (err) {
    genErr.textContent = err.message;
    genErr.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
});

/* ── Delete confirm ──────────────────────────────────── */
function askDelete(id, name) {
  pendingDelete = id;
  document.getElementById('confirm-name').textContent = name;
  confirmEl.style.display = 'flex';
}

document.getElementById('confirm-cancel').addEventListener('click', () => {
  confirmEl.style.display = 'none';
  pendingDelete = null;
});
document.getElementById('confirm-ok').addEventListener('click', async () => {
  if (!pendingDelete) return;
  try {
    await api.del(`/api/reports/${pendingDelete}`);
    showToast('Report deleted');
    confirmEl.style.display = 'none';
    pendingDelete = null;
    loadList();
  } catch (e) {
    showToast(e.message, 'error');
  }
});
confirmEl.addEventListener('click', e => { if (e.target === confirmEl) { confirmEl.style.display = 'none'; pendingDelete = null; } });

/* ── Keyboard ────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeGenerate(); confirmEl.style.display = 'none'; }
});

/* ── Populate account dropdown ───────────────────────── */
async function loadAccounts() {
  try {
    const rows = await api.get('/api/accounts');
    rows.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      acctSel.appendChild(opt);
    });
  } catch (_) { /* no-op */ }
}

/* ── Init ────────────────────────────────────────────── */
loadAccounts();
loadList();
