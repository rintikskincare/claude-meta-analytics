// Creatives tab: table + card views, filtering, group-by, column visibility.
// ---------------------------------------------------------------------------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function label(s) {
  return esc(String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));
}

// ── State ──────────────────────────────────────────────────────────────────
let allRows = [];
let filterOptions = {};
let view = localStorage.getItem('creatives-view') || 'table';
let delivery = 'all';
let groupBy = '';
let searchDebounce = null;

// Column definitions: key, label, formatter, numeric flag.
const COLUMNS = [
  { key: 'thumbnail_url', label: '',             fmt: thumbHtml, num: false, default: true },
  { key: 'name',          label: 'Name',         fmt: nameHtml,  num: false, default: true },
  { key: 'format',        label: 'Format',       fmt: label,     num: false, default: true },
  { key: 'ad_type',       label: 'Ad type',      fmt: label,     num: false, default: true },
  { key: 'asset_type',    label: 'Asset type',   fmt: label,     num: false, default: false },
  { key: 'analysis_status',label:'Analysis',     fmt: statusBadge,num:false, default: true },
  { key: 'messaging_angle',label:'Angle',        fmt: label,     num: false, default: false },
  { key: 'funnel_stage',  label: 'Funnel',       fmt: label,     num: false, default: true },
  { key: 'tags',          label: 'Tags',          fmt: tagsHtml,  num: false, default: true },
  { key: 'created_at',    label: 'Created',       fmt: shortDate, num: false, default: false },
];

// Persisted column visibility. Falls back to the column's default flag.
let visibleCols = (() => {
  try { return JSON.parse(localStorage.getItem('creatives-cols')); } catch { return null; }
})() || Object.fromEntries(COLUMNS.map(c => [c.key, c.default]));

function saveCols() { localStorage.setItem('creatives-cols', JSON.stringify(visibleCols)); }
function activeCols() { return COLUMNS.filter(c => visibleCols[c.key]); }

// ── Formatters ─────────────────────────────────────────────────────────────
function thumbHtml(url) {
  if (!url) return '<span class="thumb-ph"></span>';
  return `<img class="thumb" src="${esc(url)}" onerror="this.style.visibility='hidden'" alt="">`;
}
function nameHtml(v, row) {
  return `<a href="/creative.html?id=${row.id}">${esc(v)}</a>`;
}
function statusBadge(v) {
  const cls = v === 'analyzed' ? 'badge-good' : v === 'error' ? 'badge-bad' : 'badge-muted';
  return `<span class="badge ${cls}">${label(v)}</span>`;
}
function tagsHtml(arr) {
  if (!arr || !arr.length) return '<span class="muted">—</span>';
  return arr.map(t => `<span class="tag">${esc(t)}</span>`).join(' ');
}
function shortDate(v) { return v ? esc(String(v).slice(0, 10)) : ''; }

// ── Data fetching ──────────────────────────────────────────────────────────
async function fetchFilterOptions() {
  filterOptions = await api.get('/api/creatives/filter-options');
  for (const sel of $$('.filter')) {
    const key = sel.dataset.filter;
    const opts = filterOptions[key] || [];
    const dflt = sel.querySelector('option').outerHTML;
    sel.innerHTML = dflt + opts.map(o => {
      if (typeof o === 'object') {
        return `<option value="${o.id}">${esc(o.name || o.external_id)}</option>`;
      }
      return `<option value="${esc(o)}">${label(o)}</option>`;
    }).join('');
  }
}

async function fetchCreatives() {
  showLoading(true);
  const params = {};
  for (const sel of $$('.filter')) {
    if (sel.value) params[sel.dataset.filter] = sel.value;
  }
  const q = $('#search').value.trim();
  if (q) params.q = q;
  if (delivery !== 'all') params.delivery = delivery;
  allRows = await api.get('/api/creatives?' + qs(params));
  showLoading(false);
  render();
}

// ── Rendering ──────────────────────────────────────────────────────────────
function render() {
  const count = allRows.length;
  $('#result-count').textContent = count
    ? `${count} creative${count !== 1 ? 's' : ''}`
    : '';

  if (!count) {
    $('#empty').style.display = 'block';
    $('#table-view').style.display = 'none';
    $('#card-view').style.display = 'none';
    return;
  }
  $('#empty').style.display = 'none';

  if (view === 'table') renderTable();
  else renderCards();
}

