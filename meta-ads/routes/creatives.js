const express = require('express');
const db = require('../db');
const { creativeDetail, deriveKpis } = require('../services/metrics');

const router = express.Router();

// Filterable columns on creatives. Kept as a whitelist so query params
// can never be spliced into the SQL.
const FILTERS = [
  'account_id',       // -> ad_account_id
  'ad_type',
  'analysis_status',
  'asset_type',
  'messaging_angle',
  'funnel_stage',
];

const FILTER_COLUMN = {
  account_id:      'c.ad_account_id',
  ad_type:         'c.ad_type',
  analysis_status: 'c.analysis_status',
  asset_type:      'c.asset_type',
  messaging_angle: 'c.messaging_angle',
  funnel_stage:    'c.funnel_stage',
};

function buildWhere(query) {
  const conds = [];
  const params = [];
  for (const key of FILTERS) {
    const raw = query[key];
    if (raw == null || raw === '') continue;
    // Accept comma-separated lists for multi-select filters.
    const values = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    if (!values.length) continue;
    const col = FILTER_COLUMN[key];
    if (values.length === 1) {
      conds.push(`${col} = ?`);
      params.push(key === 'account_id' ? Number(values[0]) : values[0]);
    } else {
      conds.push(`${col} IN (${values.map(() => '?').join(',')})`);
      params.push(...(key === 'account_id' ? values.map(Number) : values));
    }
  }
  if (query.q && String(query.q).trim()) {
    conds.push('(c.name LIKE ? OR c.headline LIKE ? OR c.body LIKE ?)');
    const like = '%' + String(query.q).trim() + '%';
    params.push(like, like, like);
  }
  return { where: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

router.get('/', (req, res) => {
  const { where, params } = buildWhere(req.query);
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);

  const rows = db.prepare(`
    SELECT c.id, c.ad_account_id, c.name, c.format, c.thumbnail_url,
           c.ad_type, c.analysis_status, c.asset_type,
           c.messaging_angle, c.funnel_stage,
           c.created_at, c.updated_at,
           GROUP_CONCAT(DISTINCT t.name) tags
      FROM creatives c
      LEFT JOIN creative_tags ct ON ct.creative_id = c.id
      LEFT JOIN tags t ON t.id = ct.tag_id
    ${where}
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE
    LIMIT ?
  `).all(...params, limit).map(r => ({ ...r, tags: r.tags ? r.tags.split(',') : [] }));

  res.json(rows);
});

// Distinct filter-option values across every filterable dimension. Returned
// as a single payload so the UI can populate every dropdown in one fetch.
// NOTE: declared BEFORE /:id so the :id param doesn't swallow the path.
router.get('/filter-options', (req, res) => {
  const scoped = (col, extraWhere = '', extraParams = []) => db.prepare(`
    SELECT DISTINCT ${col} v FROM creatives
    WHERE ${col} IS NOT NULL AND ${col} != '' ${extraWhere}
    ORDER BY ${col} COLLATE NOCASE
  `).all(...extraParams).map(r => r.v);

  // account_id dropdown is joined with ad_accounts so the UI can show names.
  const accounts = db.prepare(`
    SELECT DISTINCT c.ad_account_id id, a.name, a.external_id
      FROM creatives c
      LEFT JOIN ad_accounts a ON a.id = c.ad_account_id
     WHERE c.ad_account_id IS NOT NULL
     ORDER BY a.name COLLATE NOCASE
  `).all();

  res.json({
    account_id:      accounts,
    ad_type:         scoped('ad_type'),
    analysis_status: scoped('analysis_status'),
    asset_type:      scoped('asset_type'),
    messaging_angle: scoped('messaging_angle'),
    funnel_stage:    scoped('funnel_stage'),
  });
});

router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = creativeDetail(id, { from: req.query.from, to: req.query.to });
  if (!data) return res.status(404).json({ error: 'not found' });
  res.json(data);
});

router.post('/:id/tags', express.json(), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name required' });
  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name);
  const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name);
  db.prepare('INSERT OR IGNORE INTO creative_tags (creative_id, tag_id) VALUES (?, ?)').run(id, tag.id);
  res.json({ ok: true });
});

router.delete('/:id/tags/:name', (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare(`
    DELETE FROM creative_tags WHERE creative_id = ?
    AND tag_id = (SELECT id FROM tags WHERE name = ?)
  `).run(id, req.params.name);
  res.json({ ok: true });
});

router.get('/compare/many', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => parseInt(s, 10)).filter(Boolean);
  if (!ids.length) return res.json([]);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           SUM(i.spend) spend, SUM(i.impressions) impressions,
           SUM(i.clicks) clicks, SUM(i.purchases) purchases, SUM(i.revenue) revenue
    FROM creatives c
    JOIN ads a ON a.creative_id = c.id
    JOIN insights i ON i.ad_id = a.id
    WHERE c.id IN (${placeholders})
    GROUP BY c.id
  `).all(...ids).map(r => ({ ...r, ...deriveKpis(r) }));
  res.json(rows);
});

router.get('/tags/all', (req, res) => {
  res.json(db.prepare('SELECT name FROM tags ORDER BY name').all().map(r => r.name));
});

module.exports = router;
