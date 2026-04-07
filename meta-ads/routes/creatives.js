const express = require('express');
const db = require('../db');
const { creativeDetail, deriveKpis } = require('../services/metrics');

const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.format, c.thumbnail_url,
           GROUP_CONCAT(t.name) tags
    FROM creatives c
    LEFT JOIN creative_tags ct ON ct.creative_id = c.id
    LEFT JOIN tags t ON t.id = ct.tag_id
    GROUP BY c.id ORDER BY c.name
  `).all().map(r => ({ ...r, tags: r.tags ? r.tags.split(',') : [] }));
  res.json(rows);
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
