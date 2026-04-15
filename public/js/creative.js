const id = getUrlParam('id');

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function load() {
  const data = await api.get(`/api/creatives/${id}`);
  renderHeader(data.creative, data.tags);
  renderKpis(data.totals);
  renderTrend(data.trend);
  renderPlacements(data.placements);
}

function renderHeader(c, tags) {
  document.getElementById('header').innerHTML = `
    <img class="thumb" style="width:120px;height:120px" src="${c.thumbnail_url || ''}" onerror="this.style.visibility='hidden'">
    <div style="flex:1">
      <div style="font-size:20px;font-weight:600">${escapeHtml(c.name)}</div>
      <div style="color:var(--muted);font-size:12px;margin-top:4px">${c.format} · ${c.headline ? escapeHtml(c.headline) : ''}</div>
      <div style="margin-top:8px;color:var(--muted);font-size:13px;max-width:600px">${escapeHtml(c.body || '')}</div>
      <div style="margin-top:12px" id="tags">
        ${tags.map(t => `<span class="tag removable" data-tag="${escapeHtml(t)}">${escapeHtml(t)} ×</span>`).join('')}
        <input id="newtag" placeholder="add tag…" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:2px 8px;border-radius:12px;font-size:11px;width:100px">
      </div>
    </div>`;
  document.getElementById('newtag').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const name = e.target.value.trim();
    if (!name) return;
    e.target.disabled = true;
    try {
      await api.post(`/api/creatives/${id}/tags`, { name });
      UI.toast(`Tag "${name}" added`);
      await load();
    } catch (err) {
      UI.toast('Could not add tag: ' + err.message, 'error');
      e.target.disabled = false;
    }
  });
  document.querySelectorAll('.tag.removable').forEach(el => {
    el.addEventListener('click', async () => {
      const tag = el.dataset.tag;
      const ok = await UI.confirmDialog({
        title: 'Remove this tag?',
        message: `Remove "${tag}" from this creative?`,
        confirmLabel: 'Remove tag',
        cancelLabel: 'Keep',
      });
      if (!ok) return;
      try {
        await api.del(`/api/creatives/${id}/tags/${encodeURIComponent(tag)}`);
        UI.toast(`Tag "${tag}" removed`);
        await load();
      } catch (err) {
        UI.toast('Could not remove tag: ' + err.message, 'error');
      }
    });
  });
}

function renderKpis(t) {
  const tiles = [
    ['Spend', fmt.money(t.spend)],
    ['Revenue', fmt.money(t.revenue)],
    ['ROAS', fmt.ratio(t.roas)],
    ['CPA', fmt.cents(t.cpa)],
    ['CTR', fmt.pct(t.ctr)],
    ['Purchases', fmt.num(t.purchases)],
  ];
  document.getElementById('kpis').innerHTML = tiles
    .map(([l, v]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`)
    .join('');
}

let chart;
function renderTrend(trend) {
  const ctx = document.getElementById('trend');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(t => t.date),
      datasets: [
        { label: 'Spend', data: trend.map(t => t.spend), borderColor: '#4f8cff', backgroundColor: 'rgba(79,140,255,0.1)', yAxisID: 'y', tension: 0.3 },
        { label: 'ROAS', data: trend.map(t => t.roas), borderColor: '#4ade80', yAxisID: 'y1', tension: 0.3 },
      ],
    },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position: 'left', grid: { color: '#2a2f3a' }, ticks: { color: '#8a92a4' } },
        y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#8a92a4' } },
        x: { grid: { color: '#2a2f3a' }, ticks: { color: '#8a92a4' } },
      },
      plugins: { legend: { labels: { color: '#e6e8ec' } } },
    },
  });
}

function renderPlacements(rows) {
  document.querySelector('#placements tbody').innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.campaign || '')}</td>
      <td>${escapeHtml(r.adset || '')}</td>
      <td class="num">${fmt.money(r.spend)}</td>
      <td class="num">${fmt.money(r.revenue)}</td>
      <td class="num">${fmt.ratio(r.roas)}</td>
      <td class="num">${fmt.cents(r.cpa)}</td>
      <td class="num">${fmt.pct(r.ctr)}</td>
    </tr>`).join('');
}

load();
