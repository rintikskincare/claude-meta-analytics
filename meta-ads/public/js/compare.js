function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function loadPicker() {
  const list = await api.get('/api/creatives');
  const sel = document.getElementById('picker');
  sel.innerHTML = list.map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${c.format})</option>`).join('');
}

document.getElementById('go').addEventListener('click', async () => {
  const sel = document.getElementById('picker');
  const ids = Array.from(sel.selectedOptions).map(o => o.value);
  if (ids.length < 2) return alert('Pick at least 2 creatives.');
  if (ids.length > 4) return alert('Pick at most 4 creatives.');
  const rows = await api.get('/api/creatives/compare/many?ids=' + ids.join(','));
  render(rows);
});

function render(rows) {
  const metrics = [
    ['spend', 'Spend', fmt.money],
    ['revenue', 'Revenue', fmt.money],
    ['roas', 'ROAS', fmt.ratio],
    ['cpa', 'CPA', fmt.cents],
    ['ctr', 'CTR', fmt.pct],
    ['cpm', 'CPM', fmt.cents],
    ['impressions', 'Impressions', fmt.num],
    ['clicks', 'Clicks', fmt.num],
    ['purchases', 'Purchases', fmt.num],
  ];
  // best per row: roas/ctr higher is better; cpa/cpm lower is better
  const better = { roas: 'high', ctr: 'high', cpa: 'low', cpm: 'low' };

  const head = `<tr><th>Metric</th>${rows.map(r => `<th>${escapeHtml(r.name)}</th>`).join('')}</tr>`;
  const body = metrics.map(([k, label, f]) => {
    const vals = rows.map(r => r[k]);
    let bestIdx = -1;
    if (better[k]) {
      bestIdx = vals.reduce((bi, v, i) => (better[k] === 'high' ? v > vals[bi] : v < vals[bi]) ? i : bi, 0);
    }
    return `<tr><td>${label}</td>${rows.map((r, i) =>
      `<td class="num ${i === bestIdx ? 'good' : ''}">${f(r[k])}</td>`
    ).join('')}</tr>`;
  }).join('');

  const thumbs = `<tr><td></td>${rows.map(r =>
    `<td><img class="thumb" style="width:80px;height:80px" src="${r.thumbnail_url || ''}" onerror="this.style.visibility='hidden'"></td>`
  ).join('')}</tr>`;

  document.getElementById('result').innerHTML = `<table>${head}${thumbs}${body}</table>`;
}

loadPicker();
