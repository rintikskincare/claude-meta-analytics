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
  return `<a href="#" class="detail-link" data-id="${row.id}">${esc(v)}</a>`;
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
  bindDetailLinks(tbody);
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
    <a href="#" class="ccard detail-link" data-id="${r.id}">
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
  bindDetailLinks(grid);
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

// ── Detail modal ──────────────────────────────────────────────────────────
const dm = $('#detail-modal');
const dmLoading = $('#dm-loading');
const dmContent = $('#dm-content');
let dmCurrentId = null;

function bindDetailLinks(container) {
  container.querySelectorAll('.detail-link').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      openDetail(Number(el.dataset.id));
    });
  });
}

function openDetail(id) {
  dmCurrentId = id;
  dm.style.display = 'flex';
  dmLoading.style.display = 'block';
  dmContent.style.display = 'none';
  $('#dm-title').textContent = 'Loading…';
  loadDetail(id);
}
function closeDetail() {
  dm.style.display = 'none';
  dmCurrentId = null;
  // Stop any playing video
  const v = dmContent.querySelector('video');
  if (v) v.pause();
}

$('#dm-close').addEventListener('click', closeDetail);
dm.addEventListener('click', e => { if (e.target === dm) closeDetail(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && dm.style.display === 'flex') closeDetail(); });

async function loadDetail(id) {
  try {
    const data = await api.get(`/api/creatives/${id}`);
    if (dmCurrentId !== id) return; // stale
    renderDetail(data);
  } catch (e) {
    $('#dm-title').textContent = 'Error';
    dmLoading.innerHTML = `<div class="form-err">${esc(e.message)}</div>`;
  }
}

function renderDetail(data) {
  const c = data.creative;
  const t = data.totals;

  $('#dm-title').textContent = c.name;
  $('#dm-full-link').href = `/creative.html?id=${c.id}`;

  // ── Media preview ──
  $('#dm-media').innerHTML = buildMediaPreview(c);

  // ── Copy ──
  const parts = [];
  if (c.headline) parts.push(`<div class="dm-headline">${esc(c.headline)}</div>`);
  if (c.body) parts.push(`<div class="dm-body-text">${esc(c.body)}</div>`);
  if (!parts.length) parts.push(`<div class="muted" style="font-size:12px">No copy available</div>`);
  $('#dm-copy').innerHTML = parts.join('');

  // ── Metrics ──
  const tiles = [
    ['Spend',       fmt.money(t.spend)],
    ['Revenue',     fmt.money(t.revenue)],
    ['ROAS',        fmt.ratio(t.roas)],
    ['CPA',         fmt.cents(t.cpa)],
    ['CTR',         fmt.pct(t.ctr)],
    ['Purchases',   fmt.num(t.purchases)],
  ];
  $('#dm-metrics').innerHTML = tiles.map(([l, v]) =>
    `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`
  ).join('');

  // ── AI tags ──
  const aiFields = [
    ['Asset type',   c.asset_type],
    ['Visual format',c.visual_format],
    ['Angle',        c.messaging_angle],
    ['Hook tactic',  c.hook_tactic],
    ['Offer type',   c.offer_type],
    ['Funnel',       c.funnel_stage],
  ];
  const hasTags = aiFields.some(([, v]) => v);
  let tagsHtmlStr = '';
  if (hasTags) {
    tagsHtmlStr += `<div class="dm-tag-grid">${aiFields.map(([l, v]) =>
      `<div class="dm-tag-item">
        <span class="dm-tag-label">${l}</span>
        <span class="chip">${v ? label(v) : '<span class="muted">—</span>'}</span>
      </div>`
    ).join('')}</div>`;
    if (c.summary) {
      tagsHtmlStr += `<div class="dm-summary">${esc(c.summary)}</div>`;
    }
    if (c.analyzed_at) {
      tagsHtmlStr += `<div class="dm-analyzed-at">Analyzed ${esc(c.analyzed_at.slice(0, 16).replace('T', ' '))}</div>`;
    }
  } else if (c.analysis_status === 'error' && c.analysis_error) {
    tagsHtmlStr = `<div class="dm-no-tags dm-error">Analysis failed: ${esc(c.analysis_error)}</div>`;
  } else {
    tagsHtmlStr = `<div class="dm-no-tags">
      <span class="muted">No AI tags yet.</span> Click Analyze to classify this creative.
    </div>`;
  }
  $('#dm-tags').innerHTML = tagsHtmlStr;

  // ── Manual tags ──
  const manualTags = data.tags || [];
  $('#dm-manual-tags').innerHTML = manualTags.length
    ? `<div class="section-label" style="margin-top:16px">Tags</div>
       <div>${manualTags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>`
    : '';

  // ── Analyze button ──
  renderAnalyzeBtn(c.analysis_status);

  dmLoading.style.display = 'none';
  dmContent.style.display = 'block';
}

