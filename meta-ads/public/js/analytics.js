// Analytics tab — Win Rate + Recommendations
const state = { sort: 'score', dir: 'desc', verdict: 'all', funnel: '', recAction: 'all', recFunnel: '' };
let data = null;     // win-rate response
let recData = null;  // recommendations response

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
    [data, recData] = await Promise.all([
      api.get('/api/metrics/win-rate?' + qs(params)),
      api.get('/api/metrics/recommendations?' + qs(params)),
    ]);
  } catch (e) {
    document.getElementById('status').textContent = 'Error: ' + e.message;
    return;
  }

  const hasData = data.creatives.length > 0;
  document.getElementById('empty').style.display = hasData ? 'none' : '';
  document.getElementById('recs-section').style.display = hasData ? '' : 'none';

  if (!hasData) {
    document.getElementById('kpis').innerHTML = '';
    document.getElementById('funnel-cards').innerHTML = '';
    document.querySelector('#scoreboard tbody').innerHTML = '';
    document.getElementById('status').textContent = '';
    return;
  }

  renderKpis(data.summary);
  renderFunnelCards(data.funnels, data.summary.roasThreshold);
  populateFunnelFilter(data.funnels);
  renderTable();
  renderRecKpis(recData.summary);
  populateRecFunnelFilter(recData.creatives);
  renderRecCards();
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

// ── Recommendation KPIs ──

function renderRecKpis(s) {
  const tiles = [
    ['Scale', `<span class="good">${s.scale}</span>`],
    ['Watch', `<span style="color:#facc15">${s.watch}</span>`],
    ['Stop', `<span class="bad">${s.stop}</span>`],
    ['Scale Spend', `<span class="good">${fmt.money(s.scaleSpend)}</span>`],
    ['Watch Spend', `<span style="color:#facc15">${fmt.money(s.watchSpend)}</span>`],
    ['Stop Spend', `<span class="bad">${fmt.money(s.stopSpend)}</span>`],
    ['Blended ROAS', fmt.ratio(s.blendedRoas)],
    ['Spend Floor', fmt.money(s.spendFloor)],
  ];
  document.getElementById('rec-kpis').innerHTML = tiles
    .map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');
}

// ── Recommendation funnel filter ──

function populateRecFunnelFilter(creatives) {
  const funnels = [...new Set(creatives.map(c => c.funnel))];
  const ordered = FUNNEL_ORDER.filter(f => funnels.includes(f));
  const sel = document.getElementById('rec-funnel-filter');
  const current = sel.value;
  sel.innerHTML = '<option value="">All funnels</option>' +
    ordered.map(f => `<option value="${f}">${FUNNEL_LABEL[f] || f}</option>`).join('');
  sel.value = current;
}

// ── Recommendation cards ──

const ACTION_LABEL = { scale: 'Scale', watch: 'Watch', stop: 'Stop' };

function renderRecCards() {
  if (!recData) return;
  let items = recData.creatives;

  if (state.recAction !== 'all') items = items.filter(c => c.action === state.recAction);
  if (state.recFunnel) items = items.filter(c => c.funnel === state.recFunnel);

  const el = document.getElementById('rec-cards');
  if (!items.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);padding:32px">No matching creatives.</div>';
    return;
  }

  el.innerHTML = items.map(c => {
    const thumbHtml = c.thumbnail_url
      ? `<img class="rec-thumb" src="${c.thumbnail_url}" alt="" onerror="this.style.visibility='hidden'">`
      : `<div class="rec-thumb"></div>`;

    // Pick the 3 most relevant metrics based on funnel
    let metrics;
    if (c.funnel === 'awareness') {
      metrics = [
        ['CTR', fmt.pct(c.ctr)],
        ['CPM', fmt.cents(c.cpm)],
        ['Impressions', fmt.num(c.impressions)],
      ];
    } else if (c.funnel === 'consideration') {
      metrics = [
        ['CTR', fmt.pct(c.ctr)],
        ['CPC', fmt.cents(c.cpc)],
        ['Clicks', fmt.num(c.clicks)],
      ];
    } else {
      metrics = [
        ['ROAS', fmt.ratio(c.roas)],
        ['CPA', fmt.cents(c.cpa)],
        ['Revenue', fmt.money(c.revenue)],
      ];
    }

    return `
      <div class="rec-card rec-card-${c.action}">
        <div class="rec-head">
          ${thumbHtml}
          <div class="rec-info">
            <div class="rec-name"><a href="/creative.html?id=${c.id}">${escapeHtml(c.name)}</a></div>
            <div class="rec-meta">
              <span class="chip">${c.funnel}</span>
              <span>${c.format}${c.asset_type ? ' / ' + c.asset_type.replace(/_/g, ' ') : ''}</span>
            </div>
          </div>
          <span class="rec-badge rec-badge-${c.action}">${ACTION_LABEL[c.action]}</span>
        </div>
        <div class="rec-rationale">${escapeHtml(c.rationale)}</div>
        <div class="rec-metrics">
          ${metrics.map(([l, v]) => `<div class="rec-metric"><div class="rec-metric-val">${v}</div><div class="rec-metric-label">${l}</div></div>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--muted)">${fmt.money(c.spend)} total spend</div>
      </div>`;
  }).join('');
}

// ── Recommendation events ──

document.querySelectorAll('#rec-action-seg .seg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#rec-action-seg .seg-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.recAction = btn.dataset.a;
    renderRecCards();
  });
});

document.getElementById('rec-funnel-filter').addEventListener('change', e => {
  state.recFunnel = e.target.value;
  renderRecCards();
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
