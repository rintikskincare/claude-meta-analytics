/*
 * Shared-password auth with signed, HTTP-only cookies.
 *
 * Enabled when APP_PASSWORD is set in the environment. If unset, auth is a
 * no-op (useful for local dev / LAN-only use). The session secret is kept
 * in data/.session-secret so cookies survive process restarts; it is
 * auto-generated on first boot.
 *
 * Token format: `<expiresAtMs>.<hmacSha256Hex>`
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET_PATH = path.join(__dirname, '..', 'data', '.session-secret');
const COOKIE_NAME = 'meta_ads_session';
const MAX_AGE_MS  = 7 * 24 * 60 * 60 * 1000;   // 7 days

// ── Secret management ─────────────────────────────────────────
let _secret;
function getSecret() {
  if (_secret) return _secret;
  try {
    _secret = fs.readFileSync(SECRET_PATH, 'utf8').trim();
    if (_secret) return _secret;
  } catch { /* fall through to generate */ }
  _secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, _secret, { mode: 0o600 });
  return _secret;
}

// ── Password verification ─────────────────────────────────────
function isAuthEnabled() {
  return !!process.env.APP_PASSWORD;
}

function verifyPassword(input) {
  const expected = process.env.APP_PASSWORD || '';
  if (!expected || !input) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Token sign/verify ─────────────────────────────────────────
function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('hex');
}

function makeToken() {
  const exp = Date.now() + MAX_AGE_MS;
  return `${exp}.${sign(String(exp))}`;
}

function verifyToken(token) {
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = sign(expStr);
  if (sig.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

// ── Cookie helpers ────────────────────────────────────────────
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getTokenFromReq(req) {
  return parseCookies(req.headers.cookie || '')[COOKIE_NAME];
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ].join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

// ── Gate middleware ───────────────────────────────────────────
// Public paths that never require auth (login page, its assets, auth API).
const PUBLIC_PREFIXES = ['/js/', '/css/', '/img/', '/api/auth/'];
const PUBLIC_EXACT = new Set(['/login.html', '/favicon.ico']);

function isPublicPath(p) {
  if (PUBLIC_EXACT.has(p)) return true;
  return PUBLIC_PREFIXES.some(prefix => p.startsWith(prefix));
}

function gate(req, res, next) {
  if (!isAuthEnabled()) return next();
  if (isPublicPath(req.path)) return next();
  if (verifyToken(getTokenFromReq(req))) return next();
  // Unauth: page request (GET anything other than /api/*) → redirect to
  // login so browsers bouncing directly to / land somewhere useful. All
  // API calls get 401 JSON so the fetch wrapper on the client can redirect.
  const isPageRequest = req.method === 'GET' && !req.path.startsWith('/api/');
  if (isPageRequest) return res.redirect('/login.html');
  return res.status(401).json({ error: 'auth required' });
}

module.exports = {
  isAuthEnabled,
  verifyPassword,
  makeToken,
  verifyToken,
  getTokenFromReq,
  setSessionCookie,
  clearSessionCookie,
  gate,
  COOKIE_NAME,
};
