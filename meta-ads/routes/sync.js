const express = require('express');
const db = require('../db');
const sync = require('../services/sync');

const router = express.Router();

// POST /api/sync
// Body (all optional):
//   { account_id: <int> }  -> sync a single account
//   {}                     -> sync every status='active' account
//
// Returns a structured summary with per-account results so the UI can
// render a table of successes and failures without further round-trips.
router.post('/', express.json(), async (req, res) => {
  const body = req.body || {};
  const accountId = body.account_id != null ? Number(body.account_id) : null;

  let targets;
  if (accountId != null) {
    if (!Number.isFinite(accountId)) {
      return res.status(400).json({ error: 'account_id must be a number' });
    }
    const row = db.prepare('SELECT id, name, external_id, status FROM ad_accounts WHERE id = ?').get(accountId);
    if (!row) return res.status(404).json({ error: 'account not found' });
    targets = [row];
  } else {
    targets = db.prepare(`
      SELECT id, name, external_id, status FROM ad_accounts
      WHERE status = 'active' ORDER BY id
    `).all();
  }

  if (!targets.length) {
    return res.json({
      ok: true,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      requested: 0, succeeded: 0, failed: 0, skipped: 0,
      results: [],
    });
  }

  const startedAt = new Date().toISOString();
  const results = [];

  // Run sequentially to keep Graph API rate-limit pressure predictable.
  for (const t of targets) {
    const t0 = Date.now();
    try {
      const r = await sync.syncNow(t.id);
      results.push({
        account_id: t.id,
        external_id: t.external_id,
        name: t.name,
        status: 'ok',
        is_initial: r.is_initial,
        window_days: r.window_days,
        since: r.since,
        until: r.until,
        rows_fetched: r.rows,
        rows_inserted: r.inserted,
        analysis: r.analysis || null,
        duration_ms: Date.now() - t0,
      });
    } catch (e) {
      const msg = String(e.message || e);
      const skipped = msg === 'no token available for this account';
      results.push({
        account_id: t.id,
        external_id: t.external_id,
        name: t.name,
        status: skipped ? 'skipped' : 'error',
        reason: skipped ? 'no_token' : undefined,
        error: skipped ? undefined : msg,
        duration_ms: Date.now() - t0,
      });
    }
  }

  const succeeded = results.filter(r => r.status === 'ok').length;
  const failed    = results.filter(r => r.status === 'error').length;
  const skipped   = results.filter(r => r.status === 'skipped').length;

  res.status(failed > 0 && succeeded === 0 ? 502 : 200).json({
    ok: failed === 0,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    requested: targets.length,
    succeeded, failed, skipped,
    results,
  });
});

module.exports = router;
