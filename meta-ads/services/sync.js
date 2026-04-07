// Background sync of Meta ad account insights.
//
// Rule: the very first sync for a freshly added account pulls a 90-day
// baseline. Subsequent syncs pull the window configured in settings
// (`date_range_days`, default 30).
//
// The actual Graph API fetch is isolated in `fetchInsights` so tests (and
// future offline modes) can stub it. Results are funneled through the
// existing CSV importer (`importRows`) so dedup/upsert logic stays in one
// place.

const db = require('../db');
const settings = require('./settings');
const { importRows } = require('./importer');

const FIRST_SYNC_DAYS = 90;
const GRAPH = 'https://graph.facebook.com/v19.0';

const selectAccount = db.prepare('SELECT * FROM ad_accounts WHERE id = ?');
const markRunning = db.prepare(`
  UPDATE ad_accounts SET last_sync_status = 'running', last_sync_error = NULL WHERE id = ?
`);
const markDone = db.prepare(`
  UPDATE ad_accounts
     SET last_sync_status = 'ok',
         last_sync_error = NULL,
         last_synced_at = datetime('now'),
         last_sync_window = @window
   WHERE id = @id
`);
const markError = db.prepare(`
  UPDATE ad_accounts SET last_sync_status = 'error', last_sync_error = @error WHERE id = @id
`);

function daysAgoISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Choose the correct sync window: 90 days for a never-synced account,
// otherwise the user's configured window.
function windowFor(account) {
  if (!account.last_synced_at) return FIRST_SYNC_DAYS;
  return settings.get('date_range_days') || 30;
}

// Resolve the token to use. Prefer the account-specific token; fall back to
// the global Meta token stored in settings.
function tokenFor(account) {
  if (account.access_token && account.access_token.trim()) return account.access_token.trim();
  return settings.getSecret('meta_access_token') || '';
}

// --- Graph API fetch (swappable for tests) --------------------------------
async function fetchInsights({ accountExternalId, token, since, until }) {
  if (!globalThis.fetch) throw new Error('global fetch not available');

  const out = [];
  let url = new URL(`${GRAPH}/${accountExternalId}/insights`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('level', 'ad');
  url.searchParams.set('time_range', JSON.stringify({ since, until }));
  url.searchParams.set('time_increment', '1');
  url.searchParams.set('fields', [
    'ad_id', 'ad_name', 'campaign_name', 'adset_name', 'date_start',
    'spend', 'impressions', 'clicks', 'actions', 'action_values',
  ].join(','));
  url.searchParams.set('limit', '200');

  // Paginate via `paging.next`. Bound the loop to avoid runaway requests.
  for (let page = 0; page < 50; page++) {
    const resp = await fetch(url);
    let body = null;
    try { body = await resp.json(); } catch {}
    if (!resp.ok || (body && body.error)) {
      const msg = (body && body.error && body.error.message) || `HTTP ${resp.status}`;
      throw new Error(`Meta insights fetch failed: ${msg}`);
    }
    if (Array.isArray(body.data)) out.push(...body.data);
    if (!body.paging || !body.paging.next) break;
    url = new URL(body.paging.next);
  }
  return out;
}

// Convert a Graph insights row into the flat shape importRows expects.
function normalize(row) {
  const purchases = (row.actions || []).find(a => a.action_type === 'purchase');
  const value     = (row.action_values || []).find(a => a.action_type === 'purchase');
  return {
    ad_id:        row.ad_id,
    ad_name:      row.ad_name,
    campaign:     row.campaign_name,
    adset:        row.adset_name,
    date:         row.date_start,
    spend:        Number(row.spend)       || 0,
    impressions:  Number(row.impressions) || 0,
    clicks:       Number(row.clicks)      || 0,
    purchases:    purchases ? Number(purchases.value) : 0,
    revenue:      value     ? Number(value.value)     : 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kick off a sync in the background. Returns metadata synchronously; the
 * actual HTTP work happens on the next tick so the caller (POST /accounts)
 * can respond immediately.
 */
function startSync(accountId) {
  const account = selectAccount.get(accountId);
  if (!account) throw new Error('account not found');

  const token = tokenFor(account);
  if (!token) {
    return { triggered: false, reason: 'no_token' };
  }

  const isFirst = !account.last_synced_at;
  const windowDays = windowFor(account);
  const since = daysAgoISO(windowDays);
  const until = todayISO();

  markRunning.run(accountId);

  // Fire-and-forget. The runner handles its own errors.
  setImmediate(() => { runSync(account, { since, until, windowDays }).catch(() => {}); });

  return {
    triggered: true,
    is_initial: isFirst,
    window_days: windowDays,
    since,
    until,
    started_at: new Date().toISOString(),
  };
}

async function runSync(account, { since, until, windowDays }) {
  try {
    const token = tokenFor(account);
    const rows = await module.exports.fetchInsights({
      accountExternalId: account.external_id,
      token, since, until,
    });
    const normalized = rows.map(normalize);
    const inserted = normalized.length ? importRows(normalized) : 0;
    markDone.run({ id: account.id, window: windowDays });
    return { inserted, rows: normalized.length };
  } catch (e) {
    markError.run({ id: account.id, error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// Synchronous variant used by manual-sync routes/tests that want to await.
async function syncNow(accountId) {
  const account = selectAccount.get(accountId);
  if (!account) throw new Error('account not found');
  const token = tokenFor(account);
  if (!token) throw new Error('no token available for this account');

  const windowDays = windowFor(account);
  const since = daysAgoISO(windowDays);
  const until = todayISO();
  markRunning.run(accountId);
  const result = await runSync(account, { since, until, windowDays });
  return { ...result, window_days: windowDays, since, until, is_initial: !account.last_synced_at };
}

module.exports = {
  FIRST_SYNC_DAYS,
  startSync,
  syncNow,
  fetchInsights, // exported so tests/integrations can override via module.exports.fetchInsights
  _internal: { normalize, windowFor, daysAgoISO },
};