// ── Table view ─────────────────────────────────────────────────────────────
function renderTable() {
  $('#table-view').style.display = 'block';
  $('#card-view').style.display = 'none';

  const cols = activeCols();
  $('#thead-row').innerHTML = cols
    .map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.label)}</th>`)
    .join('');

  const tbody = document.querySelector('#tbl tbody');
  const grouped = groupRows(allRows);

  let html = '';
  for (const g of grouped) {
    if (g.header != null) {
      html += `<tr class="group-row"><td colspan="${cols.length}">${esc(g.header) || '<em>None</em>'}</td></tr>`;
    }
    for (const r of g.rows) {
      html += '<tr>' + cols.map(c =>
        `<td${c.num ? ' class="num"' : ''}>${c.fmt(r[c.key], r)}</td>`
      ).join('') + '</tr>';
    }
  }
  tbody.innerHTML = html;
}

function groupRows(rows) {
  if (!groupBy) return [{ header: null, rows }];
  const map = new Map();
  for (const r of rows) {
    const key = (groupBy === 'account'
      ? accountLabel(r.ad_account_id)
      : r[groupBy]) || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([header, rows]) => ({ header: label(header), rows }));
}

function accountLabel(id) {
  if (!id) return '';
  const opts = filterOptions.account_id || [];
  const hit = opts.find(o => o.id === id);
  return hit ? hit.name || hit.external_id : `#${id}`;
}

// ── Card view ──────────────────────────────────────────────────────────────
function renderCards() {
  $('#table-view').style.display = 'none';
  const grid = $('#card-view');
  grid.style.display = 'grid';

  grid.innerHTML = allRows.map(r => `
    <a href="/creative.html?id=${r.id}" class="ccard">
      <div class="ccard-thumb">
        ${r.thumbnail_url
          ? `<img src="${esc(r.thumbnail_url)}" onerror="this.style.visibility='hidden'" alt="">`
          : '<div class="thumb-ph-lg"></div>'}
        <span class="badge ${r.analysis_status === 'analyzed' ? 'badge-good' : 'badge-muted'} ccard-badge">
          ${label(r.analysis_status)}
        </span>
      </div>
      <div class="ccard-body">
        <div class="ccard-name">${esc(r.name)}</div>
        <div class="ccard-meta">
          ${r.format ? `<span class="chip">${label(r.format)}</span>` : ''}
          ${r.ad_type ? `<span class="chip">${label(r.ad_type)}</span>` : ''}
          ${r.funnel_stage ? `<span class="chip">${label(r.funnel_stage)}</span>` : ''}
        </div>
        ${r.tags && r.tags.length
          ? `<div class="ccard-tags">${r.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>`
          : ''}
      </div>
    </a>
  `).join('');
}

// ── Loading / empty ────────────────────────────────────────────────────────
function showLoading(on) {
  $('#loading').style.display = on ? 'block' : 'none';
  if (on) {
    $('#table-view').style.display = 'none';
    $('#card-view').style.display = 'none';
    $('#empty').style.display = 'none';
  }
}

// ── Column visibility menu ─────────────────────────────────────────────────
function buildColsMenu() {
  const menu = $('#cols-menu');
  menu.innerHTML = COLUMNS.filter(c => c.label).map(c => `
    <label class="menu-item">
      <input type="checkbox" data-col="${c.key}" ${visibleCols[c.key] ? 'checked' : ''}>
      ${esc(c.label)}
    </label>`).join('');
  menu.addEventListener('change', e => {
    const key = e.target.dataset.col;
    visibleCols[key] = e.target.checked;
    saveCols();
    if (view === 'table') renderTable();
  });
}

$('#cols-btn').addEventListener('click', e => {
  e.stopPropagation();
  const m = $('#cols-menu');
  m.hidden = !m.hidden;
});
document.addEventListener('click', () => { $('#cols-menu').hidden = true; });

// ── View toggle ────────────────────────────────────────────────────────────
function setView(v) {
  view = v;
  localStorage.setItem('creatives-view', v);
  $$('.seg-btn').forEach(b => {
    const active = b.dataset.view === v;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active);
  });
  $$('.table-only').forEach(el => { el.style.display = v === 'table' ? '' : 'none'; });
  render();
}
$$('.seg-btn').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

// ── Group-by ───────────────────────────────────────────────────────────────
$('#group-by').addEventListener('change', e => { groupBy = e.target.value; render(); });

// ── Delivery-status toggle ─────────────────────────────────────────────────
$$('[data-delivery]').forEach(btn => btn.addEventListener('click', () => {
  delivery = btn.dataset.delivery;
  $$('[data-delivery]').forEach(b => {
    const on = b.dataset.delivery === delivery;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  fetchCreatives();
}));

// ── Filters ────────────────────────────────────────────────────────────────
$$('.filter').forEach(sel => sel.addEventListener('change', fetchCreatives));
$('#search').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(fetchCreatives, 250);
});
$('#clear-filters').addEventListener('click', clearFilters);
$('#empty-clear').addEventListener('click', clearFilters);
function clearFilters() {
  $$('.filter').forEach(s => { s.value = ''; });
  $('#search').value = '';
  // Reset delivery toggle to "All Ads".
  delivery = 'all';
  $$('[data-delivery]').forEach(b => {
    const on = b.dataset.delivery === 'all';
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  fetchCreatives();
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async function init() {
  buildColsMenu();
  setView(view);
  await fetchFilterOptions();
  await fetchCreatives();
})();
