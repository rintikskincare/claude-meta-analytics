/*
 * Shared UI helpers — toast, confirm dialog, busy button.
 * Include AFTER api.js on any page. Works standalone; doesn't touch
 * existing per-page toast code so there's no regression risk.
 */

(function () {
  'use strict';

  // ── HTML escape ─────────────────────────────────
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── Toast ───────────────────────────────────────
  // Ensures a #toast element exists (creates one if the page didn't
  // include the markup), then shows the message.
  let toastTimer;
  function toast(msg, kind) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.className = 'toast';
      el.style.display = 'none';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
  }

  // ── Confirm dialog ──────────────────────────────
  // Returns a Promise<boolean>. Accepts contextual labels/danger flag.
  //   confirmDialog({
  //     title: 'Reset all data?',
  //     message: 'This removes…',
  //     confirmLabel: 'Reset',        // default: 'Confirm'
  //     cancelLabel: 'Cancel',        // default: 'Cancel'
  //     danger: true                  // red confirm button
  //   }) → Promise<boolean>
  let confirmHost;
  function ensureConfirmHost() {
    if (confirmHost) return confirmHost;
    confirmHost = document.createElement('div');
    confirmHost.id = 'ui-confirm';
    confirmHost.className = 'modal-overlay';
    confirmHost.style.display = 'none';
    confirmHost.innerHTML =
      '<div class="modal" style="max-width:420px">' +
        '<div class="modal-head">' +
          '<div id="ui-confirm-title" style="font-size:16px;font-weight:600"></div>' +
        '</div>' +
        '<div class="modal-body">' +
          '<div id="ui-confirm-msg" style="margin:0 0 16px;color:var(--muted);font-size:13px;line-height:1.5"></div>' +
          '<div class="modal-actions">' +
            '<button type="button" id="ui-confirm-cancel"></button>' +
            '<button type="button" id="ui-confirm-ok"></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(confirmHost);
    return confirmHost;
  }

  function confirmDialog(opts) {
    opts = opts || {};
    const host = ensureConfirmHost();
    const titleEl  = host.querySelector('#ui-confirm-title');
    const msgEl    = host.querySelector('#ui-confirm-msg');
    const okBtn    = host.querySelector('#ui-confirm-ok');
    const cancelBtn= host.querySelector('#ui-confirm-cancel');

    titleEl.textContent  = opts.title || 'Are you sure?';
    // Allow HTML in message when caller passes messageHtml; else textContent.
    if (opts.messageHtml != null) msgEl.innerHTML = opts.messageHtml;
    else msgEl.textContent = opts.message || '';

    okBtn.textContent     = opts.confirmLabel || 'Confirm';
    cancelBtn.textContent = opts.cancelLabel  || 'Cancel';
    okBtn.className       = opts.danger ? 'danger' : 'primary';

    host.style.display = 'flex';

    return new Promise(resolve => {
      function cleanup(result) {
        host.style.display = 'none';
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        host.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onOk()     { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onBackdrop(e) { if (e.target === host) cleanup(false); }
      function onKey(e) {
        if (e.key === 'Escape') cleanup(false);
        else if (e.key === 'Enter') cleanup(true);
      }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      host.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
      setTimeout(() => okBtn.focus(), 0);
    });
  }

  // ── Busy button ─────────────────────────────────
  // Disables a button and swaps its label while an action runs.
  //   const done = setBusy(btn, 'Saving…');
  //   try { …work… } finally { done(); }
  function setBusy(btn, busyText) {
    if (!btn || btn.disabled) return () => {};
    const prev = btn.textContent;
    btn.disabled = true;
    if (busyText) btn.textContent = busyText;
    return function clear() {
      btn.disabled = false;
      if (busyText) btn.textContent = prev;
    };
  }

  // Expose globals.
  window.UI = { toast, confirmDialog, setBusy, escHtml };

  // ── Auth-aware header enhancement ───────────────────
  // When APP_PASSWORD is configured on the server, inject a "Sign out"
  // link at the end of the page's nav so users have a way to end the
  // session. No-op on the login page or when auth is disabled.
  if (!/\/login\.html$/.test(window.location.pathname)) {
    fetch('/api/auth/status')
      .then(r => (r.ok ? r.json() : null))
      .then(s => {
        if (!s || !s.authRequired || !s.authenticated) return;
        const nav = document.querySelector('header nav');
        if (!nav || nav.querySelector('[data-signout]')) return;
        const a = document.createElement('a');
        a.href = '#';
        a.textContent = 'Sign out';
        a.setAttribute('data-signout', '1');
        a.style.marginLeft = 'auto';
        a.addEventListener('click', async e => {
          e.preventDefault();
          try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
          window.location.replace('/login.html');
        });
        nav.appendChild(a);
      })
      .catch(() => { /* ignore — server might be older without /api/auth */ });
  }
})();
