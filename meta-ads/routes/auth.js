const express = require('express');
const {
  isAuthEnabled,
  verifyPassword,
  verifyToken,
  getTokenFromReq,
  makeToken,
  setSessionCookie,
  clearSessionCookie,
} = require('../services/auth');

const router = express.Router();

// Lightweight rate limit on failed logins — one shared bucket per server.
// Not intended as robust protection, just slows brute force from a single
// client on a LAN / hobby deploy. For serious hosting, front with a proper
// rate limiter.
const attempts = [];
const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 10;

function recordFailure() {
  const now = Date.now();
  attempts.push(now);
  while (attempts.length && now - attempts[0] > WINDOW_MS) attempts.shift();
}

function tooManyAttempts() {
  const now = Date.now();
  while (attempts.length && now - attempts[0] > WINDOW_MS) attempts.shift();
  return attempts.length >= MAX_ATTEMPTS;
}

router.post('/login', (req, res) => {
  if (!isAuthEnabled()) return res.json({ ok: true, authRequired: false });
  if (tooManyAttempts()) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
  }
  const pw = (req.body && req.body.password) || '';
  if (!verifyPassword(pw)) {
    recordFailure();
    return res.status(401).json({ error: 'Incorrect password' });
  }
  setSessionCookie(res, makeToken());
  res.json({ ok: true });
});

router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/status', (req, res) => {
  const enabled = isAuthEnabled();
  res.json({
    authRequired: enabled,
    authenticated: enabled ? verifyToken(getTokenFromReq(req)) : true,
  });
});

module.exports = router;
