// Win Rate Analysis tab
const state = { sort: 'score', dir: 'desc', verdict: 'all', funnel: '' };
let data = null; // latest API response

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Funnel labels for display.
const FUNNEL_LABEL = {
  awareness: 'TOF — Awareness',
  consideration: 'MOF — Consideration',
  conversion: 'BOF — Conversion',
  retention: 'BOF — Retention',
  unknown: 'Unclassified',
};
const FUNNEL_ORDER = ['awareness', 'consideration', 'conversion', 'retention', 'unknown'];

// Format the score value according to what it represents.
function fmtScore(c) {
  if (c.scoreLabel === 'CTR' || c.scoreLabel === 'CTR + CPC') return fmt.pct(c.score);
  return fmt.ratio(c.score);
}

// ── Load ──

async function loadAll() {
  const params = {
    from: document.getElementById('from').value,
    to: document.getElementById('to').value,
  };
  const thresholdInput = document.getElementById('threshold').value;
  if (thresholdInput) params.threshold = thresholdInput;

  document.getElementById('status').textContent = 'Loading...';
  try {
    data = await api.get('/api/metrics/win-rate?' + qs(params));
  } catch (e) {
    document.getElementById('status').textContent = 'Error: ' + e.message;
    return;
  }

  if (!data.creatives.length) {
    document.getElementById('kpis').innerHTML = '';
    document.getElementById('funnel-cards').innerHTML = '';
    document.querySelector('#scoreboard tbody').innerHTML = '';
    document.getElementById('empty').style.display = '';
    document.getElementById('status').textContent = '';
    return;
  }
  document.getElementById('empty').style.display = 'none';

  renderKpis(data.summary);
  renderFunnelCards(data.funnels, data.summary.roasThreshold);
  populateFunnelFilter(data.funnels);
  renderTable();
  document.getElementById('status').textContent =
    data.creatives.length + ' creatives analyzed';
}

// ── KPI cards ──

function renderKpis(s) {
  const tiles = [
    ['Total Creatives', fmt.num(s.total)],
    ['Winners', `<span class="good">${fmt.num(s.winners)}</span>`],
    ['Losers', `<span class="bad">${fmt.num(s.losers)}</span>`],
    ['Win Rate', `<span class="${s.winRate >= 0.5 ? 'good' : 'bad'}">${fmt.pct(s.winRate)}</span>`],
    ['Total Spend', fmt.money(s.totalSpend)],
    ['Total Revenue', fmt.money(s.totalRevenue)],
    ['Blended ROAS', `<span class="${s.blendedRoas >= s.roasThreshold ? 'good' : 'bad'}">${fmt.ratio(s.blendedRoas)}</span>`],
    ['ROAS Threshold', fmt.ratio(s.roasThreshold)],
  ];
  document.getElementById('kpis').innerHTML = tiles
    .map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');
}

// ── Funnel breakdown cards ──

function renderFunnelCards(funnels, threshold) {
  const el = document.getElementById('funnel-cards');
  const ordered = FUNNEL_ORDER.filter(f => funnels[f]);
  if (!ordered.length) { el.innerHTML = ''; return; }

  el.innerHTML = ordered.map(f => {
    const d = funnels[f];
    const label = FUNNEL_LABEL[f] || f;
    const wrClass = d.winRate >= 0.5 ? 'good' : 'bad';
    const roasClass = d.roas >= threshold ? 'good' : 'bad';
    return `
      <div class="card wr-funnel-card">
        <div class="wr-funnel-label">${label}</div>
        <div class="wr-funnel-stat">
          <span class="wr-funnel-big ${wrClass}">${fmt.pct(d.winRate)}</span>
          <span class="muted small">win rate</span>
        </div>
        <div class="wr-funnel-row">
          <span>${d.winners} / ${d.total} winners</span>
          <span class="${roasClass}">${fmt.ratio(d.roas)} ROAS</span>
        </div>
        <div class="wr-funnel-row muted small">
          <span>${fmt.money(d.spend)} spend</span>
          <span>${fmt.money(d.revenue)} rev</span>
        </div>
      </div>`;
  }).join('');
}

// ── Funnel filter dropdown ──

