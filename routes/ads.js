const express = require('express');
const multer = require('multer');
const { importCsv } = require('../services/importer');
const { seed } = require('../services/seed');
const db = require('../db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required (multipart field "file")' });
  try {
    const inserted = importCsv(req.file.buffer);
    res.json({ ok: true, rowsInserted: inserted });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/seed', (req, res) => {
  const result = seed({ days: parseInt(req.query.days, 10) || 30 });
  res.json({ ok: true, ...result });
});

router.post('/reset', (req, res) => {
  db.exec('DELETE FROM insights; DELETE FROM ads; DELETE FROM creative_tags; DELETE FROM creatives; DELETE FROM tags;');
  res.json({ ok: true });
});

router.get('/date-range', (req, res) => {
  const r = db.prepare('SELECT MIN(date) as min, MAX(date) as max FROM insights').get();
  res.json(r);
});

module.exports = router;
