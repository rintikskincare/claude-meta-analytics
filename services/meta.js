// Thin Meta Graph API client. Only what we need for connection testing.
// Uses global fetch (Node >= 18).

const GRAPH = 'https://graph.facebook.com/v19.0';

async function graph(path, token, params = {}) {
  const url = new URL(GRAPH + path);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let resp;
  try {
    resp = await fetch(url, { method: 'GET' });
  } catch (e) {
    const err = new Error(`Network error reaching Meta Graph API: ${e.message}`);
    err.status = 502;
    throw err;
  }

  let body = null;
  try { body = await resp.json(); } catch { /* non-JSON */ }

  if (!resp.ok || (body && body.error)) {
    const metaErr = (body && body.error) || {};
    const err = new Error(friendlyError(metaErr, resp.status));
    err.status = resp.status === 401 || resp.status === 400 ? 401 : resp.status;
    err.meta = { code: metaErr.code, type: metaErr.type, subcode: metaErr.error_subcode };
    throw err;
  }
  return body;
}

function friendlyError(metaErr, httpStatus) {
  // https://developers.facebook.com/docs/graph-api/guides/error-handling/
  const code = metaErr.code;
  const sub = metaErr.error_subcode;
  const msg = metaErr.message || '';

  if (code === 190) {
    if (sub === 463) return 'Meta access token has expired. Please generate a new token.';
    if (sub === 460) return 'Meta access token is no longer valid (password changed). Please regenerate it.';
    if (sub === 467) return 'Meta access token is invalid or was revoked.';
    return 'Meta access token is invalid or expired.';
  }
  if (code === 102) return 'Session is invalid. Please log in again to Meta and regenerate the token.';
  if (code === 10 || code === 200) return 'Token is missing required permissions (need ads_read and ads_management).';
  if (code === 4 || code === 17 || code === 32) return 'Meta API rate limit reached. Try again in a minute.';
  if (httpStatus === 401) return 'Meta rejected the access token (401 unauthorized).';
  if (httpStatus >= 500) return 'Meta Graph API is temporarily unavailable. Please retry shortly.';
  return msg ? `Meta API error: ${msg}` : `Meta API error (HTTP ${httpStatus}).`;
}

async function testConnection(token) {
  if (!token || typeof token !== 'string' || token.trim().length < 10) {
    const err = new Error('No Meta access token configured. Save one in Settings first.');
    err.status = 400;
    throw err;
  }

  const [me, accounts] = await Promise.all([
    graph('/me', token, { fields: 'id,name' }),
    graph('/me/adaccounts', token, {
      fields: 'id,account_id,name,currency,account_status,timezone_name',
      limit: 100,
    }),
  ]);

  const statusMap = { 1: 'active', 2: 'disabled', 3: 'unsettled', 7: 'pending_risk_review',
                      8: 'pending_settlement', 9: 'in_grace_period', 100: 'pending_closure',
                      101: 'closed', 201: 'any_active', 202: 'any_closed' };

  const adAccounts = (accounts.data || []).map(a => ({
    id: a.id,
    account_id: a.account_id,
    name: a.name,
    currency: a.currency,
    timezone: a.timezone_name,
    status: statusMap[a.account_status] || String(a.account_status || 'unknown'),
  }));

  return {
    user: { id: me.id, name: me.name },
    ad_accounts: adAccounts,
    ad_accounts_count: adAccounts.length,
  };
}

module.exports = { testConnection };
