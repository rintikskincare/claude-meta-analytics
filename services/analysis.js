// Shared creative-analysis helpers.
//
// Extracted from routes/creatives.js so both the creatives route and the
// sync service can trigger Gemini analysis without circular dependencies.

const db = require('../db');
const gemini = require('./gemini');
const settings = require('./settings');

const applyAnalysis = db.prepare(`
  UPDATE creatives SET
    analysis_status = 'analyzed',
    asset_type      = @asset_type,
    visual_format   = @visual_format,
    messaging_angle = @messaging_angle,
    hook_tactic     = @hook_tactic,
    offer_type      = @offer_type,
    funnel_stage    = @funnel_stage,
    summary         = @summary,
    analyzed_at     = datetime('now'),
    analysis_error  = NULL
  WHERE id = @id
`);

const markAnalysisError = db.prepare(`
  UPDATE creatives SET analysis_status = 'error', analysis_error = @error WHERE id = @id
`);

const markAnalyzing = db.prepare(`
  UPDATE creatives SET analysis_status = 'analyzing', analysis_error = NULL WHERE id = ?
`);

/**
 * Run Gemini analysis on a single creative row. Writes tags on success,
 * marks error on failure. Never throws — callers can safely loop without
 * try/catch.
 *
 * @returns {'analyzed'|'error'} the resulting status
 */
async function runAnalysis(id, creative) {
  try {
    const tags = await gemini.analyzeCreative(creative);
    applyAnalysis.run({ id, ...tags });
    return 'analyzed';
  } catch (e) {
    markAnalysisError.run({ id, error: String(e.message || e).slice(0, 500) });
    return 'error';
  }
}

/**
 * Auto-analyze all pending creatives for a given account (or all accounts
 * if accountId is null). Skips silently when no Gemini key is configured.
 *
 * Runs sequentially to respect Gemini rate limits. Each creative failure
 * is recorded individually — never crashes the caller.
 *
 * @returns {{ attempted: number, analyzed: number, failed: number }}
 */
async function autoAnalyze(accountId) {
  // Bail early when no key is configured — analysis is opt-in.
  const apiKey = settings.getSecret('gemini_api_key');
  if (!apiKey) return { attempted: 0, analyzed: 0, failed: 0, skipped_reason: 'no_gemini_key' };

  const whereClause = accountId != null
    ? `WHERE analysis_status IN ('pending','error') AND ad_account_id = ?`
    : `WHERE analysis_status IN ('pending','error')`;
  const params = accountId != null ? [accountId] : [];

  const rows = db.prepare(`SELECT * FROM creatives ${whereClause} ORDER BY id`).all(...params);
  if (!rows.length) return { attempted: 0, analyzed: 0, failed: 0 };

  // Mark all as 'analyzing' up-front so the UI reflects immediately.
  for (const row of rows) markAnalyzing.run(row.id);

  let analyzed = 0;
  let failed = 0;

  for (const row of rows) {
    const status = await runAnalysis(row.id, row);
    if (status === 'analyzed') analyzed++;
    else failed++;
  }

  return { attempted: rows.length, analyzed, failed };
}

module.exports = { runAnalysis, autoAnalyze, markAnalyzing };
