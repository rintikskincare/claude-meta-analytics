// Report generation service.
//
// Generates a point-in-time snapshot report for one account (or all)
// containing aggregate KPIs, top and bottom performers, and the sync
// window metadata. The result JSON is stored in the reports table so
// historical snapshots persist even as live data changes.

const db = require('../db');
const { deriveKpis } = require('./metrics');
const settings = require('./settings');

// Build date-window params. Uses the configured date_range_days when
// no explicit window is provided.
function resolveWindow({ from, to, days } = {}) {
  const windowDays = days || settings.get('date_range_days');
  const end   = to   || new Date().toISOString().slice(0, 10);
  const start = from || (() => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString().slice(0, 10);
  })();
  return { from: start, to: end, days: windowDays };
}

// Build an account-scoped date clause for the insights table.
function scopedClause(accountId, from, to) {
  const conds = ['i.date >= @from', 'i.date <= @to'];
  const params = { from, to };
  if (accountId != null) {
    conds.push('a.ad_account_id = @accountId');
    params.accountId = accountId;
  }
  return { where: 'WHERE ' + conds.join(' AND '), params };
}

/**
 * Generate a snapshot report synchronously and save it to the DB.
 *
 * @param {Object} opts
 * @param {number|null} opts.accountId — null for all accounts
 * @param {string}      opts.name     — human-readable report name
 * @param {string=}     opts.from     — YYYY-MM-DD (defaults to N days ago)
 * @param {string=}     opts.to       — YYYY-MM-DD (defaults to today)
 * @param {number=}     opts.days     — window size override
 * @param {number=}     opts.topN     — how many top/bottom performers (default 5)
 * @returns {{ id, report }}
 */
function generateSnapshot({ accountId = null, name, from, to, days, topN = 5 } = {}) {
  const window = resolveWindow({ from, to, days });

  // Look up account name for the label.
  let accountName = 'All accounts';
  if (accountId != null) {
    const acc = db.prepare('SELECT name, external_id FROM ad_accounts WHERE id = ?').get(accountId);
    if (!acc) throw Object.assign(new Error('Account not found'), { status: 404 });
    accountName = acc.name;
  }

  const reportName = name || `Snapshot — ${accountName} — ${window.from} to ${window.to}`;

  // Insert the report row as "running" first.
  const info = db.prepare(`
    INSERT INTO reports (ad_account_id, name, type, params, status)
    VALUES (@accountId, @name, 'snapshot', @params, 'running')
  `).run({
    accountId: accountId || null,
    name: reportName,
    params: JSON.stringify({ from: window.from, to: window.to, days: window.days, topN }),
  });
  const reportId = info.lastInsertRowid;

  try {
    const { where, params } = scopedClause(accountId, window.from, window.to);

    // Aggregate KPIs.
    const totalsRow = db.prepare(`
      SELECT COALESCE(SUM(i.spend), 0)       spend,
             COALESCE(SUM(i.impressions), 0)  impressions,
             COALESCE(SUM(i.clicks), 0)       clicks,
             COALESCE(SUM(i.purchases), 0)    purchases,
             COALESCE(SUM(i.revenue), 0)      revenue
      FROM insights i
      JOIN ads a ON a.id = i.ad_id
      ${where}
    `).get(params);
    const totals = deriveKpis(totalsRow);

    // Creative count in window.
    const creativesInWindow = db.prepare(`
      SELECT COUNT(DISTINCT a.creative_id) cnt
      FROM insights i
      JOIN ads a ON a.id = i.ad_id
      ${where}
    `).get(params).cnt;

    // Top and bottom performers by ROAS (must have spend > 0).
    const performers = db.prepare(`
      SELECT c.id, c.name, c.format, c.thumbnail_url,
             c.funnel_stage, c.asset_type,
             SUM(i.spend) spend, SUM(i.impressions) impressions,
             SUM(i.clicks) clicks, SUM(i.purchases) purchases,
             SUM(i.revenue) revenue
      FROM creatives c
      JOIN ads a ON a.creative_id = c.id
      JOIN insights i ON i.ad_id = a.id
      ${where}
      GROUP BY c.id
      HAVING spend > 0
    `).all(params).map(r => ({ ...r, ...deriveKpis(r) }));

    performers.sort((a, b) => b.roas - a.roas);
    const topPerformers    = performers.slice(0, topN);
    const bottomPerformers = performers.length > topN
      ? performers.slice(-topN).reverse()
      : [];

    // Daily trend.
    const trend = db.prepare(`
      SELECT i.date,
             SUM(i.spend) spend, SUM(i.impressions) impressions,
             SUM(i.clicks) clicks, SUM(i.purchases) purchases,
             SUM(i.revenue) revenue
      FROM insights i
      JOIN ads a ON a.id = i.ad_id
      ${where}
      GROUP BY i.date ORDER BY i.date
    `).all(params).map(r => ({ date: r.date, ...deriveKpis(r) }));

    const result = {
      accountId,
      accountName,
      window: { from: window.from, to: window.to, days: window.days },
      generatedAt: new Date().toISOString(),
      totals,
      creativesInWindow,
      topPerformers,
      bottomPerformers,
      trend,
    };

    db.prepare(`UPDATE reports SET status = 'done', result = @result WHERE id = @id`)
      .run({ id: reportId, result: JSON.stringify(result) });

    return { id: reportId, report: deserialize(db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId)) };
  } catch (e) {
    db.prepare(`UPDATE reports SET status = 'error', error = @error WHERE id = @id`)
      .run({ id: reportId, error: String(e.message || e).slice(0, 500) });
    throw e;
  }
}

// Parse JSON columns when reading from the DB.
function deserialize(row) {
  if (!row) return null;
  return {
    ...row,
    params: row.params ? JSON.parse(row.params) : {},
    result: row.result ? JSON.parse(row.result) : null,
  };
}

function listReports({ accountId, limit = 50 } = {}) {
  const cond = accountId != null ? 'WHERE ad_account_id = @accountId' : '';
  const params = accountId != null ? { accountId, limit } : { limit };
  return db.prepare(`
    SELECT id, ad_account_id, name, type, params, status, error, created_at, updated_at
    FROM reports ${cond}
    ORDER BY created_at DESC
    LIMIT @limit
  `).all(params).map(r => ({ ...r, params: r.params ? JSON.parse(r.params) : {} }));
}

function getReport(id) {
  return deserialize(db.prepare('SELECT * FROM reports WHERE id = ?').get(id));
}

function deleteReport(id) {
  const info = db.prepare('DELETE FROM reports WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = { generateSnapshot, listReports, getReport, deleteReport };
