const db = require('../db');

// Safe division
const safe = (n, d) => (d > 0 ? n / d : 0);

function deriveKpis(row) {
  return {
    spend: row.spend || 0,
    impressions: row.impressions || 0,
    clicks: row.clicks || 0,
    purchases: row.purchases || 0,
    revenue: row.revenue || 0,
    roas: safe(row.revenue, row.spend),
    cpa: safe(row.spend, row.purchases),
    ctr: safe(row.clicks, row.impressions),
    cpm: safe(row.spend * 1000, row.impressions),
    cpc: safe(row.spend, row.clicks),
  };
}

function dateClause(from, to) {
  const conds = [];
  const params = {};
  if (from) { conds.push('i.date >= @from'); params.from = from; }
  if (to)   { conds.push('i.date <= @to');   params.to   = to;   }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

function totals({ from, to } = {}) {
  const { where, params } = dateClause(from, to);
  const row = db.prepare(`
    SELECT COALESCE(SUM(spend),0) spend,
           COALESCE(SUM(impressions),0) impressions,
           COALESCE(SUM(clicks),0) clicks,
           COALESCE(SUM(purchases),0) purchases,
           COALESCE(SUM(revenue),0) revenue
    FROM insights i ${where}
  `).get(params);
  return deriveKpis(row);
}

function creativeLeaderboard({ from, to, sort = 'spend', dir = 'desc', limit = 50, tag } = {}) {
  const { where, params } = dateClause(from, to);
  const tagJoin = tag
    ? 'JOIN creative_tags ct ON ct.creative_id = c.id JOIN tags t ON t.id = ct.tag_id AND t.name = @tag'
    : '';
  if (tag) params.tag = tag;
  const allowedSort = ['spend', 'revenue', 'roas', 'cpa', 'ctr', 'impressions', 'purchases'];
  const sortKey = allowedSort.includes(sort) ? sort : 'spend';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           SUM(i.spend) spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks) clicks,
           SUM(i.purchases) purchases,
           SUM(i.revenue) revenue
    FROM creatives c
    ${tagJoin}
    JOIN ads a ON a.creative_id = c.id
    JOIN insights i ON i.ad_id = a.id
    ${where}
    GROUP BY c.id
    HAVING spend > 0
  `).all(params);

  const enriched = rows.map(r => ({ ...r, ...deriveKpis(r) }));
  enriched.sort((a, b) => sortDir === 'ASC' ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]);
  return enriched.slice(0, limit);
}

function creativeDetail(id, { from, to } = {}) {
  const creative = db.prepare('SELECT * FROM creatives WHERE id = ?').get(id);
  if (!creative) return null;

  const tags = db.prepare(`
    SELECT t.name FROM tags t JOIN creative_tags ct ON ct.tag_id = t.id
    WHERE ct.creative_id = ? ORDER BY t.name
  `).all(id).map(r => r.name);

  const { where, params } = dateClause(from, to);
  params.cid = id;

  const totalsRow = db.prepare(`
    SELECT SUM(i.spend) spend, SUM(i.impressions) impressions,
           SUM(i.clicks) clicks, SUM(i.purchases) purchases, SUM(i.revenue) revenue
    FROM insights i JOIN ads a ON a.id = i.ad_id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
  `).get(params);

  const trend = db.prepare(`
    SELECT i.date,
           SUM(i.spend) spend,
           SUM(i.impressions) impressions,
           SUM(i.clicks) clicks,
           SUM(i.purchases) purchases,
           SUM(i.revenue) revenue
    FROM insights i JOIN ads a ON a.id = i.ad_id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
    GROUP BY i.date ORDER BY i.date
  `).all(params).map(r => ({ date: r.date, ...deriveKpis(r) }));

  const placements = db.prepare(`
    SELECT a.campaign, a.adset,
           SUM(i.spend) spend, SUM(i.impressions) impressions,
           SUM(i.clicks) clicks, SUM(i.purchases) purchases, SUM(i.revenue) revenue
    FROM ads a JOIN insights i ON i.ad_id = a.id
    ${where ? where + ' AND' : 'WHERE'} a.creative_id = @cid
    GROUP BY a.campaign, a.adset
  `).all(params).map(r => ({ campaign: r.campaign, adset: r.adset, ...deriveKpis(r) }));

  return { creative, tags, totals: deriveKpis(totalsRow), trend, placements };
}

// Fatigue: ROAS in last 7 days dropped >30% vs prior 7 days, with min spend gate.
function fatigueAlerts({ minSpend = 100 } = {}) {
  const rows = db.prepare(`
    WITH recent AS (
      SELECT a.creative_id,
             SUM(CASE WHEN i.date >= date('now','-7 days') THEN i.spend ELSE 0 END) s_now,
             SUM(CASE WHEN i.date >= date('now','-7 days') THEN i.revenue ELSE 0 END) r_now,
             SUM(CASE WHEN i.date < date('now','-7 days') AND i.date >= date('now','-14 days') THEN i.spend ELSE 0 END) s_prev,
             SUM(CASE WHEN i.date < date('now','-7 days') AND i.date >= date('now','-14 days') THEN i.revenue ELSE 0 END) r_prev
      FROM ads a JOIN insights i ON i.ad_id = a.id
      WHERE i.date >= date('now','-14 days')
      GROUP BY a.creative_id
    )
    SELECT c.id, c.name, c.thumbnail_url, s_now, r_now, s_prev, r_prev
    FROM recent JOIN creatives c ON c.id = recent.creative_id
    WHERE s_now >= @minSpend AND s_prev >= @minSpend
  `).all({ minSpend });

  return rows
    .map(r => {
      const roasNow = safe(r.r_now, r.s_now);
      const roasPrev = safe(r.r_prev, r.s_prev);
      const drop = roasPrev > 0 ? (roasPrev - roasNow) / roasPrev : 0;
      return { id: r.id, name: r.name, thumbnail_url: r.thumbnail_url,
               roas_now: roasNow, roas_prev: roasPrev, drop };
    })
    .filter(r => r.drop > 0.30)
    .sort((a, b) => b.drop - a.drop);
}

module.exports = { deriveKpis, totals, creativeLeaderboard, creativeDetail, fatigueAlerts };