function populateFunnelFilter(funnels) {
  const sel = document.getElementById('funnel-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All funnels</option>' +
    FUNNEL_ORDER.filter(f => funnels[f])
      .map(f => `<option value="${f}">${FUNNEL_LABEL[f] || f}</option>`)
      .join('');
  sel.value = current;
}

// ── Scoreboard table ──

function renderTable() {
  if (!data) return;
  let rows = data.creatives;

  // Filter by verdict.
  if (state.verdict === 'winners') rows = rows.filter(c => c.isWinner);
  if (state.verdict === 'losers')  rows = rows.filter(c => !c.isWinner);

  // Filter by funnel.
  if (state.funnel) rows = rows.filter(c => c.funnel === state.funnel);

  // Sort.
  const dir = state.dir === 'asc' ? 1 : -1;
  rows = [...rows].sort((a, b) => {
    // Primary: funnel order (keep funnels grouped).
    const fa = FUNNEL_ORDER.indexOf(a.funnel);
    const fb = FUNNEL_ORDER.indexOf(b.funnel);
    if (fa !== fb) return fa - fb;
    // Secondary: chosen sort key.
    return ((a[state.sort] || 0) - (b[state.sort] || 0)) * dir;
  });

  const tbody = document.querySelector('#scoreboard tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:32px">No matching creatives.</td></tr>';
    return;
  }

  let lastFunnel = '';
  let html = '';
  for (const c of rows) {
    if (c.funnel !== lastFunnel) {
      lastFunnel = c.funnel;
      const fLabel = FUNNEL_LABEL[c.funnel] || c.funnel;
      const fData = data.funnels[c.funnel];
      const fInfo = fData ? ` (${fData.winners}/${fData.total} winners)` : '';
      html += `<tr class="group-row"><td colspan="10">${fLabel}${fInfo}</td></tr>`;
    }
    const verdictBadge = c.isWinner
      ? '<span class="badge badge-good">Winner</span>'
      : '<span class="badge badge-bad">Loser</span>';
    const roasClass = c.roas >= data.summary.roasThreshold ? 'good' : c.roas < 1 ? 'bad' : '';

    html += `
      <tr>
        <td><img class="thumb" src="${c.thumbnail_url || ''}" alt="" onerror="this.style.visibility='hidden'"></td>
        <td>
          <a href="/creative.html?id=${c.id}">${escapeHtml(c.name)}</a>
          <div style="color:var(--muted);font-size:11px">${c.format}${c.asset_type ? ' / ' + c.asset_type.replace(/_/g, ' ') : ''}</div>
        </td>
        <td><span class="chip">${c.funnel}</span></td>
        <td class="num"><strong>${fmtScore(c)}</strong><div style="color:var(--muted);font-size:10px">${c.scoreLabel}</div></td>
        <td class="num">${fmt.money(c.spend)}</td>
        <td class="num">${fmt.money(c.revenue)}</td>
        <td class="num ${roasClass}">${fmt.ratio(c.roas)}</td>
        <td class="num">${fmt.pct(c.ctr)}</td>
        <td class="num">${fmt.cents(c.cpa)}</td>
        <td>${verdictBadge}</td>
      </tr>`;
  }
  tbody.innerHTML = html;
}

// ── Event wiring ──

document.getElementById('apply').addEventListener('click', loadAll);

// Verdict segmented toggle.
document.querySelectorAll('#verdict-seg .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#verdict-seg .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.verdict = btn.dataset.v;
    renderTable();
  });
});

// Funnel filter.
document.getElementById('funnel-filter').addEventListener('change', e => {
  state.funnel = e.target.value;
  renderTable();
});

// Sortable headers.
document.querySelectorAll('#scoreboard th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    state.dir = (state.sort === k && state.dir === 'desc') ? 'asc' : 'desc';
    state.sort = k;
    renderTable();
  });
});

// Init: load date range then data.
(async function init() {
  try {
    const r = await api.get('/api/ads/date-range');
    if (r.min) document.getElementById('from').value = r.min;
    if (r.max) document.getElementById('to').value = r.max;
  } catch {}
  try {
    const s = await api.get('/api/settings');
    if (s.winner_roas_threshold != null) {
      document.getElementById('threshold').value = s.winner_roas_threshold;
    }
  } catch {}
  await loadAll();
})();
