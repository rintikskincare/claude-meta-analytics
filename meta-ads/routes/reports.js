const express = require('express');
const { generateSnapshot, listReports, getReport, deleteReport } = require('../services/reports');

const router = express.Router();

// GET /api/reports — list saved reports.
router.get('/', (req, res) => {
  const accountId = req.query.account_id != null ? Number(req.query.account_id) : undefined;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  res.json(listReports({ accountId, limit }));
});

// GET /api/reports/:id — fetch a single report with full result.
router.get('/:id', (req, res) => {
  const report = getReport(Number(req.params.id));
  if (!report) return res.status(404).json({ error: 'report not found' });
  res.json(report);
});

// POST /api/reports/generate — create a new snapshot report.
router.post('/generate', express.json(), (req, res) => {
  const b = req.body || {};
  const accountId = b.account_id != null ? Number(b.account_id) : null;
  try {
    const { id, report } = generateSnapshot({
      accountId,
      name: b.name || undefined,
      from: b.from || undefined,
      to:   b.to   || undefined,
      days: b.days != null ? Number(b.days) : undefined,
      topN: b.top_n != null ? Number(b.top_n) : undefined,
    });
    res.status(201).json(report);
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ error: e.message });
  }
});

// DELETE /api/reports/:id — remove a saved report.
router.delete('/:id', (req, res) => {
  const ok = deleteReport(Number(req.params.id));
  if (!ok) return res.status(404).json({ error: 'report not found' });
  res.json({ ok: true });
});

module.exports = router;
