/*
 * Login page controller. Verifies the shared password via /api/auth/login
 * and, on success, redirects the user back to wherever they were originally
 * trying to go (captured into sessionStorage by api.js when it sees a 401).
 */

(function () {
  'use strict';

  const form  = document.getElementById('login-form');
  const err   = document.getElementById('login-err');
  const input = document.getElementById('password');
  const btn   = form.querySelector('button');

  // If auth is disabled, or we already have a valid session, skip the form.
  fetch('/api/auth/status')
    .then(r => r.json())
    .then(s => {
      if (!s.authRequired || s.authenticated) {
        window.location.replace(redirectTarget());
      }
    })
    .catch(() => { /* ignore — let user log in manually */ });

  function redirectTarget() {
    const stored = sessionStorage.getItem('login_redirect');
    sessionStorage.removeItem('login_redirect');
    // Only accept same-origin, non-login paths.
    if (stored && stored.startsWith('/') && !stored.startsWith('/login')) {
      return stored;
    }
    return '/';
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.style.display = 'none';
    const pw = input.value;
    if (!pw) { input.focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || 'Incorrect password');
      }
      window.location.replace(redirectTarget());
    } catch (ex) {
      err.textContent = ex.message;
      err.style.display = 'block';
      btn.disabled = false;
      btn.textContent = 'Sign in';
      input.select();
    }
  });
})();
