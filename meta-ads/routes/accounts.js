const express = require('express');
const db = require('../db');
const sync = require('../services/sync');

const router = express.Router();

const VALID_STATUS = ['active', 'paused', 'error'];

function serialize(row) {
  if (!row) return null;
  // Never leak access_token; expose only whether one is set.
  const { access_token, ...rest } = row;
  return { ...rest, has_token: !!access_token };
  // (last_synced_at / last_sync_status / last_sync_error / last_sync_window
  // flow through automatically via ...rest.)
}

// GET /api/accounts — list all
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM ad_accounts ORDER BY name COLLATE NOCASE
  `).all();
  res.json(rows.map(serialize));
});

// GET /api/accounts/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(serialize(row));
});

// POST /api/accounts — idempotent add. If external_id already exists,
// update the existing row in place and return it with 200 instead of 201.
router.post('/', express.json(), (req, res) => {
  const b = req.body || {};
  const external_id = String(b.external_id || '').trim();
  const name = String(b.name || '').trim();
  if (!external_id) return res.status(400).json({ error: 'external_id required' });
  if (!name)        return res.status(400).json({ error: 'name required' });

  const payload = {
    external_id,
    name,
    platform:     b.platform     || 'meta',
    currency:     b.currency     || 'USD',
    timezone:     b.timezone     || null,
    access_token: b.access_token || null,
    status:       VALID_STATUS.includes(b.status) ? b.status : 'active',
  };

  const existing = db.prepare('SELECT * FROM ad_accounts WHERE external_id = ?').get(external_id);

  if (existing) {
    // Idempotent update: only overwrite fields the caller actually sent.
    const merged = {
      id: existing.id,
      name:         b.name         != null ? payload.name         : existing.name,
      platform:     b.platform     != null ? payload.platform     : existing.platform,
      currency:     b.currency     != null ? payload.currency     : existing.currency,
      timezone:     b.timezone     != null ? payload.timezone     : existing.timezone,
      access_token: b.access_token != null ? payload.access_token : existing.access_token,
      status:       b.status       != null ? payload.status       : existing.status,
    };
    db.prepare(`
      UPDATE ad_accounts SET name=@name, platform=@platform, currency=@currency,
             timezone=@timezone, access_token=@access_token, status=@status
      WHERE id=@id
    `).run(merged);
    const row = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(existing.id);
    // Idempotent re-post: do not re-trigger the initial sync.
    return res.status(200).json({ created: false, account: serialize(row), initialSync: null });
  }

  const info = db.prepare(`
    INSERT INTO ad_accounts (external_id, name, platform, currency, timezone, access_token, status)
    VALUES (@external_id, @name, @platform, @currency, @timezone, @access_token, @status)
  `).run(payload);
  const row = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(info.lastInsertRowid);

  // Auto-trigger the initial sync if a token is available (account-specific
  // or the global Meta token in settings). The runner is async so we return
  // immediately with metadata the UI can use to show a progress indicator.
  let initialSync = null;
  try {
    initialSync = sync.startSync(row.id);
  } catch (e) {
    initialSync = { triggered: false, reason: 'error', error: e.message };
  }

  res.status(201).json({ created: true, account: serialize(row), initialSync });
});

// Manual re-sync. Uses the configured window, not the 90-day baseline,
// unless the account has never been synced.
router.post('/:id/sync', async (req, res) => {
  try {
    const meta = sync.startSync(Number(req.params.id));
    if (!meta.triggered) return res.status(400).json({ error: meta.reason || 'sync not triggered' });
    res.json({ ok: true, sync: meta });
  } catch (e) {
    res.status(e.message === 'account not found' ? 404 : 500).json({ error: e.message });
  }
});

// PUT /api/accounts/:id — partial update. Supports active toggle via
// either `{active: true/false}` or `{status: 'active'|'paused'|'error'}`.
router.put('/:id', express.json(), (req, res) => {
  const row = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });

  const b = req.body || {};
  const patch = {};

  if (b.active != null) {
    patch.status = b.active ? 'active' : 'paused';
  }
  if (b.status != null) {
    if (!VALID_STATUS.includes(b.status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUS.join(', ')}` });
    }
    patch.status = b.status;
  }
  for (const k of ['name', 'platform', 'currency', 'timezone', 'access_token']) {
    if (b[k] != null) patch[k] = b[k];
  }

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: 'no updatable fields in body' });
  }

  const sets = Object.keys(patch).map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE ad_accounts SET ${sets} WHERE id = @id`).run({ ...patch, id: row.id });

  const updated = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(row.id);
  res.json(serialize(updated));
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM ad_accounts WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true, deleted: Number(req.params.id) });
});

module.exports = router;