function buildMediaPreview(c) {
  const isVideo = c.format === 'video';
  const url = c.thumbnail_url;

  if (isVideo && url) {
    // Try <video> first; on error fall back to thumbnail image, then placeholder.
    return `
      <div class="dm-media-wrap">
        <video class="dm-video" controls preload="metadata"
               poster="${esc(url)}"
               onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <source src="${esc(url)}" type="video/mp4">
        </video>
        <div class="dm-media-fallback" style="display:none">
          <img src="${esc(url)}" alt=""
               onerror="this.parentNode.innerHTML='<div class=\\'dm-ph\\'><div class=\\'dm-ph-icon\\'>&#9654;</div><div class=\\'dm-ph-label\\'>Video preview unavailable</div></div>';">
        </div>
        <span class="dm-format-badge">Video</span>
      </div>`;
  }
  if (url) {
    return `
      <div class="dm-media-wrap">
        <img class="dm-img" src="${esc(url)}" alt=""
             onerror="this.outerHTML='<div class=\\'dm-ph\\'><div class=\\'dm-ph-icon\\'>&#128444;</div><div class=\\'dm-ph-label\\'>Image preview unavailable</div></div>';">
        ${isVideo ? '<span class="dm-format-badge">Video</span>' : ''}
      </div>`;
  }
  // No URL at all — full placeholder.
  const icon = isVideo ? '&#9654;' : '&#128444;';
  const typeLabel = isVideo ? 'Video' : c.format === 'carousel' ? 'Carousel' : 'Image';
  return `
    <div class="dm-media-wrap">
      <div class="dm-ph">
        <div class="dm-ph-icon">${icon}</div>
        <div class="dm-ph-label">${typeLabel} preview unavailable</div>
      </div>
    </div>`;
}

function renderAnalyzeBtn(status) {
  const btn = $('#dm-analyze');
  if (status === 'analyzing') {
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    btn.className = 'ctl-btn ctl-btn-primary dm-btn-analyzing';
  } else if (status === 'analyzed') {
    btn.disabled = false;
    btn.textContent = 'Re-analyze';
    btn.className = 'ctl-btn';
  } else {
    btn.disabled = false;
    btn.textContent = 'Analyze creative';
    btn.className = 'ctl-btn ctl-btn-primary';
  }
}

$('#dm-analyze').addEventListener('click', async () => {
  if (!dmCurrentId) return;
  const btn = $('#dm-analyze');
  btn.disabled = true;
  btn.textContent = 'Analyzing…';
  btn.className = 'ctl-btn ctl-btn-primary dm-btn-analyzing';
  try {
    await api.post(`/api/creatives/${dmCurrentId}/analyze`);
    showToast('Analysis started');
    // Poll until status changes from 'analyzing'.
    pollAnalysis(dmCurrentId);
  } catch (e) {
    showToast(e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Retry analysis';
  }
});

function pollAnalysis(id, attempts = 0) {
  if (attempts > 10 || dmCurrentId !== id) return;
  setTimeout(async () => {
    try {
      const data = await api.get(`/api/creatives/${id}`);
      if (data.creative.analysis_status !== 'analyzing') {
        if (dmCurrentId === id) renderDetail(data);
        fetchCreatives(); // refresh list behind modal
        return;
      }
    } catch { /* ignore */ }
    pollAnalysis(id, attempts + 1);
  }, 1000);
}

function showToast(msg, kind = 'info') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = 'none'; }, 2800);
}

// ── Boot ───────────────────────────────────────────────────────────────────
(async function init() {
  buildColsMenu();
  setView(view);
  await fetchFilterOptions();
  await fetchCreatives();
})();
