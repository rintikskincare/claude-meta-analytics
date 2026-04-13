/* Reports tab — list, history, detail modal with comparison */

const tbl         = document.getElementById('tbl');
const tbody       = tbl.querySelector('tbody');
const emptyEl     = document.getElementById('empty');
const histSection = document.getElementById('history-section');
const histTimeline = document.getElementById('history-timeline');
const modal       = document.getElementById('modal');
const confirmEl   = document.getElementById('confirm');
const detailModal = document.getElementById('detail-modal');
const toastEl     = document.getElementById('toast');
const genForm     = document.getElementById('gen-form');
const genErr      = document.getElementById('gen-err');
const acctSel     = document.getElementById('account-sel');

let pendingDelete = null;
let allReports    = [];

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
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function statusBadge(s) {
  const cls = { done: 'badge-ok', error: 'badge-err', running: 'badge-run' }[s] || '';
  return `<span class="report-badge ${cls}">${esc(s)}</span>`;
}
function windowLabel(p) {
  if (!p) return '—';
  if (p.from && p.to) return `${p.from} → ${p.to}`;
  return `${p.days || '—'} days`;
}

/* ── List ────────────────────────────────────────────── */
async function loadList() {
  try {
    allReports = await api.get('/api/reports');
    if (!allReports.length) {
      tbl.style.display = 'none';
      emptyEl.style.display = 'block';
      histSection.style.display = 'none';
      return;
    }
    tbl.style.display = 'table';
    emptyEl.style.display = 'none';

    tbody.innerHTML = allReports.map(r => {
      return `<tr>
        <td><a href="#" class="report-link" data-id="${r.id}">${esc(r.name)}</a></td>
        <td>${r.ad_account_id || 'All'}</td>
        <td style="font-size:12px">${esc(windowLabel(r.params))}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px">${fmtDate(r.created_at)}</td>
        <td style="text-align:right">
          <button class="icon-btn" data-view="${r.id}" title="View">&#128065;</button>
          <button class="icon-btn danger-hover" data-del="${r.id}" data-name="${esc(r.name)}" title="Delete">&#128465;</button>
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('.report-link, [data-view]').forEach(el =>
      el.addEventListener('click', e => { e.preventDefault(); openDetail(el.dataset.id || el.dataset.view); }));
    tbody.querySelectorAll('[data-del]').forEach(el =>
      el.addEventListener('click', () => askDelete(el.dataset.del, el.dataset.name)));

    renderHistory();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── History Timeline ────────────────────────────────── */
function renderHistory() {
  const done = allReports.filter(r => r.status === 'done');
  if (done.length < 2) {
    histSection.style.display = 'none';
    return;
  }
  histSection.style.display = 'block';
  histTimeline.innerHTML = done.map((r, i) => `
    <div class="rpt-tl-item" data-id="${r.id}">
      <div class="rpt-tl-dot"></div>
      <div class="rpt-tl-info">
        <div class="rpt-tl-name">${esc(r.name)}</div>
        <div class="rpt-tl-meta">${esc(windowLabel(r.params))} · ${fmtDateTime(r.created_at)}</div>
      </div>
      <div class="rpt-tl-badge">${i === 0 ? '<span class="report-badge badge-ok">latest</span>' : ''}</div>
    </div>
  `).join('');
  histTimeline.querySelectorAll('.rpt-tl-item').forEach(el =>
    el.addEventListener('click', () => openDetail(el.dataset.id)));
}

/* ── Detail Modal ────────────────────────────────────── */
function openDetailModal() {
  document.getElementById('rpt-dm-loading').style.display = 'block';
  document.getElementById('rpt-dm-content').style.display = 'none';
  detailModal.style.display = 'flex';
}
function closeDetailModal() { detailModal.style.display = 'none'; }

document.getElementById('dm-rpt-close').addEventListener('click', closeDetailModal);
detailModal.addEventListener('click', e => { if (e.target === detailModal) closeDetailModal(); });

async function openDetail(id) {
  openDetailModal();
  try {
    const data = await api.get(`/api/reports/${id}`);
    if (!data || !data.result) { showToast('Report has no result data', 'error'); closeDetailModal(); return; }
    renderDetail(data, data.previous);
  } catch (e) {
    showToast(e.message, 'error');
    closeDetailModal();
  }
}

function renderDetail(report, previous) {
  document.getElementById('rpt-dm-loading').style.display = 'none';
  document.getElementById('rpt-dm-content').style.display = 'block';

  const res = report.result;
  const prev = previous && previous.result ? previous.result : null;
  const w = res.window || {};
  const pw = prev ? (prev.window || {}) : null;

  // Title
  document.getElementById('dm-rpt-title').textContent = report.name || 'Report Detail';

  // Window banner — always show dates
  document.getElementById('rpt-dm-window').innerHTML =
    `<div>Window: <strong>${esc(w.from || '—')}</strong> to <strong>${esc(w.to || '—')}</strong>` +
    (w.days ? ` (${w.days} days)` : '') +
    ` · ${res.creativesInWindow || 0} creatives</div>` +
    `<div style="font-size:11px;margin-top:4px;opacity:0.7">${esc(res.accountName || 'All accounts')} · Generated ${fmtDateTime(res.generatedAt)}</div>`;

  // Comparison header + previous window
  const compareHdr = document.getElementById('rpt-dm-compare-hdr');
  const noPrev = document.getElementById('rpt-dm-no-prev');
  const prevWindow = document.getElementById('rpt-dm-prev-window');

  if (prev) {
    compareHdr.style.display = 'block';
    noPrev.style.display = 'none';
    prevWindow.style.display = 'block';
    prevWindow.innerHTML = `Previous window: <strong>${esc(pw.from || '—')}</strong> to <strong>${esc(pw.to || '—')}</strong>` +
      (pw.days ? ` (${pw.days} days)` : '') +
      ` · Generated ${fmtDateTime(prev.generatedAt)}`;
  } else {
    compareHdr.style.display = 'none';
    noPrev.style.display = 'block';
    prevWindow.style.display = 'none';
  }

  // KPIs with comparison
  const t = res.totals || {};
  const pt = prev ? (prev.totals || {}) : null;

  const kpis = [
    { label: 'Spend',       key: 'spend',       format: fmt.money,  invert: true },
    { label: 'Revenue',     key: 'revenue',      format: fmt.money,  invert: false },
    { label: 'ROAS',        key: 'roas',         format: fmt.ratio,  invert: false },
    { label: 'CTR',         key: 'ctr',          format: fmt.pct,    invert: false },
    { label: 'CPA',         key: 'cpa',          format: fmt.cents,  invert: true },
    { label: 'Impressions', key: 'impressions',  format: fmt.num,    invert: false },
  ];

  document.getElementById('rpt-dm-kpis').innerHTML = kpis.map(k => {
    const cur = t[k.key] || 0;
    const curStr = k.format(cur);
    let deltaHtml = '';
    let prevStr = '';

    if (pt) {
      const prv = pt[k.key] || 0;
      prevStr = k.format(prv);
      deltaHtml = deltaBadge(cur, prv, k.invert);
    }

    return `<div class="kpi rpt-kpi">
      <div class="label">${k.label}</div>
      <div class="rpt-kpi-row">
        <span class="rpt-kpi-current">${curStr}</span>
        ${pt ? `<span class="rpt-kpi-prev">${prevStr}</span>` : ''}
      </div>
      ${deltaHtml}
    </div>`;
  }).join('');

  // Performers
  renderPerformers('#top-table tbody', res.topPerformers || []);
  renderPerformers('#bottom-table tbody', res.bottomPerformers || []);
}

function deltaBadge(cur, prev, invert) {
  if (prev === 0 && cur === 0) return '<div class="rpt-kpi-delta rpt-kpi-delta-flat">—</div>';
  if (prev === 0) return `<div class="rpt-kpi-delta rpt-kpi-delta-up${invert ? ' invert' : ''}">new</div>`;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const abs = Math.abs(pct);
  if (abs < 0.5) return '<div class="rpt-kpi-delta rpt-kpi-delta-flat">0%</div>';
  const dir = pct > 0 ? 'up' : 'down';
  const arrow = pct > 0 ? '&#9650;' : '&#9660;';
  return `<div class="rpt-kpi-delta rpt-kpi-delta-${dir}${invert ? ' invert' : ''}">${arrow} ${abs.toFixed(1)}%</div>`;
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

/* ── Generate modal ──────────────────────────────────── */
function openGenerate() {
  genForm.reset();
  genErr.style.display = 'none';
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
  if (e.key === 'Escape') { closeGenerate(); closeDetailModal(); confirmEl.style.display = 'none'; }
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
